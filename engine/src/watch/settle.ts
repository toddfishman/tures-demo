// Trip Watch pass-through settlement — charge accumulated metered spend once per trip.
import type { Booking } from "../booking/types.ts";
import { getPayments } from "../booking/payments.ts";
import { chooseCard } from "../wallet/cards.ts";
import { emitEvent } from "../events/bus.ts";
import { log } from "../logger.ts";
import type { TripWatch } from "./types.ts";
import { pricing, recalcBillable } from "./meter.ts";
import { watches } from "./store.ts";

const DAY = 86400000;
const STRIPE_MIN_USD = 0.5;

/** True when the watch window has closed (return + 1 day), or the booking is no longer active. */
export function watchWindowClosed(b: Booking): boolean {
  if (b.status !== "booked") return true;
  const depart = Date.parse(b.brief.departDate ?? "");
  if (isNaN(depart)) return false;
  const ret = b.brief.returnDate ? Date.parse(b.brief.returnDate) : depart + DAY;
  return Date.now() > ret + DAY;
}

/** Charge pass-through watch spend once when the trip ends. Idempotent per booking. */
export async function settleWatchBilling(w: TripWatch, b: Booking): Promise<TripWatch> {
  if (w.settledAt) return w;

  recalcBillable(w);
  const amount = pricing(w).billableUsd;
  const now = new Date().toISOString();

  if (amount < 0.01) {
    w.settlementStatus = "skipped";
    w.settlementUsd = 0;
    w.settlementNote = "no_spend";
    w.settledAt = now;
    w.enabled = false;
    w.updatedAt = now;
    log.info("watch settle skipped — no spend", { bookingId: w.bookingId });
    return watches.put(w);
  }

  const payments = getPayments();
  if (payments.live && amount < STRIPE_MIN_USD) {
    w.settlementStatus = "skipped";
    w.settlementUsd = 0;
    w.settlementNote = `below_minimum_${STRIPE_MIN_USD}`;
    w.settledAt = now;
    w.enabled = false;
    w.updatedAt = now;
    log.info("watch settle skipped — below Stripe minimum", { bookingId: w.bookingId, amount });
    return watches.put(w);
  }

  try {
    const choice = chooseCard(w.accountId, { category: "other", amountUsd: amount });
    const pay = await payments.charge(amount, "USD", `watch:${w.bookingId}:settle`, {
      accountId: w.accountId,
      connectionId: choice?.connectionId,
    });
    w.settlementStatus = payments.live ? "succeeded" : "mock";
    w.settlementUsd = amount;
    w.settlementPaymentId = pay.intentId;
    w.settledAt = now;
    w.enabled = false;
    w.updatedAt = now;
    watches.put(w);
    emitEvent(b.tripId, "notify", "Trip Watch settled", {
      detail: `$${amount.toFixed(2)} pass-through API spend${payments.live ? "" : " (simulated)"}`,
      data: { bookingId: b.id, watch: true, settlementUsd: amount, settlementStatus: w.settlementStatus },
    });
    log.info("watch settled", { bookingId: w.bookingId, amount, live: payments.live });
    return w;
  } catch (e) {
    w.settlementStatus = "failed";
    w.settlementNote = String(e);
    w.updatedAt = now;
    watches.put(w);
    emitEvent(b.tripId, "notify", "Trip Watch settlement failed", {
      detail: String(e),
      data: { bookingId: b.id, watch: true, settlementStatus: "failed" },
    });
    log.warn("watch settle failed", { bookingId: w.bookingId, err: String(e) });
    return w;
  }
}
