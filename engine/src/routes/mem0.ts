import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveAccountId } from "../auth/index.ts";
import { mergeMem0, mem0Enabled } from "../mem0.ts";

export async function mem0Routes(app: FastifyInstance) {
  // POST /mem0/merge — copy guest-id memories into the signed-in account (one-time on login).
  app.post("/mem0/merge", async (req, reply) => {
    const accountId = resolveAccountId(req);
    if (accountId === "demo") return reply.status(401).send({ error: "not_signed_in" });

    const p = z.object({ fromUserId: z.string().min(1) }).safeParse(req.body);
    if (!p.success) return reply.status(400).send({ error: "invalid_request" });

    const from = p.data.fromUserId;
    if (!from.startsWith("guest-")) return reply.status(400).send({ error: "invalid_guest_id" });
    if (from === accountId) return { merged: 0, enabled: mem0Enabled() };

    const merged = await mergeMem0(from, accountId);
    return { merged, enabled: mem0Enabled() };
  });
}
