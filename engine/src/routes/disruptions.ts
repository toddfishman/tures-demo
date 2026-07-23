// The Hiccup Handler's HTTP face.
//
//   POST /disruptions                     → report a disruption; triage decides what happens
//   GET  /disruptions/:bookingId          → the trip's proposals + hiccup history
//   POST /disruptions/proposals/:id/accept  → take a proposed fix (optionally a specific option)
//   POST /disruptions/proposals/:id/decline → leave it as is
//
// Every one of these can move money, so all four are ownership-checked and 404 on a mismatch so
// booking ids can't be probed.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { handleDisruption, acceptProposal, declineProposal, proposals } from "../hiccup/handler.ts";
import { DisruptionSchema } from "../hiccup/types.ts";
import { bookings } from "../booking/store.ts";
import { actsFor } from "../auth/index.ts";

const ReportBody = DisruptionSchema.extend({ bookingId: z.string() });
const AcceptBody = z.object({ offerId: z.string().optional() });
const DeclineBody = z.object({ note: z.string().max(300).optional() });

export async function disruptionRoutes(app: FastifyInstance) {
  // Report a disruption on a booked trip. The handler triages it, then monitors, proposes, or
  // auto-rebooks within the brief's standing authority. Streams hiccup events either way.
  app.post("/disruptions", async (req, reply) => {
    const parsed = ReportBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const { bookingId, ...disruption } = parsed.data;
    // Ownership: this can move money (auto-rebook fare difference) — only the booking's owner may
    // trigger it. 404 on a mismatch so booking ids can't be probed.
    const owner = bookings.get(bookingId);
    if (!owner || !actsFor(req, owner.accountId)) return reply.status(404).send({ error: "booking_not_found" });
    const result = await handleDisruption(bookingId, disruption);
    if (!result) return reply.status(404).send({ error: "booking_not_found" });
    return { ...result, proposals: proposals.pendingFor(bookingId) };
  });

  // What's open on this trip — so a phone, a browser tab and Telegram all see the same question.
  app.get<{ Params: { bookingId: string } }>("/disruptions/:bookingId", async (req, reply) => {
    const booking = bookings.get(req.params.bookingId);
    if (!booking || !actsFor(req, booking.accountId)) return reply.status(404).send({ error: "booking_not_found" });
    return {
      bookingId: booking.id,
      pending: proposals.pendingFor(booking.id),
      history: proposals.forBooking(booking.id).filter((p) => p.status !== "pending"),
      hiccups: booking.hiccups ?? [],
    };
  });

  app.post<{ Params: { id: string } }>("/disruptions/proposals/:id/accept", async (req, reply) => {
    const parsed = AcceptBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const p = proposals.get(req.params.id);
    if (!p || !actsFor(req, p.accountId)) return reply.status(404).send({ error: "proposal_not_found" });
    const result = await acceptProposal(p.id, parsed.data.offerId);
    if (!result) return reply.status(404).send({ error: "proposal_not_found" });
    return result;
  });

  app.post<{ Params: { id: string } }>("/disruptions/proposals/:id/decline", async (req, reply) => {
    const parsed = DeclineBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const p = proposals.get(req.params.id);
    if (!p || !actsFor(req, p.accountId)) return reply.status(404).send({ error: "proposal_not_found" });
    const declined = declineProposal(p.id, parsed.data.note);
    if (!declined) return reply.status(404).send({ error: "proposal_not_found" });
    return { proposal: declined };
  });
}
