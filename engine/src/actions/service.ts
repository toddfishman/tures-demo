import { ACTION_PERMISSIONS, isValidPermission } from "./catalog.ts";
import { createBrowserSession, browserConfigured, simulatedSession } from "./browser.ts";
import {
  connectStagehand,
  pauseStagehand,
  endStagehand,
  gotoTarget,
  runStagehandAgent,
  sessionMeta,
  stagehandReady,
} from "./stagehand.ts";
import { notifyHandoff } from "./notify.ts";
import {
  actionGrants,
  actionRuns,
  handoffs,
  nextGrantId,
  nextRunId,
  handoffToken,
} from "./store.ts";
import type { ActionGrant, ActionRun, ActionPermission, HandoffRequest } from "./types.ts";
import { config } from "../config.ts";
import { log } from "../logger.ts";

export function actionExecutorStatus(): "browserbase" | "simulated" | "not_configured" {
  if (stagehandReady()) return "browserbase";
  if (browserConfigured()) return "simulated"; // Browserbase keyed but no LLM for Stagehand
  return "simulated";
}

function now() {
  return new Date().toISOString();
}

function audit(run: ActionRun, action: string, detail?: string) {
  run.audit.push({ ts: now(), action, detail });
  run.updatedAt = now();
}

export function listGrants(accountId: string) {
  return actionGrants.list(accountId);
}

export function createGrant(
  accountId: string,
  permission: ActionPermission,
  label: string,
  scope?: ActionGrant["scope"],
): ActionGrant {
  const g: ActionGrant = {
    id: nextGrantId(),
    accountId,
    permission,
    label,
    scope,
    status: "active",
    createdAt: now(),
  };
  actionGrants.put(g);
  return g;
}

export function revokeGrant(accountId: string, grantId: string): ActionGrant | null {
  const g = actionGrants.get(grantId);
  if (!g || g.accountId !== accountId || g.status !== "active") return null;
  g.status = "revoked";
  g.revokedAt = now();
  actionGrants.put(g);
  return g;
}

function findGrant(accountId: string, permission: ActionPermission, grantId?: string): ActionGrant | null {
  if (grantId) {
    const g = actionGrants.get(grantId);
    if (g && g.accountId === accountId && g.status === "active" && g.permission === permission) return g;
    return null;
  }
  return actionGrants.list(accountId).find((g) => g.permission === permission) ?? null;
}

export interface RunInput {
  permission: ActionPermission;
  title: string;
  detail?: string;
  targetUrl?: string;
  tripId?: string;
  grantId?: string;
  /** Force a human step before automation (login always does this). */
  expectHuman?: boolean;
}

/** Login permission always pauses for the traveler — Vault auto-fill comes later. */
function loginFirst(permission: ActionPermission, expectHuman?: boolean): boolean {
  if (permission === "act:browser_login") return true;
  return expectHuman === true;
}

async function attachSession(run: ActionRun, session: { sessionId: string; liveViewUrl: string; simulated?: boolean }) {
  run.browserSessionId = session.sessionId;
  run.liveViewUrl = session.liveViewUrl;
  audit(run, "browser_session", session.simulated ? "simulated session" : session.sessionId);
}

async function openHandoffForRun(
  run: ActionRun,
  input: RunInput,
  reason: HandoffRequest["reason"],
  accountId: string,
): Promise<ActionRun> {
  run.status = "needs_human";
  const handoff = openHandoff(run, reason, {
    title: input.title,
    instructions: handoffInstructions(input, reason),
    liveViewUrl: run.liveViewUrl,
  });
  run.handoffToken = handoff.token;
  audit(run, "needs_human", reason);
  actionRuns.put(run);
  await notifyHandoffAsync(accountId, handoff);
  return run;
}

