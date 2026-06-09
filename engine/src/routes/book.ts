import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BriefSchema } from "../types.ts";
import { createBooking, confirmBooking } from "../booking/service.ts";
import { bookings } from "../booking/store.ts";

const BookBody = z.object({
  brief: BriefSchema,
  accountId: z.string().optional(),
  flightId: z.string().optional(),
  stayId: z.string().optional(),
  idempotencyKey: z.string().min(8).optional(),
});

let tripCounter = 0;

export async function bookRoutes(app: FastifyInstance) {
  // POST /book — open a booking. Default brief.bookingMode (confirm_each) returns
  // status "confirmation_required" and charges NOTHING; auto_within_brief executes immediately.
  app.post("/book", async (req, reply) => {
    const parsed = BookBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_request", issues: parsed.error.issues });
    }
    const tripId = `trip_${Date.now().toString(36)}_b${tripCounter++}`;
    const booking = await createBooking(tripId, parsed.data);
    if (booking.status === "failed" && booking.components.every((c) => c.status === "pending")) {
      // Blocked at the policy gate before any money moved.
      return reply.status(409).send(booking);
    }
    return booking;
  });

  // POST /book/:id/confirm — the human-confirm gate. Idempotent: confirming a booked booking
  // returns it unchanged (no second charge).
  app.post<{ Params: { id: string } }>("/book/:id/confirm", async (req, reply) => {
    const booking = await confirmBooking(req.params.id);
    if (!booking) return reply.status(404).send({ error: "not_found" });
    return booking;
  });

  // GET /book/:id — booking status + full audit trail.
  app.get<{ Params: { id: string } }>("/book/:id", async (req, reply) => {
    const booking = bookings.get(req.params.id);
    if (!booking) return reply.status(404).send({ error: "not_found" });
    return booking;
  });

  // GET /bookings?accountId=… — an account's trips (newest first) for the dashboard.
  app.get<{ Querystring: { accountId?: string } }>("/bookings", async (req) => {
    return { bookings: bookings.listByAccount(req.query.accountId ?? "demo") };
  });
}
