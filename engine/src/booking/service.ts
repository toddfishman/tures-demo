// Booking service — the safety spine. createBooking opens the human-confirm gate (or auto-books
// only when the brief explicitly allows it AND policy passes); confirmBooking executes the
// charge→order sequence exactly once (idempotent). Every step is appended to the audit log and
// emitted to the live execution stream.
import type { Brief, Offer } from "../types.ts";
import type { Booking, BookedComponent } from "./types.ts";
import { bookings, nextBookingId } from "./store.ts";
import { checkPolicy, canAutoBook, isSimulatedBooking, simulatedConfirmation } from "./policy.ts";
import { getPayments } from "./payments.ts";
import { getSupplier } from "../suppliers/index.ts";
import { runSearch } from "../search/service.ts";
import { emitEvent } from "../events/bus.ts";
import { log } from "../logger.ts";
import { remember } from "../mem0.ts";
import { enableTripWatch } from "../watch/service.ts";
import { getUser } from "../auth/index.ts";
import { chooseCard, categoryForKind } from "../wallet/cards.ts";
import { passengerSummary, loyaltyCrediter } from "../profile/index.ts";
import { observe as observeTaste } from "../taste/service.ts";

// Resolved Offer objects kept out of the serialized Booking (supplier.book needs the full offer).
// The full candidate sets are kept alongside the picks: the Taste Engine learns from the CONTRAST
// between what was chosen and what it beat, so "the alternatives that were on screen" is real
// signal, not bookkeeping. See taste/learn.ts.
const offerCache = new Map<string, { flight?: Offer; stay?: Offer; flights?: Offer[]; stays?: Offer[] }>();

/** The resolved offers behind a booking (picks + the sets they came from). The Hiccup Handler
 *  uses this to know what the disrupted component actually was, without re-deriving it. */
export function cachedOffers(bookingId: string): { flight?: Offer; stay?: Offer; flights?: Offer[]; stays?: Offer[] } | undefined {
  return offerCache.get(bookingId);
}

function audit(b: Booking, actor: Booking["audit"][number]["actor"], action: string, detail?: string) {
  b.audit.push({ ts: new Date().toISOString(), actor, action, detail });
}

export interface CreateBookingInput {
  brief: Brief;
  accountId?: string;
  flightId?: string;
  stayId?: string;
  idempotencyKey?: string;
  /** Tures concierge fee to collect with this booking (per-trip pricing; 0 for subscribers). */
  feeUsd?: number;
  /** Adaptive Trip Watch — pass-through metered monitoring (opt-in). */
  tripWatch?: { enabled: boolean; capUsd?: number };
}

export async function createBooking(tripId: string, input: CreateBookingInput): Promise<Booking> {
  // Idempotency: same key → same booking, never a second one.
  if (input.idempotencyKey) {
    const existing = bookings.getByIdemKey(input.idempotencyKey);
    if (existing) return existing;
  }

  const accountId = input.accountId ?? "demo";
  const supplier = getSupplier();
  const { flights, stays } = await runSearch(tripId, input.brief, accountId); // emits search + score
  const flight = (input.flightId && flights.find((o) => o.id === input.flightId)) || flights[0];
  const stay = (input.stayId && stays.find((o) => o.id === input.stayId)) || stays[0];
  const totalUsd = (flight?.priceUsd ?? 0) + (stay?.priceUsd ?? 0);
  const currency = flight?.currency ?? stay?.currency ?? "USD";

  const violations = checkPolicy({ accountId, brief: input.brief, flight, stay, totalUsd, supplier });

  const now = new Date().toISOString();
  const components: BookedComponent[] = [];
  if (flight) components.push({ kind: "flight", offerId: flight.id, supplier: flight.supplier, title: flight.title, amountUsd: flight.priceUsd, status: "pending" });
  if (stay) components.push({ kind: "stay", offerId: stay.id, supplier: stay.supplier, title: stay.title, amountUsd: stay.priceUsd, status: "pending" });

  const booking: Booking = {
    id: nextBookingId(),
    tripId,
    accountId,
    brief: input.brief,
    status: violations.length ? "failed" : "confirmation_required",
    totalUsd,
    currency,
    components,
    charges: [],
    feeUsd: input.feeUsd && input.feeUsd > 0 ? input.feeUsd : undefined,
    passenger: await passengerSummary(accountId),
    violations,
    audit: [],
    idempotencyKey: input.idempotencyKey,
    watch: input.tripWatch?.enabled ? { requested: true, capUsd: input.tripWatch.capUsd } : undefined,
    createdAt: now,
    updatedAt: now,
  };
  offerCache.set(booking.id, { flight, stay, flights, stays });
  audit(booking, "agent", "booking_created", `${components.map((c) => c.title).join(" + ")} · $${totalUsd.toLocaleString()}`);

  if (violations.length) {
    audit(booking, "system", "policy_blocked", violations.join("; "));
    emitEvent(tripId, "error", "Booking blocked by policy", { detail: violations.join("; ") });
    return bookings.put(booking);
  }

  // Auto-book only when the brief explicitly authorizes it; otherwise open the gate.
  if (canAutoBook(input.brief, violations)) {
    audit(booking, "system", "auto_book", "bookingMode=auto_within_brief, within brief");
    bookings.put(booking);
    return execute(booking);
  }

  audit(booking, "agent", "awaiting_confirmation", "human-confirm gate opened — no money moved");
  emitEvent(tripId, "confirm", "Awaiting your confirmation", {
    detail: `${components.map((c) => c.title).join(" + ")} · $${totalUsd.toLocaleString()} — nothing charged yet`,
    data: { bookingId: booking.id, totalUsd },
  });
  return bookings.put(booking);
}

