// Policy gate — the brief is the authorization boundary. Every booking is checked against it
// BEFORE any money moves. Returns the list of violations (empty = allowed).
import type { Brief, Offer } from "../types.ts";
import { config } from "../config.ts";
import type { SupplierAdapter } from "../suppliers/adapter.ts";
import { hasScope } from "../vault/index.ts";

export interface PolicyInput {
  accountId: string;
  brief: Brief;
  flight?: Offer;
  stay?: Offer;
  totalUsd: number;
  supplier: SupplierAdapter;
}

export function checkPolicy(input: PolicyInput): string[] {
  const v: string[] = [];

  // Budget — a hard ceiling. Never exceed it.
  if (input.brief.budgetUsd && input.totalUsd > input.brief.budgetUsd) {
    v.push(
      `total $${input.totalUsd.toLocaleString()} exceeds brief budget $${input.brief.budgetUsd.toLocaleString()}`,
    );
  }

  // Must have something bookable.
  if (!input.flight && !input.stay) v.push("nothing to book (no flight or stay selected)");

  // Authorization: a payment method must be connected and grant payment:charge (Chunk 4 vault).
  if (!hasScope(input.accountId, "payment:charge")) {
    v.push("no payment method connected (grant payment:charge by connecting a card)");
  }

  // Real-money safety lives in ONE place: ALLOW_LIVE_BOOKING. With it OFF (the default demo
  // posture) bookings are SIMULATED — real inventory can be searched (Duffel), but no order is
  // ever placed and no money moves, so any supplier is allowed through to a labeled sample
  // confirmation. Only when live booking is explicitly enabled do we require a supplier that can
  // actually commit the order. (execute() in service.ts is the matching money gate.)
  if (config.allowLiveBooking && !input.supplier.book) {
    v.push(`supplier "${input.supplier.name}" cannot place real orders (no order API wired)`);
  }

  return v;
}

/** True when bookings should be simulated rather than really placed (the default until
 *  ALLOW_LIVE_BOOKING=true). Real search still happens; only the order is faked. */
export function isSimulatedBooking(): boolean {
  return !config.allowLiveBooking;
}

/** A clearly-labeled SAMPLE confirmation for a simulated booking. Deterministic per offer
 *  (stable for idempotency/tests), and obviously not a real PNR — "no fake success states". */
export function simulatedConfirmation(kind: Offer["kind"], offerId: string): string {
  let h = 2166136261;
  const s = offerId + ":sim";
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const code = (h >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
  const ref = kind === "flight" ? "PNR" : "CONF";
  return `SAMPLE-${ref}-${code}`;
}

/** Does the brief's bookingMode allow skipping the human-confirm gate? Only auto_within_brief,
 *  and only when there are no violations. */
export function canAutoBook(brief: Brief, violations: string[]): boolean {
  return brief.bookingMode === "auto_within_brief" && violations.length === 0;
}
