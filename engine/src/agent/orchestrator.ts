// Agent orchestrator — Chunk 2.
//
// proposePlan() is the entry point and dispatches between two planners with the same return
// shape:
//   • the Claude tool-use agent loop in ./llm.ts (when ANTHROPIC_API_KEY is set) — real
//     reasoning streamed to the live execution feed; tools are the engine's own verbs.
//   • the deterministic planner below (no keys) — top scored flight + stay within budget.
//
// Still PROPOSE-ONLY. Booking (request_confirmation → book, idempotent, audited) is Chunk 3.
import type { Brief, Offer } from "../types.ts";
import { runSearch } from "../search/service.ts";
import { assembleContext } from "./context.ts";
import { emitEvent } from "../events/bus.ts";
import { config } from "../config.ts";
import { recall } from "../mem0.ts";

export interface ProposedPlan {
  tripId: string;
  flight?: Offer;
  stay?: Offer;
  totalUsd: number;
  withinBudget: boolean;
  rationale: string;
  /** Which planner produced this — "agent" (Claude loop) or "deterministic". */
  planner?: "agent" | "deterministic";
}

/** Entry point. Uses the Claude tool-use agent loop when ANTHROPIC_API_KEY is set; otherwise
 *  the deterministic planner below. Same return shape either way.
 *  `memoryKey` (when given) keys mem0 personalization — the front-end passes the same stable id
 *  the conversational agent uses, so the planner remembers what the chat learned (and vice-versa). */
export async function proposePlan(tripId: string, brief: Brief, accountId = "demo", memoryKey?: string): Promise<ProposedPlan> {
  // Fold standing memory (Taste Print, loyalty, "where you've been") + this-trip brief into one
  // coherent picture before planning. Both planners see the effective brief + the context prose.
  const { context, brief: effBrief } = assembleContext(accountId, brief);

  // mem0: long-term, cross-session memories (what they've loved, learned preferences). Keyed by the
  // shared memoryKey when present, else the account id. Folded into the SAME context prose both the
  // scorer and the agent read — so the planner is personalized, not just the chat. No-op without a key.
  const memId = memoryKey || (accountId !== "demo" ? accountId : undefined);
  if (memId) {
    try {
      const mems = await recall(memId, `${brief.destination} ${(brief.placeTypes ?? []).join(" ")} ${context.tasteTags.join(" ")}`.trim());
      if (mems.length) {
        context.prose = `${context.prose} Remembered: ${mems.slice(0, 4).join("; ")}.`.trim();
      }
    } catch { /* memory is best-effort — never block a plan on it */ }
  }

  if (context.prose) emitEvent(tripId, "status", "Personalizing for you", { detail: context.prose.slice(0, 280) });

  if (config.anthropicKey) {
    const { runAgentLoop } = await import("./llm.ts");
    const plan = await runAgentLoop(tripId, effBrief, accountId, context);
    return { ...plan, planner: "agent" };
  }
  return proposePlanDeterministic(tripId, effBrief, accountId, context);
}

/** Pre-LLM planner: top scored flight + top stay that still fits the budget when combined.
 *  Deterministic, no keys — used as the fallback and for tests. */
export async function proposePlanDeterministic(tripId: string, brief: Brief, accountId = "demo", ctx?: ReturnType<typeof assembleContext>["context"]): Promise<ProposedPlan> {
  const context = ctx ?? assembleContext(accountId, brief).context;
  const { flights, stays } = await runSearch(tripId, brief, accountId, context);

  // Pick the top-scored option in each category that still fits the budget when combined.
  const flight = flights[0];
  const stay = stays.find((s) => !brief.budgetUsd || (flight?.priceUsd ?? 0) + s.priceUsd <= brief.budgetUsd)
    ?? stays[0];

  const totalUsd = (flight?.priceUsd ?? 0) + (stay?.priceUsd ?? 0);
  const withinBudget = !brief.budgetUsd || totalUsd <= brief.budgetUsd;

  const rationale = [
    flight && `${flight.title} (${flight.scoreReasons?.join(", ") || "best available"})`,
    stay && `${stay.title} (${stay.scoreReasons?.join(", ") || "best available"})`,
    brief.budgetUsd && `$${totalUsd.toLocaleString()} of $${brief.budgetUsd.toLocaleString()} budget`,
  ]
    .filter(Boolean)
    .join(" · ");

  emitEvent(tripId, "propose", "Proposed plan", {
    detail: rationale,
    data: { totalUsd, withinBudget, flightId: flight?.id, stayId: stay?.id },
  });

  return { tripId, flight, stay, totalUsd, withinBudget, rationale, planner: "deterministic" };
}
