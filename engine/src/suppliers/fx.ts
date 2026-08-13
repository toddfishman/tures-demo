// FX normalization — every Offer.priceUsd must actually be USD, because the budget gate
// (booking/policy.ts) and every planner compare it straight against brief.budgetUsd. Before this
// module existed, Duffel fares came back in their native currency and were summed as if USD, so a
// 900 GBP fare read as "$900" and slid under a $1,000 budget it actually exceeds.
//
// Rates are static approximations (mid-market, reviewed 2026-08). That is fine for a budget
// ceiling — it needs to be roughly right, not settlement-grade; the traveler's card is charged in
// the supplier's real currency regardless. An UNKNOWN currency returns null: the caller must skip
// or flag that offer, never pass it through as if USD. Mispricing is the one failure not allowed.

/** USD per 1 unit of the given currency. */
const USD_PER_UNIT: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  CAD: 0.73,
  AUD: 0.66,
  NZD: 0.6,
  JPY: 0.0067,
  CHF: 1.13,
  CNY: 0.14,
  HKD: 0.128,
  SGD: 0.75,
  INR: 0.012,
  THB: 0.028,
  MXN: 0.054,
  BRL: 0.18,
  AED: 0.2723, // pegged
  DKK: 0.145,
  SEK: 0.095,
  NOK: 0.093,
  ZAR: 0.054,
  TRY: 0.03,
};

/** Convert an amount in `currency` to USD (rounded to cents), or null if the currency is unknown —
 *  callers must treat null as "cannot price this offer", not as zero or as USD. */
export function toUsd(amount: number, currency: string | null | undefined): number | null {
  if (!Number.isFinite(amount)) return null;
  const rate = USD_PER_UNIT[(currency ?? "USD").toUpperCase()];
  if (rate === undefined) return null;
  return Math.round(amount * rate * 100) / 100;
}
