import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveAccountId, actsFor } from "../auth/index.ts";
import { ACTION_PERMISSIONS, isValidPermission, freeForAnonymous } from "../actions/catalog.ts";
import {
  actionExecutorStatus,
  listGrants,
  createGrant,
  revokeGrant,
  runAction,
  getRun,
  getHandoff,
  continueHandoff,
  abortHandoff,
} from "../actions/service.ts";
import { actionRuns } from "../actions/store.ts";
import { browserConfigured } from "../actions/browser.ts";
import { stagehandReady } from "../actions/stagehand.ts";
import { config } from "../config.ts";

/** Free-run quota for anonymous visitors, keyed by IP and reset daily. The per-run cost cap
 *  (freeForAnonymous) bounds ONE run; this bounds the total. In-memory per instance — good enough
 *  for a demo-scale funnel; move to the shared store when this runs on more than one machine. */
const freeRuns = new Map<string, { day: string; count: number }>();
function takeFreeRun(ip: string): { ok: boolean; used: number; limit: number } {
  const limit = config.freeActionDailyLimit;
  const day = new Date().toISOString().slice(0, 10);
  const cur = freeRuns.get(ip);
  const rec = cur && cur.day === day ? cur : { day, count: 0 };
  if (rec.count >= limit) {
    freeRuns.set(ip, rec);
    return { ok: false, used: rec.count, limit };
  }
  rec.count += 1;
  freeRuns.set(ip, rec);
  return { ok: true, used: rec.count, limit };
}
/** req.ip is resolved by Fastify's trustProxy (one hop) — the real client address, and not
 *  something a caller can spoof with a header to reset their quota. */
function clientIp(req: any): string {
  return req.ip || "unknown";
}

export async function actionsRoutes(app: FastifyInstance) {
  app.get("/actions/capabilities", async () => ({
    executor: actionExecutorStatus(),
    browserbase: browserConfigured(),
    stagehand: stagehandReady(),
    actionModel: config.actionModel,
    permissions: ACTION_PERMISSIONS,
  }));

  app.get("/actions/permissions", async () => ({ permissions: ACTION_PERMISSIONS }));

  app.get("/actions/grants", async (req) => {
    const accountId = resolveAccountId(req);
    return { grants: listGrants(accountId) };
  });

  const GrantBody = z.object({
    permission: z.string(),
    label: z.string().min(1),
    scope: z
      .object({
        domain: z.string().optional(),
        tripId: z.string().optional(),
        maxUsd: z.number().positive().optional(),
        expiresAt: z.string().optional(),
      })
      .optional(),
  });
  app.post("/actions/grants", async (req, reply) => {
    const p = GrantBody.safeParse(req.body);
    if (!p.success) return reply.status(400).send({ error: "invalid_request" });
    if (!isValidPermission(p.data.permission)) return reply.status(400).send({ error: "invalid_permission" });
    const meta = ACTION_PERMISSIONS[p.data.permission];
    if (meta.readonly) return reply.status(400).send({ error: "readonly_permission" });
    const accountId = resolveAccountId(req);
    const grant = createGrant(accountId, p.data.permission, p.data.label, p.data.scope);
    return { grant };
  });

  app.post<{ Params: { id: string } }>("/actions/grants/:id/revoke", async (req, reply) => {
    const accountId = resolveAccountId(req);
    const grant = revokeGrant(accountId, req.params.id);
    if (!grant) return reply.status(404).send({ error: "not_found" });
    return { grant };
  });

  const RunBody = z.object({
    permission: z.string(),
    title: z.string().min(1),
    detail: z.string().optional(),
    targetUrl: z.string().url().optional(),
    tripId: z.string().optional(),
    grantId: z.string().optional(),
    expectHuman: z.boolean().optional(),
  });
  app.post("/actions/run", async (req, reply) => {
    const p = RunBody.safeParse(req.body);
    if (!p.success) return reply.status(400).send({ error: "invalid_request" });
    if (!isValidPermission(p.data.permission)) return reply.status(400).send({ error: "invalid_permission" });
    const accountId = resolveAccountId(req);

    // Anonymous visitors get the cheap, read-only lookups on us — so "try it before you sign up"
    // is real — but never anything that acts on someone's behalf, and never past the daily quota.
    let freeTier: { used: number; limit: number; remaining: number } | undefined;
    if (accountId === "demo") {
      const verdict = freeForAnonymous(p.data.permission);
      if (!verdict.allowed) {
        return reply.status(401).send({ error: "sign_in_required", reason: verdict.reason });
      }
      const quota = takeFreeRun(clientIp(req));
      if (!quota.ok) {
        return reply.status(429).send({ error: "free_limit_reached", limit: quota.limit });
      }
      // Tell the client what's left, so it can warn before the wall instead of at it.
      freeTier = { used: quota.used, limit: quota.limit, remaining: Math.max(0, quota.limit - quota.used) };
    }

    try {
      const run = await runAction(accountId, p.data as any);
      return {
        run,
        executor: actionExecutorStatus(),
        freeTier,
        handoffUrl: run.handoffToken ? `/handoff.html?id=${run.handoffToken}` : undefined,
      };
    } catch (e: any) {
      if (e?.message === "grant_required") return reply.status(403).send({ error: "grant_required" });
      return reply.status(500).send({ error: "run_failed" });
    }
  });

  app.get("/actions/runs", async (req) => {
    const accountId = resolveAccountId(req);
    return { runs: actionRuns.list(accountId).slice(0, 20) };
  });

  app.get<{ Params: { id: string } }>("/actions/runs/:id", async (req, reply) => {
    const accountId = resolveAccountId(req);
    const run = getRun(accountId, req.params.id);
    if (!run) return reply.status(404).send({ error: "not_found" });
    return { run, executor: actionExecutorStatus() };
  });

  /** Handoff page data — token is the secret (magic link). Optional auth must match owner. */
  app.get<{ Params: { token: string } }>("/actions/handoff/:token", async (req, reply) => {
    const h = getHandoff(req.params.token);
    if (!h) return reply.status(404).send({ error: "not_found" });
    const accountId = resolveAccountId(req);
    if (accountId !== "demo" && h.accountId !== accountId) return reply.status(404).send({ error: "not_found" });
    const run = actionRuns.get(h.runId);
    return {
      handoff: h,
      run: run ? { id: run.id, title: run.title, status: run.status, permission: run.permission } : undefined,
      executor: actionExecutorStatus(),
    };
  });

  app.post<{ Params: { token: string } }>("/actions/handoff/:token/continue", async (req, reply) => {
    const h = getHandoff(req.params.token);
    if (!h) return reply.status(404).send({ error: "not_found" });
    const accountId = resolveAccountId(req);
    const ownerCheck = accountId !== "demo" ? accountId : undefined;
    const result = await continueHandoff(req.params.token, ownerCheck);
    if (!result) return reply.status(409).send({ error: "handoff_not_open" });
    if (accountId !== "demo" && !actsFor(req, h.accountId)) return reply.status(404).send({ error: "not_found" });
    return result;
  });

  app.post<{ Params: { token: string } }>("/actions/handoff/:token/abort", async (req, reply) => {
    const h = getHandoff(req.params.token);
    if (!h) return reply.status(404).send({ error: "not_found" });
    const accountId = resolveAccountId(req);
    const ownerCheck = accountId !== "demo" ? accountId : undefined;
    const updated = abortHandoff(req.params.token, ownerCheck);
    if (!updated) return reply.status(409).send({ error: "handoff_not_open" });
    return { handoff: updated };
  });
}
