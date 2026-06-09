import type { FastifyInstance } from "fastify";
import { startSubscription, handleWebhook } from "../billing/index.ts";
import { resolveAccountId } from "../auth/index.ts";

export async function billingRoutes(app: FastifyInstance) {
  // POST /billing/checkout — begin a subscription; returns { url } to redirect the browser to.
  app.post("/billing/checkout", async (req: any, reply) => {
    const accountId = resolveAccountId(req, (req.body || {}).accountId);
    if (accountId === "demo") return reply.status(401).send({ error: "sign_in_required" });
    return startSubscription(accountId);
  });

  // POST /billing/webhook — Stripe calls this. Needs the raw body for signature verification.
  app.post("/billing/webhook", { config: { rawBody: true } }, async (req: any, reply) => {
    try {
      const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
      const result = await handleWebhook(raw, req.headers["stripe-signature"]);
      return result;
    } catch (e: any) {
      return reply.status(e?.statusCode ?? 400).send({ error: String(e?.message ?? e) });
    }
  });
}
