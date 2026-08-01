import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PrefsSchema, getPrefs, setPrefs } from "../profile/prefs.ts";
import { resolveAccountId } from "../auth/index.ts";

const Body = z.object({ accountId: z.string().optional(), prefs: PrefsSchema.partial() });

export async function prefsRoutes(app: FastifyInstance) {
  // POST /prefs — merge standing preferences (Taste Print, cabin default, avoid, dietary).
  app.post("/prefs", async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", issues: parsed.error.issues });
    return { prefs: setPrefs(resolveAccountId(req, parsed.data.accountId), parsed.data.prefs) };
  });

  // GET /prefs?accountId=demo — the account's standing preferences.
  app.get<{ Querystring: { accountId?: string } }>("/prefs", async (req) => {
    return { prefs: getPrefs(resolveAccountId(req, req.query.accountId)) };
  });
}
