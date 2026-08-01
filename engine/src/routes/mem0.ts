import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveAccountId } from "../auth/index.ts";
import { listSessionTranscript, listUserSessions } from "../conversation-log.ts";
import { listTranscriptMemories, mergeMem0, mem0Enabled } from "../mem0.ts";

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

  // GET /mem0/transcript?sessionId=… — verbatim turns for ops tracing (engine audit log first).
  app.get("/mem0/transcript", async (req, reply) => {
    const q = z
      .object({
        sessionId: z.string().min(1),
        userId: z.string().optional(),
      })
      .safeParse(req.query);
    if (!q.success) return reply.status(400).send({ error: "invalid_request", hint: "sessionId required" });

    const local = listSessionTranscript(q.data.sessionId);
    const userId = q.data.userId || local[0]?.userId;
    const mem0 = userId ? await listTranscriptMemories(userId, q.data.sessionId) : [];

    return {
      sessionId: q.data.sessionId,
      userId,
      source: "engine-audit-log",
      turns: local.map((t) => ({
        ts: t.ts,
        role: t.role,
        content: t.content,
        via: t.via,
        ready: t.ready,
      })),
      mem0Transcript: mem0,
    };
  });

  // GET /mem0/sessions?userId=… — recent chat sessions for a traveler (audit log).
  app.get("/mem0/sessions", async (req, reply) => {
    const q = z.object({ userId: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.status(400).send({ error: "invalid_request", hint: "userId required" });
    return { userId: q.data.userId, sessions: listUserSessions(q.data.userId) };
  });
}
