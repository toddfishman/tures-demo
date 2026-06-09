// Booking service — the safety spine. createBooking opens the human-confirm gate (or auto-books
// only when the brief explicitly allows it AND policy passes); confirmBooking executes the
// charge→order sequence exactly once (idempotent). Every step is appended to the audit log and
// emitted to the live execution stream.
import type { Brief, Offer } from "../types.ts";
import type { Booking, BookedComponent } from "./types.ts";
import { bookings, nextBookingId } from "./store.ts";
import { checkPolicy, canAutoBook } from "./policy.ts";
import { getPayments } from "./payments.ts";
import { getSupplier } from "../suppliers/index.ts";
import { runSearch } from "../search/service.ts";
import { emitEvent } from "../events/bus.ts";
import { log } from "../logger.ts";

// Resolved Offer objects kept out of the serialized Booking (supplier.book needs the full offer).
const offerCache = new Map<string, { flight?: Offer; stay?: Offer }>();

function audit(b: Booking, actor: Booking["audit"][number]["actor"], action: string, detail?: string) {
  b.audit.push({ ts: new Date().toISOString(), actor, action, detail });
}

export interface CreateBookingInput {
  brief: Brief;
  flightId?: string;
  stayId?: string;
  idempotencyKey?: string;
}

export async function createBooking(tripId: string, input: CreateBookingInput): Promise<Booking> {
  // Idempotency: same key → same booking, never a second one.
  if (input.idempotencyKey) {
    const existing = bookings.getByIdemKey(input.idempotencyKey);
    if (existing) return existing;
  }

  const supplier = getSupplier();
  const { flights, stays } = await runSearch(tripId, input.brief); // emits search + score
  const flight = (input.flightId && flights.find((o) => o.id === input.flightId)) || flights[0];
  const stay = (input.stayId && stays.find((o) => o.id === input.stayId)) || stays[0];
  const totalUsd = (flight?.priceUsd ?? 0) + (stay?.priceUsd ?? 0);
  const currency = flight?.currency ?? stay?.currency ?? "USD";

  const violations = checkPolicy({ brief: input.brief, flight, stay, totalUsd, supplier });

  const now = new Date().toISOString();
  const components: BookedComponent[] = [];
  if (flight) components.push({ kind: "flight", offerId: flight.id, supplier: flight.supplier, title: flight.title, amountUsd: flight.priceUsd, status: "pending" });
  if (stay) components.push({ kind: "stay", offerId: stay.id, supplier: stay.supplier, title: stay.title, amountUsd: stay.priceUsd, status: "pending" });

  const booking: Booking = {
    id: nextBookingId(),
    tripId,
    brief: input.brief,
    status: violations.length ? "failed" : "confirmation_required",
    totalUsd,
    currency,
    components,
    violations,
    audit: [],
    idempotencyKey: input.idempotencyKey,
    createdAt: now,
    updatedAt: now,
  };
  offerCache.set(booking.id, { flight, stay });
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
    // 1. Charge — idempotency key bound to the booking so a retry never double-charges.
    const idemKey = booking.idempotencyKey ?? booking.id;
    booking.payment = await payments.charge(booking.totalUsd, booking.currency, idemKey);
    audit(booking, "system", "payment_charged", `${booking.payment.provider} ${booking.payment.intentId} · $${booking.totalUsd.toLocaleString()} · ${booking.payment.status}`);
    emitEvent(booking.tripId, "book", "Payment authorized", { detail: `${booking.payment.provider} · $${booking.totalUsd.toLocaleString()}`, data: { bookingId: booking.id } });

    // 2. Commit each component with the supplier.
    for (const c of booking.components) {
      const offer = c.kind === "flight" ? offers.flight : offers.stay;
      if (!offer || !supplier.book) throw new Error(`cannot book ${c.kind} (${c.offerId})`);
      const { confirmation } = await supplier.book(offer);
      c.confirmation = confirmation;
      c.status = "confirmed";
      audit(booking, "agent", "component_booked", `${c.title} → ${confirmation}`);
      emitEvent(booking.tripId, "book", `Booked ${c.title}`, { detail: confirmation, data: { bookingId: booking.id, confirmation } });
      bookings.put(booking);
    }

    booking.status = "booked";
    audit(booking, "system", "booked", "all components confirmed");
    emitEvent(booking.tripId, "notify", "Trip booked", { detail: `${booking.components.length} components · $${booking.totalUsd.toLocaleString()}`, data: { bookingId: booking.id } });
  } catch (e) {
    booking.status = "failed";
    booking.violations.push(String(e));
    audit(booking, "system", "booking_failed", String(e));
    emitEvent(booking.tripId, "error", "Booking failed", { detail: String(e), data: { bookingId: booking.id } });
    log.error("booking execute failed", { bookingId: booking.id, err: String(e) });
  }

  return bookings.put(booking);
}