export async function runAction(accountId: string, input: RunInput): Promise<ActionRun> {
  if (!isValidPermission(input.permission)) throw new Error("invalid_permission");
  const meta = ACTION_PERMISSIONS[input.permission];
  const grant = meta.readonly ? null : findGrant(accountId, input.permission, input.grantId);
  if (!meta.readonly && !grant) throw new Error("grant_required");

  const run: ActionRun = {
    id: nextRunId(),
    accountId,
    tripId: input.tripId,
    grantId: grant?.id ?? "readonly",
    permission: input.permission,
    title: input.title,
    detail: input.detail,
    targetUrl: input.targetUrl,
    status: "running",
    audit: [],
    createdAt: now(),
    updatedAt: now(),
  };
  audit(run, "started", meta.browser ? "browser action" : "direct action");

  if (!meta.browser) {
    run.status = "completed";
    run.result = { summary: "Research completed via web search.", simulated: true };
    audit(run, "completed", "non-browser");
    actionRuns.put(run);
    return run;
  }

  // ── Live path: Browserbase + Stagehand ─────────────────────────────────────
  if (stagehandReady()) {
    let stagehand;
    try {
      stagehand = await connectStagehand();
      const sm = sessionMeta(stagehand);
      run.browserSessionId = sm.sessionId;
      run.liveViewUrl = sm.liveViewUrl;
      audit(run, "stagehand_session", sm.sessionId ?? "unknown");

      await gotoTarget(stagehand, input.targetUrl);

      if (loginFirst(input.permission, input.expectHuman)) {
        await pauseStagehand(stagehand);
        return openHandoffForRun(run, input, "login", accountId);
      }

      const outcome = await runStagehandAgent(stagehand, {
        title: input.title,
        detail: input.detail,
        permission: input.permission,
      });

      if (outcome.needsHuman) {
        await pauseStagehand(stagehand);
        return openHandoffForRun(run, input, outcome.reason ?? "other", accountId);
      }

      run.status = outcome.success ? "completed" : "failed";
      run.result = {
        summary: outcome.message || (outcome.success ? "Task completed." : "Task did not complete."),
        simulated: false,
        agentMessage: outcome.message,
        sessionUrl: sm.sessionUrl,
      };
      audit(run, run.status, `agent steps: ${outcome.actions ?? 0}`);
      await endStagehand(stagehand);
      actionRuns.put(run);
      return run;
    } catch (e) {
      if (stagehand) await pauseStagehand(stagehand).catch(() => {});
      log.error("stagehand run failed", { err: String((e as Error)?.message ?? e), runId: run.id });
      run.status = "failed";
      run.result = { summary: "Browser automation failed — try again or complete manually.", simulated: false };
      audit(run, "failed", String((e as Error)?.message ?? e));
      actionRuns.put(run);
      return run;
    }
  }

  // ── Simulated path (no Browserbase / no Anthropic for Stagehand) ───────────
  let session = await createBrowserSession(input.targetUrl);
  if (!session) session = simulatedSession(input.targetUrl);
  await attachSession(run, session);

  if (loginFirst(input.permission, input.expectHuman) || input.expectHuman !== false) {
    return openHandoffForRun(run, input, "login", accountId);
  }

  run.status = "completed";
  run.result = {
    summary: "Action recorded — enable BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID + ANTHROPIC_API_KEY for live execution.",
    simulated: true,
  };
  audit(run, "completed", "simulated");
  actionRuns.put(run);
  return run;
}

function handoffInstructions(input: RunInput, reason: HandoffRequest["reason"]): string {
  const site = input.targetUrl ? new URL(input.targetUrl).hostname.replace(/^www\./, "") : "the site";
  if (reason === "captcha") {
    return `Pass the security check on ${site}, then tap "I'm done" so Tures can continue.`;
  }
  if (reason === "otp") {
    return `Enter the verification code on ${site}, then tap "I'm done".`;
  }
  return `Open the live session, sign in or complete your step on ${site}, then tap "I'm done" so Tures can continue.`;
}

