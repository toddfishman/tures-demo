// /assist — the "handle anything" concierge. Beyond planning a trip, the traveler can ask for help
// with ANYTHING ("I'm in Aruba and lost my passport — what do I do?"). Tures RESEARCHES the answer on
// the live web, then proposes concrete next actions it can take ON THEIR BEHALF — each gated on a
// permission it must hold or ask for, exactly like a tool-using agent asks before it acts.
//
// Safety model (mirrors the booking gate + the Vault's permission gradient):
//  • Research is read-only and real (web_search).
//  • Every ACTION is PROPOSED, never auto-run. It names the permission it needs; the caller grants it
//    (or not). Read-only actions can run immediately; anything that contacts, fills forms, reserves,
//    or spends needs an explicit grant.
//  • Actually executing a real-world action (filling/submitting paperwork, contacting a third party)
//    needs the action EXECUTOR — browser automation / partner APIs — which is NOT wired yet. Until it
//    is, a granted action is SIMULATED and labeled (no fake success), just like booking with the
//    real-money switches off. So this endpoint is honest end-to-end today: real research, real
//    permission prompts, clearly-simulated execution.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import { ACTION_PERMISSIONS } from "../actions/catalog.ts";
import { actionExecutorStatus } from "../actions/service.ts";

const Body = z.object({
  text: z.string().min(2),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).default([]),
  context: z.string().optional(),
  userId: z.string().optional(),
});

/** Back-compat export — same catalog as /actions/permissions. */
export const PERMISSIONS: Record<string, { label: string; readonly: boolean }> = Object.fromEntries(
  Object.entries(ACTION_PERMISSIONS).map(([k, v]) => [k, { label: v.label, readonly: v.readonly }]),
);

const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 5 } as const;

const PLAN_TOOL = {
  name: "respond_with_plan",
  description:
    "Give the traveler a clear, researched answer plus the concrete next actions YOU can take on their behalf. Call this once, after you've researched. Every action must name the permission it needs — you never act without permission.",
  input_schema: {
    type: "object" as const,
    properties: {
      answer: { type: "string", description: "A calm, clear, researched answer in 2-5 sentences. Cite what you found in plain language." },
      actions: {
        type: "array",
        description: "Concrete next steps Tures can take for them, ordered by what to do first. Empty if there's nothing to do beyond the answer.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short imperative, e.g. 'Start your emergency passport application'." },
            detail: { type: "string", description: "One line: what doing this involves and why it helps." },
            permission: { type: "string", enum: Object.keys(PERMISSIONS), description: "The permission this action needs." },
          },
          required: ["title", "detail", "permission"],
        },
      },
    },
    required: ["answer", "actions"],
  },
};

const SYSTEM = `You are Tures — a do-anything travel concierge who actually takes care of things, not just answers questions. The traveler may ask for help with ANYTHING: a lost passport, a missed connection, a visa or entry rule, a medical or safety problem abroad, a recommendation, leaving a review, getting a refund, whatever comes up on a trip.

HOW YOU WORK (this is the important part):
1. RESEARCH first. When the answer depends on current, local, or specific facts — embassy and consulate procedures, where the nearest office is and its hours, what documents are required, local emergency numbers, a refund policy — use web_search to get it right. Never guess at a procedure you could look up.
2. ANSWER plainly. Give them a calm, clear answer they can act on right now, in their words, not a wall of links.
3. PROPOSE to act. Then offer the concrete next steps YOU can take on their behalf, and for each, name the permission it needs. You act like a trusted agent: you can look things up freely, but you ask before you contact anyone, fill or submit any form, make a reservation, or spend money. Frame actions as "I can do X for you" — capabilities you'll carry out once they say yes.

Be warm, fast, and genuinely useful. Keep the answer tight. When you're done researching, CALL respond_with_plan with the answer and the actions — always call it, even if there are no actions (then return an empty actions list).`;

export async function assistRoutes(app: FastifyInstance) {
  // GET /assist/permissions — the permission catalog (for the front-end's grant UI).
  app.get("/assist/permissions", async () => ({ permissions: PERMISSIONS }));

  app.post("/assist", async (req, reply) => {
    const p = Body.safeParse(req.body);
    if (!p.success) return reply.status(400).send({ error: "invalid_request", issues: p.error.issues });
    if (!config.anthropicKey) {
      return reply.status(501).send({ error: "assist_not_configured", reply: "My research brain isn't connected yet — the planning key isn't set." });
    }

    const msgs = p.data.history.slice(-10);
    msgs.push({ role: "user", content: p.data.text });
    let system = SYSTEM;
    if (p.data.context) system += `\n\nWHAT YOU ALREADY KNOW about this traveler (use it; don't re-ask): ${p.data.context}`;

    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: config.anthropicKey, maxRetries: 2 });
      const resp = await client.messages.stream({
        model: process.env.ASSIST_MODEL ?? process.env.AGENT_MODEL ?? "claude-opus-4-8",
        max_tokens: 1500,
        system,
        tools: [WEB_SEARCH_TOOL, PLAN_TOOL] as any,
        messages: msgs,
      }).finalMessage();

      const text = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ").trim();
      const tool = resp.content.find((b: any) => b.type === "tool_use" && b.name === "respond_with_plan") as any;
      const plan = tool?.input ?? { answer: text, actions: [] };

      // Attach the permission metadata each action needs, so the front-end can render the grant prompt.
      const actions = (plan.actions ?? []).map((a: any, i: number) => {
        const perm = PERMISSIONS[a.permission] ? a.permission : "act:research";
        const meta = PERMISSIONS[perm]!;
        return {
          id: `act_${i}`,
          title: String(a.title ?? "Next step"),
          detail: a.detail ? String(a.detail) : undefined,
          permission: perm,
          permissionLabel: meta.label,
          readonly: meta.readonly,
          // Honest status: nothing is actually carried out yet — execution needs the action executor.
          status: "proposed",
        };
      });

      return {
        answer: String(plan.answer ?? text ?? ""),
        actions,
        executor: actionExecutorStatus(),
        runHint: "Grant a permission via POST /actions/grants, then POST /actions/run to execute.",
      };
    } catch (e: any) {
      log.error("assist failed", { message: String(e?.message ?? e), status: e?.status });
      return reply.status(502).send({ error: "assist_failed" });
    }
  });
}
