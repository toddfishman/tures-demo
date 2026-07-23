// The Hiccup Handler — domain model.
//
// A hiccup is anything that breaks a booked trip: a cancelled flight, a schedule change, a long
// delay, a hotel that falls through, a closure at the destination. The handler's job is not
// "rebook something" — it's to work out what the disruption actually COSTS the traveler, then do
// the smallest correct thing: nothing, watch it, propose a fix, or fix it outright.
//
// The four states are deliberate. Most disruptions deserve `monitor`, not `rebook` — a 25-minute
// delay is noise, and a handler that rebooks on noise is worse than one that does nothing.
import { z } from "zod";

export type DisruptionKind =
  | "cancellation" // the leg is gone
  | "schedule_change" // moved enough that the supplier calls it a change
  | "delay" // still operating, later than planned
  | "denied_boarding" // oversold / bumped
  | "stay_cancellation" // the hotel fell through
  | "closure"; // destination-side: the venue/attraction/road is shut

export const DisruptionSchema = z.object({
  kind: z
    .enum(["cancellation", "schedule_change", "delay", "denied_boarding", "stay_cancellation", "closure"])
    .default("cancellation"),
  detail: z.string().max(600).optional(),
  /** Which booked component this hits. Omit and the handler infers it from `kind`. */
  componentIndex: z.number().int().nonnegative().optional(),
  /** How late, in minutes — the single most important number for a delay. */
  delayMinutes: z.number().int().min(0).max(60 * 72).optional(),
  /** The new departure, if the supplier gave one (ISO 8601). */
  newDepartureIso: z.string().optional(),
  /** A stable id for the underlying event (signal id, airline event id). Repeated reports of the
   *  SAME event collapse onto one proposal instead of stacking rebooks. This is what stops the
   *  watcher from charging a fare difference twice for one storm. */
  sourceId: z.string().max(200).optional(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
});
export type Disruption = z.infer<typeof DisruptionSchema>;

/** What triage decided to do about it. */
export type HiccupAction = "ignore" | "monitor" | "propose" | "rebook";

export interface Triage {
  action: HiccupAction;
  /** Index into booking.components, or -1 when nothing specific is affected. */
  componentIndex: number;
  /** Plain-English justification — shown to the traveler and written to the audit log. */
  reason: string;
  /** Knock-on effects the traveler should know about (unused hotel night, transfer now wrong). */
  ripple: string[];
  /** True when Tures does not own this booking (Concierge Mode import) and may only advise. */
  adviseOnly: boolean;
}

/** One candidate replacement, ranked and explained. */
export interface HiccupOption {
  offerId: string;
  title: string;
  priceUsd: number;
  /** Fare difference vs. the disrupted component. Negative = cheaper. */
  upchargeUsd: number;
  summary: string[];
  /** 0..1 — the rebooking-specific rank (fit + continuity − upcharge), not the raw search score. */
  rank: number;
  /** Why this one, in the traveler's language. */
  reasons: string[];
}

export type ProposalStatus = "pending" | "accepted" | "declined" | "expired" | "superseded";

/** A fix awaiting the traveler's word. Persisted, so the "OK" that arrives twenty minutes later
 *  on a phone still has something to act on — the old handler emitted an event and forgot. */
export interface HiccupProposal {
  id: string;
  bookingId: string;
  tripId: string;
  accountId: string;
  componentIndex: number;
  disruption: Disruption;
  /** Ranked replacements, best first. */
  options: HiccupOption[];
  status: ProposalStatus;
  /** Why we're asking instead of acting (over the upcharge cap, propose-only authority, import). */
  askReason: string;
  ripple: string[];
  createdAt: string;
  /** Options go stale — a fare quoted an hour ago may not exist. After this we re-search. */
  expiresAt: string;
  resolvedAt?: string;
  chosenOfferId?: string;
  /** Set when acting on this proposal failed, so the UI never shows a silent no-op. */
  failure?: string;
}

export interface RebookResolution {
  status: "rebooked" | "proposed" | "monitoring" | "no_action";
  disruption: Disruption;
  from?: string;
  to?: string;
  upchargeUsd?: number;
  reason: string;
  ripple?: string[];
  /** Set when status is "proposed" — what to accept. */
  proposalId?: string;
  /** True when this resolution is advisory because Tures doesn't own the booking. */
  adviseOnly?: boolean;
}

/** Minutes of delay below which we watch rather than act. A traveler does not want their flight
 *  moved because it left forty minutes late. */
export const DELAY_MONITOR_THRESHOLD_MIN = 90;
/** How long a set of quoted replacement options stays actionable. */
export const PROPOSAL_TTL_MIN = 45;
