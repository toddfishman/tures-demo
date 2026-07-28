// Marketing Agent HTTP surface. Create a campaign (research + on-brand creatives + brand check,
// stopping at the human-confirm gate), approve it to launch (simulated until MARKETING_LIVE),
// advance the loop, and pause/resume. Ownership-guarded like the rest of the engine: a campaign
// is reachable only by the account that created it (404 otherwise, so ids can't be enumerated).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveAccountId, actsFor } from "../auth/index.ts";
import { config } from "../config.ts";
import { campaigns } from "../marketing/store.ts";
import {
  createCampaign,
  approveCampaign,
  runCampaignLoop,
  pauseCampaign,
  resumeCampaign,
  marketingStatus,
} from "../marketing/service.ts";

export async function marketingRoutes(app: FastifyInstance) {
  app.get("/marketing/capabilities", async () => ({
    ...marketingStatus(),
    // The knobs a UI needs to render the create form + honesty labels.
    objectives: ["signups", "awareness", "bookings", "retention"],
    channels: ["meta", "google", "reddit", "x", "email"],
    modes: ["propose_only", "auto_within_budget"],
    note: config.marketing.live
      ? "Live spend is ON — a human approval is required before every launch."
      : "Simulated — launches are sample-labeled and no money moves.",
  }));

  app.get("/marketing", async (req) => {
    const accountId = resolveAccountId(req);
    return { campaigns: campaigns.listByAccount(accountId) };
  });

  const CreateBody = z.object({
    product: z.string().min(1).max(60).optional(),
    objective: z.enum(["signups", "awareness", "bookings", "retention"]).optional(),
    audience: z.string().max(500).optional(),
    budgetDailyUsd: z.number().positive().max(config.marketing.dailyBudgetCapUsd),
    mode: z.enum(["propose_only", "auto_within_budget"]).optional(),
    channel: z.enum(["meta", "google", "reddit", "x", "email"]).optional(),
  });
  app.post("/marketing", async (req, reply) => {
    const p = CreateBody.safeParse(req.body ?? {});
    if (!p.success) return reply.status(400).send({ error: "invalid_request", detail: p.error.issues });
    const campaign = await createCampaign({ ...p.data, accountId: resolveAccountId(req) });
    return campaign;
  });

  app.get<{ Params: { id: string } }>("/marketing/:id", async (req, reply) => {
    const c = campaigns.get(req.params.id);
    if (!c || !actsFor(req, c.accountId)) return reply.status(404).send({ error: "not_found" });
    return c;
  });

  app.post<{ Params: { id: string } }>("/marketing/:id/approve", async (req, reply) => {
    const c = campaigns.get(req.params.id);
    if (!c || !actsFor(req, c.accountId)) return reply.status(404).send({ error: "not_found" });
    const updated = await approveCampaign(req.params.id);
    return updated;
  });

  app.post<{ Params: { id: string } }>("/marketing/:id/run", async (req, reply) => {
    const c = campaigns.get(req.params.id);
    if (!c || !actsFor(req, c.accountId)) return reply.status(404).send({ error: "not_found" });
    if (c.status !== "running") return reply.status(409).send({ error: "not_running", status: c.status });
    const updated = await runCampaignLoop(req.params.id);
    return updated;
  });

  app.post<{ Params: { id: string } }>("/marketing/:id/pause", async (req, reply) => {
    const c = campaigns.get(req.params.id);
    if (!c || !actsFor(req, c.accountId)) return reply.status(404).send({ error: "not_found" });
    return pauseCampaign(req.params.id);
  });

  app.post<{ Params: { id: string } }>("/marketing/:id/resume", async (req, reply) => {
    const c = campaigns.get(req.params.id);
    if (!c || !actsFor(req, c.accountId)) return reply.status(404).send({ error: "not_found" });
    return resumeCampaign(req.params.id);
  });
}
