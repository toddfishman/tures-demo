// Committing a rebooking — the part that touches money.
//
// ORDERING (this changed, and it matters):
//
// The old handler charged the fare difference FIRST and then called supplier.book(). If the book
// threw, the catch logged the error and returned "no_action" — leaving the traveler charged for a
// seat they did not get, with no reversal anywhere in the code path. That is precisely the fake
// success state the project forbids, wearing an error message.
//
// We now SECURE THE SEAT FIRST, then charge. If the seat can't be had, no money has moved and
// the traveler is exactly where they started. If the seat is secured but the card then declines,
// the traveler is still on the flight — the failure is Tures's to chase, and it is recorded
// loudly (audit + error event + a payment marker on the component) instead of being swallowed.
//
// When P6 turns real money on, the correct shape is authorize → book → capture, voiding the
// authorization if the order fails. `chargeUpcharge` is the seam where that goes.
import type { Booking, BookedComponent } from "../booking/types.ts";
import type { Offer } from "../types.ts";
import { bookings } from "../booking/store.ts";
import { getSupplier } from "../suppliers/index.ts";
import { getPayments } from "../booking/payments.ts";
import { isSimulatedBooking, simulatedConfirmation } from "../booking/policy.ts";
import { chooseCard, categoryForKind } from "../wallet/cards.ts";
import { emitEvent } from "../events/bus.ts";
import { log } from "../logger.ts";

export interface SwapResult {
  ok: boolean;
  confirmation?: string;
  simulated?: boolean;
  /** Set when the seat was secured but the fare difference could not be collected. */
  paymentIssue?: string;
  error?: string;
}

function audit(b: Booking, action: string, detail?: string) {
  b.audit.push({ ts: new Date().toISOString(), actor: "agent", action, detail });
}

/**
 * Swap a disrupted component onto a replacement offer. Mutates the booking in place and persists.
 * The caller has already established authority — this function does not re-check policy.
 */
export async function swapComponent(booking: Booking, componentIndex: number, replacement: Offer, opts: { idemSuffix: string }): Promise<SwapResult> {
  const component = booking.components[componentIndex];
  if (!component) return { ok: false, error: "component no longer exists" };

  const supplier = getSupplier();
  const payments = getPayments();
  const upchargeUsd = Math.round((replacement.priceUsd - component.amountUsd) * 100) / 100;

  // ── 1. Secure the replacement ─────────────────────────────────────────────────────────
  let confirmation: string;
  let simulated = false;
  try {
    if (!isSimulatedBooking() && supplier.book) {
      ({ confirmation } = await supplier.book(replacement));
    } else {
      confirmation = simulatedConfirmation(component.kind, replacement.id);
      simulated = true;
    }
  } catch (e) {
    // Nothing charged, nothing changed. The traveler is where they were.
    audit(booking, "rebook_failed", `could not secure ${replacement.title}: ${e}`);
    emitEvent(booking.tripId, "error", "Could not secure the replacement", {
      detail: `${replacement.title} — ${e}. Nothing was charged and your original booking is unchanged.`,
      data: { bookingId: booking.id },
    });
    bookings.put(booking);
    return { ok: false, error: String(e) };
  }

  // ── 2. Collect the fare difference ────────────────────────────────────────────────────
  let paymentIssue: string | undefined;
  if (upchargeUsd > 0) {
    try {
      const choice = chooseCard(booking.accountId, { category: categoryForKind(component.kind), amountUsd: upchargeUsd });
      const pay = await payments.charge(upchargeUsd, booking.currency, `${booking.id}:rebook:${opts.idemSuffix}`, {
        accountId: booking.accountId,
        connectionId: choice?.connectionId,
      });
      booking.charges.push(pay);
      audit(booking, "payment_charged", `rebooking fare difference $${upchargeUsd.toLocaleString()}${choice ? ` on ${choice.name}` : ""}`);
    } catch (e) {
      // The seat is held. Say so plainly and flag the money problem — never report this as clean.
      paymentIssue = String(e);
      audit(booking, "rebook_payment_failed", `seat secured (${confirmation}) but the $${upchargeUsd.toLocaleString()} difference did not go through: ${e}`);
      emitEvent(booking.tripId, "error", "Rebooked, but the fare difference did not go through", {
        detail: `You are on ${replacement.title} (${confirmation}). The $${upchargeUsd.toLocaleString()} difference needs a working card — Tures will not retry it on its own.`,
        data: { bookingId: booking.id, confirmation, upchargeUsd },
      });
      log.error("rebook upcharge failed after securing seat", { bookingId: booking.id, err: String(e) });
    }
  }

  // ── 3. Commit the swap onto the booking ───────────────────────────────────────────────
  const previous: BookedComponent["rebookedFrom"] = { title: component.title, confirmation: component.confirmation };
  component.rebookedFrom = previous;
  component.status = "rebooked";
  component.offerId = replacement.id;
  component.title = replacement.title;
  component.amountUsd = replacement.priceUsd;
  component.confirmation = confirmation;
  component.simulated = simulated;
  // upchargeUsd is already (new − old), so the trip total moves by exactly that.
  booking.totalUsd = Math.round((booking.totalUsd + upchargeUsd) * 100) / 100;

  audit(
    booking,
    "rebooked",
    `${previous.title} → ${replacement.title} (${confirmation})${simulated ? " [simulated]" : ""}, ${upchargeUsd >= 0 ? "+" : "−"}$${Math.abs(upchargeUsd).toLocaleString()}${paymentIssue ? " — FARE DIFFERENCE UNPAID" : ""}`,
  );
  bookings.put(booking);

  return { ok: true, confirmation, simulated, paymentIssue };
}
