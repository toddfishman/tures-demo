// Triage — "what does this actually cost the traveler?"
//
// This step did not exist before, and its absence was the handler's biggest problem: every
// disruption, including a weather signal the watcher had guessed at, went straight to a full
// rebook. A forty-minute delay would move someone's flight. A storm mentioned in two different
// signals would move it twice.
//
// Triage decides the smallest correct response:
//
//   ignore   — nothing to protect (trip not booked, or the leg is already handled)
//   monitor  — real, but acting would cost more than it saves. Tell them, watch it.
//   propose  — worth fixing, but the call isn't ours (authority, cost, or we don't own the PNR)
//   rebook   — fix it now, within the standing authority the brief granted
//
// It also works out the RIPPLE: a flight that slips a day leaves a hotel night unused and an
// airport transfer pointed at the wrong hour. Saying so is most of the value — a concierge who
// rebooks your flight and lets your first night burn hasn't handled the hiccup.
import type { Booking, BookedComponent } from "../booking/types.ts";
import { DELAY_MONITOR_THRESHOLD_MIN, type Disruption, type Triage } from "./types.ts";

const DAY_MS = 86400000;

function isLive(c: BookedComponent): boolean {
  return c.status === "confirmed" || c.status === "rebooked";
}

/** Which booked component this disruption lands on. Explicit index wins; otherwise infer from
 *  the kind. Returns -1 when nothing bookable is affected. */
function affectedIndex(booking: Booking, d: Disruption): number {
  if (d.componentIndex !== undefined) {
    const c = booking.components[d.componentIndex];
    if (c && isLive(c)) return d.componentIndex;
  }
  const wanted: BookedComponent["kind"] = d.kind === "stay_cancellation" ? "stay" : "flight";
  const idx = booking.components.findIndex((c) => c.kind === wanted && isLive(c));
  if (idx >= 0) return idx;
  // A closure is destination-side and may have no component at all — that's fine, it's a notice.
  return -1;
}

