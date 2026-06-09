import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { handleDisruption } from "../hiccup/handler.ts";

const Body = z.object({
  bookingId: z.string(),
  kind: z.enum(["cancellation", "schedule_change", "delay"]).default("cancellation"),
  detail: z.string().optional(),
});

export async function disruptionRoutes(app: FastifyInstance) {
  // POST /disruptions — report a disruption on a booked trip. The Hiccup Handler auto-rebooks
  // within the brief's standing authority, or proposes the fix. Streams hiccup events.
  app.post("/disruptions", async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const result = await handleDisruption(parsed.data.bookingId, { kind: parsed.data.kind, detail: parsed.data.detail });
    if (!result) return reply.status(404).send({ error: "booking_not_found" });
    return result;
  });
}
