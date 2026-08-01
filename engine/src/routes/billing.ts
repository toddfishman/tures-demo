import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { startSubscription, handleWebhook, createSetupIntent, saveCard } from "../billing/index.ts";
import { resolveAccountId } from "../auth/index.ts";

export async function billingRoutes(app: FastifyInstance) {
  // POST /billing/checkout — begin a subscription; returns { url } to redirect the browser to.
  app.post("/billing/checkout", async (req: any, reply) => {
    const accountId = resolveAccountId(req, (req.body || {}).accountId);
    if (accountId === "demo") return reply.status(401).send({ error: "sign_in_required" });
    const interval = (req.body?.interval === "yearly" ? "yearly" : "monthly") as "monthly" | "yearly";
    return startSubscription(accountId, interval);
  });

  // POST /billing/setup-intent — start collecting a real card (Stripe Elements client secret).
  app.post("/billing/setup-intent", async (req: any, reply) => {
    const accountId = resolveAccountId(req);
    if (accountId === "demo") return reply.status(401).send({ error: "sign_in_required" });
    try {
      return await createSetupIntent(accountId);
    } catch (e: any) {
      return reply.status(e?.statusCode ?? 500).send({ error: String(e?.message ?? e) });
    }
  });

  // POST /billing/save-card — store the confirmed Stripe payment method in the vault.
  const SaveCard = z.object({ paymentMethodId: z.string(), label: z.string().default("Card"), cardKey: z.string().optional(), last4: z.string().optional() });
  app.post("/billing/save-card", async (req: any, reply) => {
    const accountId = resolveAccountId(req);
    if (accountId === "demo") return reply.status(401).send({ error: "sign_in_required" });
    const p = SaveCard.safeParse(req.body);
    if (!p.success) return reply.status(400).send({ error: "invalid_request" });
    try {
      return await saveCard(accountId, p.data.paymentMethodId, p.data.label, p.data.cardKey, p.data.last4);
    } catch (e: any) {
      return reply.status(e?.statusCode ?? 500).send({ error: String(e?.message ?? e) });
    }
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