function openHandoff(
  run: ActionRun,
  reason: HandoffRequest["reason"],
  opts: { title: string; instructions: string; liveViewUrl?: string },
): HandoffRequest {
  const h: HandoffRequest = {
    token: handoffToken(),
    runId: run.id,
    accountId: run.accountId,
    reason,
    title: opts.title,
    instructions: opts.instructions,
    liveViewUrl: opts.liveViewUrl ?? run.liveViewUrl,
    targetUrl: run.targetUrl,
    status: "open",
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    createdAt: now(),
  };
  handoffs.put(h);
  return h;
}

async function notifyHandoffAsync(accountId: string, handoff: HandoffRequest) {
  const base = config.publicBaseUrl.replace(/\/v\d+\/?$/, "/v12");
  try {
    await notifyHandoff(accountId, handoff, base);
  } catch (e) {
    log.warn("notify handoff", { err: String((e as Error)?.message ?? e) });
  }
}

export function getRun(accountId: string, runId: string): ActionRun | null {
  const r = actionRuns.get(runId);
  if (!r || r.accountId !== accountId) return null;
  return r;
}

export function getHandoff(token: string): HandoffRequest | null {
  const h = handoffs.get(token);
  if (!h) return null;
  if (h.status === "open" && h.expiresAt < now()) {
    h.status = "expired";
    handoffs.put(h);
  }
  return h;
}

export async function continueHandoff(
  token: string,
  accountId?: string,
): Promise<{ handoff: HandoffRequest; run: ActionRun } | null> {
  const h = getHandoff(token);
  if (!h || h.status !== "open") return null;
  if (accountId && h.accountId !== accountId) return null;

  const run = actionRuns.get(h.runId);
  if (!run) return null;

  h.status = "continued";
  handoffs.put(h);
  audit(run, "handoff_continued", h.reason);

  if (stagehandReady() && run.browserSessionId && !run.browserSessionId.startsWith("sim_")) {
    let stagehand;
    try {
      stagehand = await connectStagehand(run.browserSessionId);
      const outcome = await runStagehandAgent(stagehand, {
        title: run.title,
        detail: run.detail,
        permission: run.permission,
      });

      if (outcome.needsHuman) {
        run.status = "needs_human";
        const again = openHandoff(run, outcome.reason ?? "other", {
          title: run.title,
          instructions: handoffInstructions(
            { permission: run.permission, title: run.title, detail: run.detail, targetUrl: run.targetUrl },
            outcome.reason ?? "other",
          ),
          liveViewUrl: run.liveViewUrl,
        });
        run.handoffToken = again.token;
        audit(run, "needs_human_again", outcome.reason);
        await pauseStagehand(stagehand);
        actionRuns.put(run);
        await notifyHandoffAsync(run.accountId, again);
        return { handoff: h, run };
      }

      run.status = outcome.success ? "completed" : "failed";
      run.result = {
        summary: outcome.message || "Task completed after your step.",
        simulated: false,
        agentMessage: outcome.message,
      };
      audit(run, run.status, "resumed after handoff");
      await endStagehand(stagehand);
    } catch (e) {
      if (stagehand) await pauseStagehand(stagehand).catch(() => {});
      run.status = "failed";
      run.result = { summary: "Could not resume after your step.", simulated: false };
      audit(run, "failed", String((e as Error)?.message ?? e));
    }
  } else {
    run.status = "completed";
    run.result = {
      summary: "Human step recorded — live Stagehand resume requires Browserbase + Anthropic keys.",
      simulated: true,
    };
    audit(run, "completed", "simulated resume");
  }

  actionRuns.put(run);
  return { handoff: h, run };
}

export function abortHandoff(token: string, accountId?: string): HandoffRequest | null {
  const h = getHandoff(token);
  if (!h || h.status !== "open") return null;
  if (accountId && h.accountId !== accountId) return null;

  h.status = "aborted";
  handoffs.put(h);

  const run = actionRuns.get(h.runId);
  if (run) {
    run.status = "aborted";
    audit(run, "handoff_aborted");
    actionRuns.put(run);
  }
  return h;
}
