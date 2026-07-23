// The watcher — the "always-on" eyes the Hiccup Handler was missing. On an interval it sweeps the
// active booked trips whose window is near or in progress, gathers DEEP signals (including the web
// scout), and surfaces anything NEW onto that trip's live stream — proactively, before the traveler
// notices. It de-dupes per booking so it never re-alerts the same thing.
//
// Boundary (honest by design): the watcher SURFACES and FLAGS. It does not silently rebook on a
// hunch — actually moving a booking still flows through the Hiccup Handler's confirmed-disruption
// path (standing authority + real fare check). travelImpacting signals are emitted as "hiccup"
// events so the front-end / a future escalation step can act on them.
//
// Off by default: set SIGNAL_WATCH_INTERVAL_MIN > 0 to turn the background sweep on. On-demand
// /signals works regardless.
import type { Booking } from "../booking/types.ts";
import { config } from "../config.ts";
import { bookings } from "../booking/store.ts";
import { gatherSignals } from "./service.ts";
import { emitEvent } from "../events/bus.ts";
import { handleDisruption } from "../hiccup/handler.ts";
import { log } from "../logger.ts";

let timer: ReturnType<typeof setInterval> | null = null;
const surfaced = new Map<string, Set<string>>(); // bookingId → signal ids already streamed

const DAY = 86400000;

/** Watch trips that depart within ~14 days or are currently in progress — that's the window where
 *  a signal is actionable. Trips far in the future aren't worth a sweep yet. */
function withinWatchWindow(b: Booking): boolean {
  const depart = Date.parse(b.brief.departDate);
  if (isNaN(depart)) return true; // no usable date → keep it in view
  const ret = b.brief.returnDate ? Date.parse(b.brief.returnDate) : depart + DAY;
  const now = Date.now();
  const upcomingSoon = depart - now <= 14 * DAY && depart - now > -DAY;
  const inProgress = now >= depart && now <= ret + DAY;
  return upcomingSoon || inProgress;
}

async function sweep(): Promise<void> {
  const trips = bookings.activeBooked().filter(withinWatchWindow);
  if (!trips.length) return;
  for (const b of trips) {
    try {
      const { signals } = await gatherSignals(
        { destination: b.brief.destination, origin: b.brief.origin, departDate: b.brief.departDate, returnDate: b.brief.returnDate },
        { deep: true },
      );
      const set = surfaced.get(b.id) ?? new Set<string>();
      for (const s of signals) {
        if (set.has(s.id)) continue;
        set.add(s.id);
        const kind = s.severity === "critical" || s.severity === "warning" ? "hiccup" : "notify";
        emitEvent(b.tripId, kind, s.title, {
          detail: s.detail,
          data: { bookingId: b.id, signalId: s.id, category: s.category, severity: s.severity, travelImpacting: !!s.travelImpacting, source: s.source, url: s.url },
        });
        if (s.travelImpacting && (s.severity === "critical" || s.severity === "warning")) {
          // See watch/scan.ts — a signal is an inference, so it escalates as an UNQUANTIFIED
          // change (triage proposes rather than moves) and carries the signal id for dedupe.
          const disruptKind = s.severity === "critical" ? "schedule_change" as const : "delay" as const;
          void handleDisruption(b.id, { kind: disruptKind, detail: s.detail, sourceId: s.id, severity: s.severity }).catch((e) =>
            log.warn("watcher hiccup escalation failed", { bookingId: b.id, err: String(e) }),
          );
        }
      }
      surfaced.set(b.id, set);
    } catch (e) {
      log.warn("signal sweep failed", { bookingId: b.id, err: String(e) });
    }
  }
}

export function startSignalWatcher(): void {
  const min = config.signals.watchIntervalMin;
  if (!min) {
    log.info("signal watcher disabled (set SIGNAL_WATCH_INTERVAL_MIN>0 to enable)");
    return;
  }
  if (timer) return;
  timer = setInterval(() => void sweep(), min * 60_000);
  if (typeof (timer as any).unref === "function") (timer as any).unref(); // never hold the process open alone
  log.info("signal watcher on", { everyMin: min });
}

export function stopSignalWatcher(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
