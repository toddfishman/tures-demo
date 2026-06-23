// Chunk 5 — the Hiccup Handler. When a booked trip is disrupted (cancellation / schedule change),
// it finds the best replacement and either auto-rebooks within the brief's standing authority or
// proposes the fix for approval. Composes everything else: search → policy → wallet → book → notify.
import type { Booking } from "../booking/types.ts";
import { bookings } from "../booking/store.ts";
import { runSearch } from "../search/service.ts";
import { getSupplier } from "../suppliers/index.ts";
import { getPayments } from "../booking/payments.ts";
import { isSimulatedBooking, simulatedConfirmation } from "../booking/policy.ts";
import { chooseCard, categoryForKind } from "../wallet/cards.ts";
import { emitEvent } from "../events/bus.ts";
import { log } from "../logger.ts";

export interface Disruption {
  kind: "cancellation" | "schedule_change" | "delay";
  detail?: string;
}

export interface RebookResolution {
  status: "rebooked" | "proposed" | "no_action";
  disruption: Disruption;
  from?: string;
  to?: string;
  upchargeUsd?: number;
  reason: string;
}

function audit(b: Booking, action: string, detail?: string) {
  b.audit.push({ ts: new Date().toISOString(), actor: "agent", action, detail });
}

export async function handleDisruption(bookingId: string, disruption: Disruption): Promise<{ resolution: RebookResolution; booking: Booking } | null> {
  const booking = bookings.get(bookingId);
  if (!booking) return null;

  const tripId = booking.tripId;
  const flight = booking.components.find((c) => c.kind === "flight" && (c.status === "confirmed" || c.status === "rebooked"));

  const record = (resolution: RebookResolution) => {
    booking.hiccups = booking.hiccups ?? [];
    booking.hiccups.push({ ts: new Date().toISOString(), kind: disruption.kind, detail: disruption.detail ?? "", resolution: resolution.status });
    bookings.put(booking);
    return { resolution, booking };
  };

  if (booking.status !== "booked" || !flight) {
    const resolution: RebookResolution = { status: "no_action", disruption, reason: "no active flight to rebook" };
    emitEvent(tripId, "hiccup", "Disruption ignored", { detail: resolution.reason });
    return record(resolution);
  }

  emitEvent(tripId, "hiccup", `Disruption: ${disruption.kind} on ${flight.title}`, { detail: disruption.detail, data: { bookingId } });
  audit(booking, "disruption_detected", `${disruption.kind}: ${flight.title}${disruption.detail ? ` — ${disruption.detail}` : ""}`);

  // Find the best replacement flight (exclude the disrupted offer).
  const { flights } = await runSearch(tripId, booking.brief);
  const alt = flights.find((f) => f.id !== flight.offerId) ?? flights[0];
  if (!alt) {
    const resolution: RebookResolution = { status: "no_action", disruption, reason: "no alternative flights found" };
    emitEvent(tripId, "error", "No rebooking option found", { data: { bookingId } });
    audit(booking, "rebook_failed", resolution.reason);
    return record(resolution);
  }

  const upchargeUsd = Math.max(0, Math.round((alt.priceUsd - flight.amountUsd) * 100) / 100);
  const newTotal = booking.totalUsd - flight.amountUsd + alt.priceUsd;

  // Standing authority: may we auto-rebook?
  const rb = booking.brief.rebooking ?? { mode: "propose" as const };
  const withinBudget = !booking.brief.budgetUsd || newTotal <= booking.brief.budgetUsd;
  const withinUpcharge = rb.maxUpchargeUsd === undefined || upchargeUsd <= rb.maxUpchargeUsd;
  const autoOk = rb.mode === "auto" && withinBudget && withinUpcharge;

  if (!autoOk) {
    const why = rb.mode !== "auto" ? "standing authority is propose-only" : !withinBudget ? "would exceed trip budget" : `fare difference $${upchargeUsd.toLocaleString()} over your $${rb.maxUpchargeUsd?.toLocaleString()} cap`;
    const resolution: RebookResolution = { status: "proposed", disruption, from: flight.title, to: alt.title, upchargeUsd, reason: `proposed ${alt.title} (+$${upchargeUsd.toLocaleString()}) — ${why}` };
    emitEvent(tripId, "hiccup", "Rebooking needs your OK", { detail: resolution.reason, data: { bookingId, to: alt.id } });
    audit(booking, "rebook_proposed", resolution.reason);
    return record(resolution);
  }

  // Auto-rebook: charge the fare difference on the best card, commit with the supplier.
  const supplier = getSupplier();
  const payments = getPayments();
  try {
    if (upchargeUsd > 0) {
      const choice = chooseCard(booking.accountId, { category: categoryForKind("flight"), amountUsd: upchargeUsd });
      const pay = await payments.charge(upchargeUsd, booking.currency, `${booking.id}:rebook:${Date.now().toString(36)}`, { accountId: booking.accountId, connectionId: choice?.connectionId });
      booking.charges.push(pay);
      audit(booking, "payment_charged", `rebooking fare difference $${upchargeUsd.toLocaleString()}${choice ? ` on ${choice.name}` : ""}`);
    }
    // Real order only when live booking is on AND the supplier can place it; otherwise simulate
    // a labeled sample confirmation (consistent with the booking service's simulated path).
    let confirmation: string;
    let simulated = false;
    if (!isSimulatedBooking() && supplier.book) {
      ({ confirmation } = await supplier.book(alt));
    } else {
      confirmation = simulatedConfirmation("flight", alt.id);
      simulated = true;
    }

    flight.rebookedFrom = { title: flight.title, confirmation: flight.confirmation };
    flight.status = "rebooked";
    flight.offerId = alt.id;
    flight.title = alt.title;
    flight.amountUsd = alt.priceUsd;
    flight.confirmation = confirmation;
    flight.simulated = simulated;
    booking.totalUsd = newTotal;

    audit(booking, "rebooked", `${flight.rebookedFrom.title} → ${alt.title} (${confirmation})${simulated ? " [simulated]" : ""}, +$${upchargeUsd.toLocaleString()}`);
    emitEvent(tripId, "hiccup", `Rebooked: ${alt.title}`, { detail: `${confirmation} · +$${upchargeUsd.toLocaleString()} — handled automatically`, data: { bookingId, confirmation, simulated } });
    emitEvent(tripId, "notify", "Disruption handled", { detail: `You're rebooked on ${alt.title}. Nothing for you to do.`, data: { bookingId } });

    const resolution: RebookResolution = { status: "rebooked", disruption, from: flight.rebookedFrom.title, to: alt.title, upchargeUsd, reason: `auto-rebooked on ${alt.title} (+$${upchargeUsd.toLocaleString()})` };
    return record(resolution);
  } catch (e) {
    log.error("rebook failed", { bookingId, err: String(e) });
    audit(booking, "rebook_failed", String(e));
    emitEvent(tripId, "error", "Rebooking failed", { detail: String(e), data: { bookingId } });
    return record({ status: "no_action", disruption, reason: `rebook failed: ${e}` });
  }
}
