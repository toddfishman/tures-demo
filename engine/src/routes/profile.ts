import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TravelerProfileSchema, setTravelerProfile, getTravelerProfileRedacted } from "../profile/index.ts";
import { resolveAccountId } from "../auth/index.ts";

const Body = z.object({ accountId: z.string().optional(), profile: TravelerProfileSchema });

export async function profileRoutes(app: FastifyInstance) {
  // POST /profile — save passport / KTN / memberships (encrypted at rest). Response is redacted.
  app.post("/profile", async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", issues: parsed.error.issues });
    return setTravelerProfile(resolveAccountId(req, parsed.data.accountId), parsed.data.profile);
  });

  // GET /profile?accountId=demo — redacted profile (masked passport/KTN, membership list).
  app.get<{ Querystring: { accountId?: string } }>("/profile", async (req, reply) => {
    const p = getTravelerProfileRedacted(resolveAccountId(req, req.query.accountId));
    if (!p) return reply.status(404).send({ error: "no_profile" });
    return p;
  });
}
