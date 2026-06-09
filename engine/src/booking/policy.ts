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

  // Real-money safety: refuse a live supplier unless explicitly allowed.
  if (input.supplier.isLive && !config.allowLiveBooking) {
    v.push("live supplier blocked (set ALLOW_LIVE_BOOKING=true to permit real bookings)");
  }

  // Supplier must actually be able to commit the order.
  if (!input.supplier.book) {
    v.push(`supplier "${input.supplier.name}" cannot book yet (no order API wired)`);
  }

  return v;
}

/** Does the brief's bookingMode allow skipping the human-confirm gate? Only auto_within_brief,
 *  and only when there are no violations. */
export function canAutoBook(brief: Brief, violations: string[]): boolean {
  return brief.bookingMode === "auto_within_brief" && violations.length === 0;
}
