// Concierge Mode — import an externally booked trip, confirm structure, charge fee only, enable watch.
import type { Brief } from "../types.ts";
import type { Booking, BookedComponent } from "../booking/types.ts";
import { bookings, nextBookingId } from "../booking/store.ts";
import { getPayments } from "../booking/payments.ts";
import { emitEvent } from "../events/bus.ts";
import { log } from "../logger.ts";
import { remember } from "../mem0.ts";
import { enableTripWatch } from "../watch/service.ts";
import { getUser } from "../auth/index.ts";
import { hasScope } from "../vault/index.ts";
import { chooseCard } from "../wallet/cards.ts";
import { passengerSummary } from "../profile/index.ts";
import type { ImportLeg } from "./types.ts";

function audit(b: Booking, actor: Booking["audit"][number]["actor"], action: string, detail?: string) {
  b.audit.push({ ts: new Date().toISOString(), actor, action, detail });
}

function legsToComponents(legs: ImportLeg[]): BookedComponent[] {
  return legs.map((leg, i) => ({
    kind: leg.kind,
    offerId: `import_${leg.kind}_${i}_${leg.title.slice(0, 12).replace(/\W/g, "")}`,
    supplier: leg.supplier,
    title: leg.title,
    amountUsd: leg.amountUsd ?? 0,
    confirmation: leg.confirmation,
    status: "pending" as const,
    importMeta: {
      confidence: leg.confidence,
      sourceHint: leg.sourceHint,
      detail: leg.detail,
      schedule: leg.schedule,
    },
  }));
}

function importViolations(accountId: string, legs: ImportLeg[], feeUsd: number): string[] {
  const v: string[] = [];
  if (!legs.length) v.push("no legs to watch — add at least one flight or hotel");
  if (feeUsd > 0 && !hasScope(accountId, "payment:charge")) {
    v.push("no payment method connected (grant payment:charge by connecting a card)");
  }
  return v;
}

export interface CreateImportInput {
  accountId: string;
  brief: Brief;
  legs: ImportLeg[];
  idempotencyKey?: string;
  feeUsd?: number;
  tripWatch?: { enabled: boolean; capUsd?: number };
}

export async function createImportBooking(tripId: string, input: CreateImportInput): Promise<Booking> {
  if (input.idempotencyKey) {
    const existing = bookings.getByIdemKey(input.idempotencyKey);
    if (existing) return existing;
  }

  const brief: Brief = {
    ...input.brief,
    bookingMode: "propose_only",
    rebooking: { mode: "propose" },
  };
  const components = legsToComponents(input.legs);
  const totalUsd = components.reduce((s, c) => s + c.amountUsd, 0);
  const violations = importViolations(input.accountId, input.legs, input.feeUsd ?? 0);
  const now = new Date().toISOString();

  const booking: Booking = {
    id: nextBookingId(),
    tripId,
    accountId: input.accountId,
    brief,
    source: "import",
    status: violations.length ? "failed" : "confirmation_required",
    totalUsd,
    currency: "USD",
    components,
    charges: [],
    feeUsd: input.feeUsd && input.feeUsd > 0 ? input.feeUsd : undefined,
    passenger: await passengerSummary(input.accountId),
    violations,
    audit: [],
    idempotencyKey: input.idempotencyKey,
    watch: input.tripWatch?.enabled ? { requested: true, capUsd: input.tripWatch.capUsd } : undefined,
    createdAt: now,
    updatedAt: now,
  };

  audit(booking, "agent", "import_created", `${components.length} legs · ${brief.destination}`);
  if (violations.length) {
    audit(booking, "system", "import_blocked", violations.join("; "));
    return bookings.put(booking);
  }
  audit(booking, "agent", "awaiting_confirmation", "review legs before watch turns on — no money moved");
  emitEvent(tripId, "confirm", "Review your imported trip", {
    detail: `${components.length} legs — confirm before watch activates`,
    data: { bookingId: booking.id, source: "import" },
  });
  return bookings.put(booking);
}

export interface UpdateImportInput {
  brief?: Brief;
  legs?: ImportLeg[];
  tripWatch?: { enabled: boolean; capUsd?: number };
}

