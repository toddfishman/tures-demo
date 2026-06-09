import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Collection } from "../db/persist.ts";
import { log } from "../logger.ts";

// Public early-access capture. Durable when DATA_DIR is set.
const emails = new Collection<{ name?: string; ts: string }>("waitlist");

const Body = z.object({ email: z.string().email(), name: z.string().optional() });

export async function waitlistRoutes(app: FastifyInstance) {
  app.post("/waitlist", async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_email" });
    const key = parsed.data.email.toLowerCase();
    const existed = emails.has(key);
    emails.set(key, { name: parsed.data.name, ts: new Date().toISOString() });
    const total = emails.values().length;
    log.info("waitlist signup", { email: parsed.data.email, total });
    return { ok: true, position: total, alreadyOnList: existed };
  });

  app.get("/waitlist/count", async () => ({ count: emails.values().length }));
}