function dayOf(iso: string | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/** Knock-on effects, at day granularity — the honest resolution, since booked components carry
 *  dates rather than times. Says what is at risk, never invents a time it doesn't know. */
function rippleFor(booking: Booking, d: Disruption, affected: number): string[] {
  const out: string[] = [];
  const newDay = dayOf(d.newDepartureIso);
  const departDay = booking.brief.departDate;
  const slipsADay = !!(newDay && departDay && Date.parse(newDay) > Date.parse(departDay));
  // A long enough delay pushes past midnight even without an explicit new time.
  const longDelay = (d.delayMinutes ?? 0) >= 6 * 60;

  const stays = booking.components.filter((c, i) => c.kind === "stay" && isLive(c) && i !== affected);
  const transport = booking.components.filter((c, i) => c.kind === "transport" && isLive(c) && i !== affected);
  const sameDayPlans = booking.components.filter((c, i) => (c.kind === "dining" || c.kind === "activity") && isLive(c) && i !== affected);

  if ((slipsADay || longDelay) && stays.length) {
    out.push(`your first night at ${stays[0]!.title} would go unused — worth shortening the stay or asking for a late arrival`);
  }
  if ((slipsADay || longDelay) && transport.length) {
    out.push(`the ${transport[0]!.title} is timed to the old arrival and needs moving`);
  }
  if ((slipsADay || longDelay) && sameDayPlans.length) {
    out.push(`${sameDayPlans.length} arrival-day plan${sameDayPlans.length === 1 ? "" : "s"} (${sameDayPlans.slice(0, 2).map((c) => c.title).join(", ")}) may no longer fit`);
  }
  if (d.kind === "stay_cancellation" && booking.components.some((c) => c.kind === "flight" && isLive(c))) {
    out.push("flights are unaffected — only the room needs replacing");
  }

  // Returning leg: if the trip is already under way, say so — the options are different mid-trip.
  const ret = booking.brief.returnDate ? Date.parse(booking.brief.returnDate) : null;
  const dep = departDay ? Date.parse(departDay) : null;
  const now = Date.now();
  if (dep && now >= dep && ret && now <= ret + DAY_MS) {
    out.push("this is mid-trip — same-day options matter more than price here");
  }
  return out;
}

export function triage(booking: Booking, d: Disruption): Triage {
  // Tures may only advise on trips it did not book. Concierge Mode imports are somebody else's
  // PNR — we can see the disruption and tell the traveler exactly what to do, but we cannot
  // rebook a reservation we don't hold, and pretending otherwise would be a fake success state.
  const adviseOnly = booking.source === "import";

  if (booking.status !== "booked") {
    return { action: "ignore", componentIndex: -1, reason: "no active booked trip to protect", ripple: [], adviseOnly };
  }

  const componentIndex = affectedIndex(booking, d);
  const component = componentIndex >= 0 ? booking.components[componentIndex] : undefined;
  const ripple = rippleFor(booking, d, componentIndex);

  // Destination-side closures have nothing to rebook. They are a notice, and occasionally a
  // reason to move a dinner — never a reason to touch a flight.
  if (d.kind === "closure") {
    return {
      action: "monitor",
      componentIndex,
      reason: `noted: ${d.detail ?? "a closure at the destination"} — nothing booked needs to move for this`,
      ripple,
      adviseOnly,
    };
  }

  if (!component) {
    return { action: "ignore", componentIndex: -1, reason: "no live component matches this disruption", ripple, adviseOnly };
  }

  // A delay is the common case and almost never worth acting on. Act when it is long enough to
  // break the day, or when the supplier has moved it to another date.
  if (d.kind === "delay") {
    const mins = d.delayMinutes ?? 0;
    const newDay = dayOf(d.newDepartureIso);
    const slipsADay = !!(newDay && Date.parse(newDay) > Date.parse(booking.brief.departDate));
    if (!slipsADay && mins < DELAY_MONITOR_THRESHOLD_MIN) {
      return {
        action: "monitor",
        componentIndex,
        reason: mins
          ? `${mins} min delay on ${component.title} — under the ${DELAY_MONITOR_THRESHOLD_MIN} min line where moving you costs more than waiting`
          : `delay reported on ${component.title} with no duration yet — watching it`,
        ripple,
        adviseOnly,
      };
    }
    return {
      action: adviseOnly ? "propose" : "rebook",
      componentIndex,
      reason: slipsADay ? `${component.title} now departs ${newDay} — a different day than planned` : `${mins} min delay on ${component.title} breaks the day`,
      ripple,
      adviseOnly,
    };
  }

  // A schedule change with no numbers attached is exactly the case where the old handler guessed.
  // Quantified, we can judge it; unquantified, we ask rather than move someone on a hunch.
  if (d.kind === "schedule_change") {
    const mins = d.delayMinutes;
    const newDay = dayOf(d.newDepartureIso);
    const slipsADay = !!(newDay && Date.parse(newDay) > Date.parse(booking.brief.departDate));
    if (!slipsADay && mins !== undefined && mins < DELAY_MONITOR_THRESHOLD_MIN) {
      return { action: "monitor", componentIndex, reason: `${component.title} moved by ${mins} min — inside tolerance`, ripple, adviseOnly };
    }
    if (mins === undefined && !newDay) {
      return {
        action: "propose",
        componentIndex,
        reason: `${component.title} changed, but nobody has told us by how much — showing you the alternatives rather than moving you on a guess`,
        ripple,
        adviseOnly,
      };
    }
    return { action: adviseOnly ? "propose" : "rebook", componentIndex, reason: `${component.title} moved${slipsADay ? ` to ${newDay}` : ` by ${mins} min`}`, ripple, adviseOnly };
  }

  // Cancellation, denied boarding, a hotel falling through: the leg is gone. Fix it.
  return {
    action: adviseOnly ? "propose" : "rebook",
    componentIndex,
    reason: `${component.title} is ${d.kind === "denied_boarding" ? "oversold" : "cancelled"} — a replacement is needed`,
    ripple,
    adviseOnly,
  };
}
