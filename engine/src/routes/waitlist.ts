import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { log } from "../logger.ts";

// In-memory waitlist. Public capture for early access. Durable storage is a Chunk-6b follow-up
// (point this at Postgres/Redis or an email tool); for now it logs + counts in-process.
const emails = new Map<string, { name?: string; ts: string }>();

const Body = z.object({ email: z.string().email(), name: z.string().optional() });

export async function waitlistRoutes(app: FastifyInstance) {
  app.post("/waitlist", async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_email" });
    const existed = emails.has(parsed.data.email.toLowerCase());
    emails.set(parsed.data.email.toLowerCase(), { name: parsed.data.name, ts: new Date().toISOString() });
    log.info("waitlist signup", { email: parsed.data.email, total: emails.size });
    return { ok: true, position: emails.size, alreadyOnList: existed };
  });

  app.get("/waitlist/count", async () => ({ count: emails.size }));
}
