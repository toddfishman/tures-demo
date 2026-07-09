import { Stagehand } from "@browserbasehq/stagehand";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import { browserConfigured } from "./browser.ts";
import type { ActionPermission } from "./types.ts";

export function stagehandReady(): boolean {
  return browserConfigured() && !!config.anthropicKey;
}

export function actionModel(): string {
  return config.actionModel;
}

export interface SessionMeta {
  sessionId?: string;
  liveViewUrl?: string;
  sessionUrl?: string;
}

export interface AgentRunOutcome {
  success: boolean;
  completed: boolean;
  message: string;
  needsHuman: boolean;
  reason?: "captcha" | "otp" | "login" | "confirm" | "other";
  actions?: number;
}

const HUMAN_MARK = "NEEDS_HUMAN";

const TURES_AGENT_PROMPT = `You are Tures — a travel concierge executing one permissioned task in the traveler's browser session.
Rules:
- Do only what the instruction asks. Do not browse unrelated pages.
- Never invent confirmation numbers or success — if you cannot verify completion, say so.
- If you hit CAPTCHA, OTP, 2FA, or a login wall you cannot pass with information you have, stop immediately and reply starting with ${HUMAN_MARK}: then a short reason (captcha|otp|login|confirm).
- Do not store or repeat passwords in your reply.`;

function sessionMeta(stagehand: Stagehand): SessionMeta {
  return {
    sessionId: stagehand.browserbaseSessionID,
    liveViewUrl: stagehand.browserbaseDebugURL || stagehand.browserbaseSessionURL,
    sessionUrl: stagehand.browserbaseSessionURL,
  };
}

/** Connect to Browserbase via Stagehand — new session or resume by id. */
export async function connectStagehand(sessionId?: string): Promise<Stagehand> {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey: config.browserbase.apiKey!,
    projectId: config.browserbase.projectId!,
    browserbaseSessionID: sessionId,
    browserbaseSessionCreateParams: {
      projectId: config.browserbase.projectId!,
    },
    model: actionModel(),
    keepAlive: true,
    waitForCaptchaSolves: true,
    verbose: 0,
    disablePino: true,
    selfHeal: true,
    systemPrompt: TURES_AGENT_PROMPT,
  });
  await stagehand.init();
  return stagehand;
}

/** Disconnect but leave the Browserbase session running for handoff resume. */
export async function pauseStagehand(stagehand: Stagehand): Promise<void> {
  try {
    await stagehand.close();
  } catch (e) {
    log.warn("stagehand pause", { err: String((e as Error)?.message ?? e) });
  }
}

/** Terminate session when the run is fully done. */
export async function endStagehand(stagehand: Stagehand): Promise<void> {
  try {
    await stagehand.close({ force: true });
  } catch (e) {
    log.warn("stagehand end", { err: String((e as Error)?.message ?? e) });
  }
}

function taskInstruction(title: string, detail?: string, permission?: ActionPermission): string {
  const parts = [title, detail].filter(Boolean);
  if (permission === "act:browser_navigate") {
    parts.push("Read the page and summarize what is relevant for the traveler's request.");
  }
  if (permission === "act:fill_forms") {
    parts.push("Fill and submit the form if all required fields are available. Do not submit if critical fields are missing.");
  }
  return parts.join(". ");
}

function parseHumanReason(message: string): AgentRunOutcome["reason"] {
  const lower = message.toLowerCase();
  if (lower.includes("captcha") || lower.includes("robot")) return "captcha";
  if (lower.includes("otp") || lower.includes("2fa") || lower.includes("verification code")) return "otp";
  if (lower.includes("login") || lower.includes("sign in")) return "login";
  if (lower.includes("confirm")) return "confirm";
  return "other";
}

function outcomeFromAgent(message: string, success: boolean, completed: boolean, actions: number): AgentRunOutcome {
  const needsHuman =
    message.includes(HUMAN_MARK) ||
    (!success && /captcha|otp|2fa|login|sign in|verify/i.test(message));
  return {
    success: success && !needsHuman,
    completed: completed && !needsHuman,
    message: message.replace(new RegExp(`^${HUMAN_MARK}:\\s*`, "i"), "").trim(),
    needsHuman,
    reason: needsHuman ? parseHumanReason(message) : undefined,
    actions,
  };
}

/** Navigate to target URL if provided. */
export async function gotoTarget(stagehand: Stagehand, targetUrl?: string): Promise<void> {
  if (!targetUrl) return;
  const page = stagehand.context.pages()[0] ?? (await stagehand.context.newPage());
  await page.goto(targetUrl);
}

/** Run the Stagehand agent for a permissioned browser task. */
export async function runStagehandAgent(
  stagehand: Stagehand,
  opts: { title: string; detail?: string; permission: ActionPermission; maxSteps?: number },
): Promise<AgentRunOutcome> {
  const instruction = taskInstruction(opts.title, opts.detail, opts.permission);
  const agent = stagehand.agent({ systemPrompt: TURES_AGENT_PROMPT });
  const result = await agent.execute({
    instruction,
    maxSteps: opts.maxSteps ?? 20,
  });
  return outcomeFromAgent(
    result.message || "",
    result.success,
    result.completed,
    result.actions?.length ?? 0,
  );
}

export { sessionMeta };