export async function updateImportBooking(id: string, input: UpdateImportInput): Promise<Booking | null> {
  const booking = bookings.get(id);
  if (!booking || booking.source !== "import" || booking.status !== "confirmation_required") return null;

  if (input.brief) {
    booking.brief = {
      ...input.brief,
      bookingMode: "propose_only",
      rebooking: { mode: "propose" },
    };
  }
  if (input.legs) {
    booking.components = legsToComponents(input.legs);
    booking.totalUsd = booking.components.reduce((s, c) => s + c.amountUsd, 0);
  }
  if (input.tripWatch !== undefined) {
    booking.watch = input.tripWatch.enabled ? { requested: true, capUsd: input.tripWatch.capUsd } : undefined;
  }

  booking.violations = importViolations(booking.accountId, componentsToLegs(booking.components), booking.feeUsd ?? 0);
  booking.status = booking.violations.length ? "failed" : "confirmation_required";
  audit(booking, "user", "import_updated", `${booking.components.length} legs`);
  return bookings.put(booking);
}

function componentsToLegs(components: BookedComponent[]): ImportLeg[] {
  return components.map((c) => ({
    kind: c.kind,
    title: c.title,
    supplier: c.supplier,
    detail: c.importMeta?.detail,
    confirmation: c.confirmation,
    confidence: c.importMeta?.confidence ?? "medium",
    sourceHint: c.importMeta?.sourceHint,
    schedule: c.importMeta?.schedule,
    amountUsd: c.amountUsd,
  }));
}

export async function confirmImportBooking(
  id: string,
  opts?: { tripWatch?: { enabled: boolean; capUsd?: number } },
): Promise<Booking | null> {
  const booking = bookings.get(id);
  if (!booking || booking.source !== "import") return null;
  if (booking.status === "booked" || booking.status === "failed" || booking.status === "booking") {
    return booking;
  }

  if (opts?.tripWatch !== undefined) {
    booking.watch = opts.tripWatch.enabled ? { requested: true, capUsd: opts.tripWatch.capUsd } : undefined;
  }

  const violations = importViolations(booking.accountId, componentsToLegs(booking.components), booking.feeUsd ?? 0);
  if (violations.length) {
    booking.violations = violations;
    booking.status = "failed";
    audit(booking, "system", "import_blocked", violations.join("; "));
    return bookings.put(booking);
  }

  audit(booking, "user", "import_confirmed", "user activated watch on imported trip");
  booking.status = "booking";
  bookings.put(booking);

  const payments = getPayments();
  try {
    for (const c of booking.components) {
      c.status = "confirmed";
      audit(booking, "agent", "import_leg_confirmed", `${c.title}${c.confirmation ? ` · ${c.confirmation}` : ""}`);
    }

    if (booking.feeUsd && booking.feeUsd > 0) {
      const choice = chooseCard(booking.accountId, { category: "other", amountUsd: booking.feeUsd });
      const feePay = await payments.charge(
        booking.feeUsd,
        booking.currency,
        `${booking.idempotencyKey ?? booking.id}:import:fee`,
        { accountId: booking.accountId, connectionId: choice?.connectionId },
      );
      booking.charges.push(feePay);
      audit(booking, "system", "concierge_fee", `$${booking.feeUsd} Tures fee · ${feePay.provider} ${feePay.intentId}`);
    }

    booking.status = "booked";
    audit(booking, "system", "import_active", "watch ready · alert + guide mode");
    emitEvent(booking.tripId, "notify", "Trip imported — watch on", {
      detail: `${booking.components.length} legs · alert & guide me`,
      data: { bookingId: booking.id, source: "import" },
    });

    if (booking.accountId && booking.accountId !== "demo") {
      const dest = booking.brief.destination || "trip";
      void remember(booking.accountId, [
        { role: "user", content: `Imported ${dest} for concierge watch` },
        { role: "assistant", content: `Watching ${booking.components.length} legs. I'll alert and guide — autonomous rebook applies when Tures books the trip.` },
      ]);
    }

    if (booking.watch?.requested) {
      void enableTripWatch(booking.id, { capUsd: booking.watch.capUsd }).catch((e) =>
        log.warn("trip watch enable failed (import)", { bookingId: booking.id, err: String(e) }),
      );
    } else if (getUser(booking.accountId)?.plan === "subscribe") {
      void enableTripWatch(booking.id, {}).catch((e) =>
        log.warn("trip watch enable failed (import concierge)", { bookingId: booking.id, err: String(e) }),
      );
    }
  } catch (e) {
    booking.status = "failed";
    booking.violations.push(String(e));
    audit(booking, "system", "import_failed", String(e));
    log.error("import confirm failed", { bookingId: booking.id, err: String(e) });
  }

  return bookings.put(booking);
}

/** Re-export for routes that need gap count on a stored booking. */
export function importGapsFromBooking(b: Booking): number {
  if (b.source !== "import") return 0;
  return componentsToLegs(b.components).filter((l) => {
    if (l.confidence === "low") return true;
    if ((l.kind === "flight" || l.kind === "stay") && !l.confirmation) return true;
    return false;
  }).length;
}
