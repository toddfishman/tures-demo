// Trip Watch lifecycle — enable on book, adaptive scheduler tick, public status.
import type { Booking } from "../booking/types.ts";
import { bookings } from "../booking/store.ts";
import { getUser } from "../auth/index.ts";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import type { TripWatch, WatchPricing } from "./types.ts";
import { emptyMeter, pricing } from "./meter.ts";
import { buildWatchKeywords, buildXQuery } from "./keywords.ts";
import { watches } from "./store.ts";
import { runScan, utcDay } from "./scan.ts";
import { assessRisk } from "./risk.ts";
import { gatherSignals } from "../signals/service.ts";

const DAY = 86400000;

export interface EnableWatchOpts {
  capUsd?: number;
  marginPercent?: number;
  alertsOn?: boolean;
}

function withinWatchWindow(b: Booking): boolean {
  const depart = Date.parse(b.brief.departDate ?? "");
  if (isNaN(depart)) return b.status === "booked";
  const ret = b.brief.returnDate ? Date.parse(b.brief.returnDate) : depart + DAY;
  const now = Date.now();
  return (depart - now <= 14 * DAY && depart - now > -DAY) || (now >= depart && now <= ret + DAY);
}

function defaultCap(accountId: string): number {
  const user = getUser(accountId);
  if (user?.plan === "subscribe") return config.watch.subscriberCapUsd;
  return config.watch.defaultCapUsd;
}

export async function enableTripWatch(bookingId: string, opts: EnableWatchOpts = {}): Promise<TripWatch | null> {
  const b = bookings.get(bookingId);
  if (!b || b.status !== "booked") return null;

  const now = new Date().toISOString();
  const xQuery = await buildXQuery(b.brief);
  const w: TripWatch = {
    bookingId: b.id,
    tripId: b.tripId,
    accountId: b.accountId,
    enabled: true,
    capUsd: opts.capUsd ?? defaultCap(b.accountId),
    marginPercent: opts.marginPercent ?? config.watch.marginPercent,
    alertsOn: opts.alertsOn !== false,
    riskScore: 0,
    riskLevel: "clear",
    scansToday: 0,
    scansBudgetToday: 0,
    deepScansToday: 0,
    meter: emptyMeter(),
    keywords: buildWatchKeywords(b.brief),
    xQuery,
    surfacedSignalIds: [],
    createdAt: now,
    updatedAt: now,
  };
  watches.put(w);
  log.info("trip watch enabled", { bookingId, capUsd: w.capUsd, xQuery: !!xQuery });
  await runScan(w, b, "brief");
  return watches.get(bookingId) ?? w;
}

export function getTripWatch(bookingId: string): (TripWatch & { pricing: WatchPricing }) | null {
  const w = watches.get(bookingId);
  if (!w) return null;
  return { ...w, pricing: pricing(w) };
}

export function listWatchesForAccount(accountId: string): TripWatch[] {
  return watches.active().filter((w) => w.accountId === accountId);
}

/** Scheduler tick — morning briefs, adaptive scans, alert polls. */
export async function processWatchTick(): Promise<void> {
  const active = watches.active();
  if (!active.length) return;

  const today = utcDay();
  const hourUtc = new Date().getUTCHours();

  for (const w of active) {
    const b = bookings.get(w.bookingId);
    if (!b || b.status !== "booked" || !withinWatchWindow(b)) continue;

    try {
      // New UTC day → reset counters + morning brief
      if (w.lastBriefDay !== today && hourUtc >= config.watch.briefHourUtc) {
        await runScan(w, b, "brief");
        continue;
      }

      // Always-on alerts every N hours (cheap weather threshold + optional X)
      const alertsDue =
        w.alertsOn &&
        (!w.lastAlertsAt || Date.now() - Date.parse(w.lastAlertsAt) >= config.watch.alertsIntervalMin * 60_000);
      if (alertsDue) {
        await runScan(watches.get(w.bookingId)!, b, "alerts");
        continue;
      }

      // Adaptive scans within today's budget
      const fresh = watches.get(w.bookingId)!;
      if (fresh.scansToday >= fresh.scansBudgetToday) continue;

      // Pick scan type based on risk and what we've already run
      if (fresh.scansBudgetToday === 0) continue;

      const remaining = fresh.scansBudgetToday - fresh.scansToday;
      if (remaining >= 2 && fresh.riskLevel !== "clear" && fresh.scansToday === 0) {
        await runScan(fresh, b, "news");
      } else if (fresh.riskLevel === "critical" || fresh.riskLevel === "elevated") {
        const a = assessRisk(
          (await gatherSignals({ destination: b.brief.destination, departDate: b.brief.departDate }, { deep: false })).signals,
          b.brief.departDate,
        );
        if (a.allowDeep && fresh.deepScansToday < 1) await runScan(fresh, b, "deep");
        else await runScan(fresh, b, "fast");
      } else {
        await runScan(fresh, b, "fast");
      }
    } catch (e) {
      log.warn("watch tick failed", { bookingId: w.bookingId, err: String(e) });
    }
  }
}

/** Push-triggered deep scan when an alert looks ambiguous (called from scan surface path). */
export function approveWatchCap(bookingId: string, additionalUsd: number): TripWatch | null {
  const w = watches.get(bookingId);
  if (!w || !w.enabled) return null;
  w.capExtraUsd = (w.capExtraUsd ?? 0) + additionalUsd;
  w.pendingCapUsd = undefined;
  w.updatedAt = new Date().toISOString();
  watches.put(w);
  log.info("watch cap approved", { bookingId, additionalUsd, effectiveCap: w.capUsd + w.capExtraUsd });
  return w;
}
