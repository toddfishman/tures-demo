import type { FastifyInstance } from "fastify";
import { CompanionSchema, addTraveler, listTravelers, removeTraveler } from "../profile/index.ts";
import { resolveAccountId } from "../auth/index.ts";

export async function travelerRoutes(app: FastifyInstance) {
  // POST /travelers — add a family member / companion (PII tokenized like your own).
  app.post("/travelers", async (req, reply) => {
    const p = CompanionSchema.safeParse((req.body as any)?.traveler ?? req.body);
    if (!p.success) return reply.status(400).send({ error: "invalid_request", issues: p.error.issues });
    return addTraveler(resolveAccountId(req), p.data);
  });

  // GET /travelers — list the account's additional travelers (masked).
  app.get("/travelers", async (req) => ({ travelers: listTravelers(resolveAccountId(req)) }));

  // DELETE /travelers/:id — remove a traveler.
  app.delete<{ Params: { id: string } }>("/travelers/:id", async (req, reply) => {
    const ok = removeTraveler(resolveAccountId(req), req.params.id);
    if (!ok) return reply.status(404).send({ error: "not_found" });
    return { ok: true };
  });
}
