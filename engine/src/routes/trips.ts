import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BriefSchema } from "../types.ts";
import { resolveAccountId, actsFor } from "../auth/index.ts";
import { perTripFee } from "../billing/fees.ts";
import { bookings } from "../booking/store.ts";
import { parseImportItinerary } from "../import/parse.ts";
import {
  createImportBooking,
  updateImportBooking,
  confirmImportBooking,
  importGapsFromBooking,
} from "../import/service.ts";

const LegSchema = z.object({
  kind: z.enum(["flight", "stay", "dining", "activity", "transport"]),
  title: z.string().min(2),
  supplier: z.string().default("Unknown"),
  detail: z.string().optional(),
  confirmation: z.string().optional(),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  sourceHint: z.string().optional(),
  schedule: z.string().optional(),
  amountUsd: z.number().nonnegative().optional(),
});

const ImportBody = z.object({
  text: z.string().min(2),
  heuristic: z.boolean().optional(),
  idempotencyKey: z.string().min(8).optional(),
  tripWatch: z.object({ enabled: z.boolean(), capUsd: z.number().positive().max(100).optional() }).optional(),
  /** Skip re-parse and use client-reviewed legs + brief (after first parse). */
  brief: BriefSchema.optional(),
  legs: z.array(LegSchema).optional(),
});

const UpdateBody = z.object({
  brief: BriefSchema.optional(),
  legs: z.array(LegSchema).optional(),
  tripWatch: z.object({ enabled: z.boolean(), capUsd: z.number().positive().max(100).optional() }).optional(),
});

const ConfirmBody = z.object({
  tripWatch: z.object({ enabled: z.boolean(), capUsd: z.number().positive().max(100).optional() }).optional(),
});

let tripCounter = 0;

function requireAccount(req: any, reply: any): string | null {
  const accountId = resolveAccountId(req);
  if (accountId === "demo") {
    reply.status(401).send({ error: "sign_in_required" });
    return null;
  }
  return accountId;
}

function enrichImportResponse(booking: import("../booking/types.ts").Booking) {
  return {
    booking,
    gaps: importGapsFromBooking(booking),
    feeUsd: booking.feeUsd ?? 0,
    mode: "alert_and_guide" as const,
  };
}

export async function tripsRoutes(app: FastifyInstance) {
  // POST /trips/import — parse pasted itinerary and open the review gate.
  app.post("/trips/import", async (req, reply) => {
    const accountId = requireAccount(req, reply);
    if (!accountId) return;

    const parsed = ImportBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", issues: parsed.error.issues });

    const tripId = `trip_${Date.now().toString(36)}_i${tripCounter++}`;
    let brief = parsed.data.brief;
    let legs = parsed.data.legs;
    let assumptions: string[] = [];
    let via: "agent" | "heuristic" = "heuristic";

    if (!brief || !legs) {
      const result = await parseImportItinerary(parsed.data.text, { heuristic: parsed.data.heuristic });
      brief = brief ?? result.brief;
      legs = legs ?? result.legs;
      assumptions = result.assumptions;
      via = result.via;
    }

    const booking = await createImportBooking(tripId, {
      accountId,
      brief: brief!,
      legs: legs!,
      idempotencyKey: parsed.data.idempotencyKey,
      feeUsd: perTripFee(accountId),
      tripWatch: parsed.data.tripWatch ?? { enabled: true },
    });

    if (booking.status === "failed" && !booking.components.length) {
      return reply.status(409).send({ ...enrichImportResponse(booking), assumptions, via });
    }

    return { ...enrichImportResponse(booking), assumptions, via };
  });

  // PATCH /trips/import/:id — edit legs/brief before confirm.
  app.patch<{ Params: { id: string } }>("/trips/import/:id", async (req, reply) => {
    const accountId = requireAccount(req, reply);
    if (!accountId) return;

    const existing = bookings.get(req.params.id);
    if (!existing || existing.source !== "import" || !actsFor(req, existing.accountId)) {
      return reply.status(404).send({ error: "not_found" });
    }

    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", issues: parsed.error.issues });

    const booking = await updateImportBooking(req.params.id, parsed.data);
    if (!booking) return reply.status(404).send({ error: "not_found" });
    return enrichImportResponse(booking);
  });

  // POST /trips/import/:id/confirm — charge fee (if any) and enable watch.
  app.post<{ Params: { id: string } }>("/trips/import/:id/confirm", async (req, reply) => {
    const accountId = requireAccount(req, reply);
    if (!accountId) return;

    const existing = bookings.get(req.params.id);
    if (!existing || existing.source !== "import" || !actsFor(req, existing.accountId)) {
      return reply.status(404).send({ error: "not_found" });
    }

    const parsed = ConfirmBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", issues: parsed.error.issues });

    const booking = await confirmImportBooking(req.params.id, {
      tripWatch: parsed.data.tripWatch ?? { enabled: true, capUsd: existing.watch?.capUsd },
    });
    if (!booking) return reply.status(404).send({ error: "not_found" });
    if (booking.status === "failed") return reply.status(409).send(enrichImportResponse(booking));
    return enrichImportResponse(booking);
  });

  // GET /trips/import/:id — review state (owner only).
  app.get<{ Params: { id: string } }>("/trips/import/:id", async (req, reply) => {
    const booking = bookings.get(req.params.id);
    if (!booking || booking.source !== "import" || !actsFor(req, booking.accountId)) {
      return reply.status(404).send({ error: "not_found" });
    }
    return enrichImportResponse(booking);
  });
}
