import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { connect, list, revoke, connectionById } from "../vault/index.ts";
import { resolveAccountId, actsFor } from "../auth/index.ts";

const ConnectBody = z.object({
  accountId: z.string().optional(),
  kind: z.enum(["payment", "email", "calendar", "loyalty"]),
  label: z.string().min(1),
  // NOTE: `scopes` is intentionally NOT accepted from the client. Scopes are the authorization
  // boundary (hasScope gates payment:charge), so they are derived server-side from `kind`
  // (DEFAULT_SCOPES) — a client must not be able to self-grant a scope it didn't earn.
  secret: z.record(z.unknown()),
  meta: z.record(z.unknown()).optional(),
});

export async function connectionRoutes(app: FastifyInstance) {
  // POST /connections — connect a service. The secret is encrypted at rest; the response is
  // always redacted (no credential ever leaves the vault).
  app.post("/connections", async (req, reply) => {
    const parsed = ConnectBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_request", issues: parsed.error.issues });
    }
    return connect({ ...parsed.data, accountId: resolveAccountId(req, parsed.data.accountId) });
  });

  // GET /connections?accountId=demo — list connected services (redacted).
  app.get<{ Querystring: { accountId?: string } }>("/connections", async (req) => {
    return { connections: list(resolveAccountId(req, req.query.accountId)) };
  });

  // POST /connections/:id/revoke — pull the plug. Immediate for new actions. Owner only.
  app.post<{ Params: { id: string } }>("/connections/:id/revoke", async (req, reply) => {
    const existing = connectionById(req.params.id);
    if (!existing || !actsFor(req, existing.accountId)) return reply.status(404).send({ error: "not_found" });
    const c = revoke(req.params.id);
    if (!c) return reply.status(404).send({ error: "not_found" });
    return c;
  });
}