export async function confirmBooking(id: string): Promise<Booking | null> {
  const booking = bookings.get(id);
  if (!booking) return null;
  // Idempotent: a finished or failed booking is returned as-is — never charged twice.
  if (booking.status === "booked" || booking.status === "failed" || booking.status === "booking") {
    return booking;
  }
  audit(booking, "user", "confirmed", "user approved the booking");
  return execute(booking);
}

/** Charge, then commit each component with the supplier. Flips to booked or failed. */
async function execute(booking: Booking): Promise<Booking> {
  booking.status = "booking";
  bookings.put(booking);
  const supplier = getSupplier();
  const payments = getPayments();
  const offers = offerCache.get(booking.id) ?? {};

  try {
    const baseIdem = booking.idempotencyKey ?? booking.id;
    // Loyalty: reveal the profile once, then credit each leg to its matching carrier/chain program.
    const credit = await loyaltyCrediter(booking.accountId);

    // For each component: pick the best card for that charge type, charge it, then book it.
    for (const c of booking.components) {
      const offer = c.kind === "flight" ? offers.flight : offers.stay;
      if (!offer) throw new Error(`no offer to book for ${c.kind} (${c.offerId})`);

      // 1. Wallet: choose the best card for this charge category (airfare vs hotel earn differently).
      const choice = chooseCard(booking.accountId, { category: categoryForKind(c.kind), amountUsd: c.amountUsd });
      if (choice) {
        c.card = { connectionId: choice.connectionId, key: choice.key, name: choice.name, last4: choice.last4, reason: choice.reason };
        audit(booking, "agent", "card_selected", `${c.title}: ${choice.reason}`);
      }

      // 2. Charge that card (per-component idempotency key → no double charge on retry).
      const pay = await payments.charge(c.amountUsd, booking.currency, `${baseIdem}:${c.kind}`, { accountId: booking.accountId, connectionId: choice?.connectionId });
      c.payment = pay;
      booking.charges.push(pay);
      audit(booking, "system", "payment_charged", `${c.title}: ${pay.provider} ${pay.intentId} · $${c.amountUsd.toLocaleString()}${c.card ? ` on ${c.card.name}` : ""}`);
      emitEvent(booking.tripId, "book", `Charged $${c.amountUsd.toLocaleString()} for ${c.title}`, { detail: c.card ? c.card.reason : pay.provider, data: { bookingId: booking.id } });

      // 3. Commit the order. A REAL order is placed only when live booking is explicitly enabled
      //    AND the supplier can place one; otherwise the order is SIMULATED — the offer came from
      //    real (or mock) search, but no order is sent to any supplier and no money moves.
      if (!isSimulatedBooking() && supplier.book) {
        const { confirmation } = await supplier.book(offer);
        c.confirmation = confirmation;
      } else {
        c.confirmation = simulatedConfirmation(c.kind, offer.id);
        c.simulated = true;
      }
      c.status = "confirmed";
      const verb = c.simulated ? "Simulated" : "Booked";
      audit(booking, "agent", c.simulated ? "component_simulated" : "component_booked", `${c.title} → ${c.confirmation}`);
      emitEvent(booking.tripId, "book", `${verb} ${c.title}`, { detail: c.confirmation, data: { bookingId: booking.id, confirmation: c.confirmation, simulated: !!c.simulated } });

      // 4. Loyalty: credit the matching airline/hotel program for this leg, with estimated accrual.
      const loyalty = credit({ kind: c.kind, supplier: c.supplier, title: c.title, amountUsd: c.amountUsd });
      if (loyalty) {
        c.loyalty = loyalty;
        audit(booking, "agent", "loyalty_credited", `${c.title}: ${loyalty.reason}`);
        emitEvent(booking.tripId, "book", `Credited ${loyalty.program}`, { detail: loyalty.reason, data: { bookingId: booking.id } });
      }
      bookings.put(booking);
    }

    // Tures concierge fee (per-trip pricing). Charged to the best card alongside the trip.
    if (booking.feeUsd && booking.feeUsd > 0) {
      const choice = chooseCard(booking.accountId, { category: "other", amountUsd: booking.feeUsd });
      const feePay = await payments.charge(booking.feeUsd, booking.currency, `${booking.idempotencyKey ?? booking.id}:fee`, { accountId: booking.accountId, connectionId: choice?.connectionId });
      booking.charges.push(feePay);
      audit(booking, "system", "concierge_fee", `$${booking.feeUsd} Tures fee · ${feePay.provider} ${feePay.intentId}`);
    }

    // Taste: what a traveler actually CONFIRMS is the truest signal there is. Learn from each
    // component against the alternatives it beat. Never allowed to fail a booking — observe()
    // swallows its own errors and a uninformative choice simply teaches nothing.
    for (const c of booking.components) {
      const chosen = c.kind === "flight" ? offers.flight : offers.stay;
      const field = (c.kind === "flight" ? offers.flights : offers.stays) ?? [];
      if (!chosen) continue;
      observeTaste(booking.accountId, { type: "booked", chosen, rejected: field.filter((o) => o.id !== chosen.id).slice(0, 8) });
    }

    booking.status = "booked";
    const anySim = booking.components.some((c) => c.simulated);
    audit(booking, "system", "booked", anySim ? "all components confirmed (simulated)" : "all components confirmed");
    emitEvent(booking.tripId, "notify", anySim ? "Trip booked (simulated)" : "Trip booked", { detail: `${booking.components.length} components · $${booking.totalUsd.toLocaleString()}${anySim ? " · sample confirmations, no money moved" : ""}`, data: { bookingId: booking.id, simulated: anySim } });
    if (booking.accountId && booking.accountId !== "demo") {
      const dest = booking.brief.destination || "trip";
      const legs = booking.components.map((c) => c.title).filter(Boolean).slice(0, 4).join(", ");
      void remember(booking.accountId, [
        { role: "user", content: `Booked ${dest}` },
        { role: "assistant", content: `Confirmed ${legs || "trip components"}. Total $${booking.totalUsd.toLocaleString()}${anySim ? " (sample booking)" : ""}.` },
      ]);
    }
    if (booking.watch?.requested) {
      void enableTripWatch(booking.id, { capUsd: booking.watch.capUsd }).catch((e) =>
        log.warn("trip watch enable failed", { bookingId: booking.id, err: String(e) }),
      );
    } else if (getUser(booking.accountId)?.plan === "subscribe") {
      void enableTripWatch(booking.id, {}).catch((e) =>
        log.warn("trip watch enable failed (concierge)", { bookingId: booking.id, err: String(e) }),
      );
    }
  } catch (e) {
    booking.status = "failed";
    booking.violations.push(String(e));
    audit(booking, "system", "booking_failed", String(e));
    emitEvent(booking.tripId, "error", "Booking failed", { detail: String(e), data: { bookingId: booking.id } });
    log.error("booking execute failed", { bookingId: booking.id, err: String(e) });
  }

  return bookings.put(booking);
}
