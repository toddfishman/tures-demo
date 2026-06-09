// Chunk 2 — the real agent loop. A Claude tool-use cycle whose tools are the engine's own
// verbs (search_offers, propose_plan). Runs only when ANTHROPIC_API_KEY is set; otherwise the
// orchestrator uses the deterministic planner. The SDK is imported lazily so the mock/no-key
// path never needs the dependency loaded.
//
// Every step emits an ExecutionEvent → this is what makes the live execution stream *real*
// reasoning instead of a scripted queue.
import type { Brief, Offer } from "../types.ts";
import { config } from "../config.ts";
import { runSearch } from "../search/service.ts";
import { emitEvent } from "../events/bus.ts";
import { log } from "../logger.ts";
import type { ProposedPlan } from "./orchestrator.ts";

const AGENT_MODEL = process.env.AGENT_MODEL ?? "claude-sonnet-4-6";
const MAX_TURNS = 6;

const SYSTEM = `You are Tures, an autonomous travel booking agent. You are given a trip BRIEF
which is BOTH the task and the limit of your authority: never propose anything that exceeds the
stated budget, and respect the requested cabin and place preferences.

Work the loop: call search_offers to get scored flights and stays, reason about the best fit
for THIS traveler (value, convenience, and how well a stay matches their placeTypes), then call
propose_plan exactly once with your chosen flight and stay and a short, warm rationale a concierge
would write. Do not book anything — you only propose. Keep any free-text brief and concise.`;

const TOOLS = [
  {
    name: "search_offers",
    description: "Search the supplier for flights and stays matching the brief. Returns scored, ranked offers.",
    input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "propose_plan",
    description: "Propose the final plan: one flight and one stay, chosen by id from the search results.",
    input_schema: {
      type: "object" as const,
      properties: {
        flightId: { type: "string", description: "id of the chosen flight offer" },
        stayId: { type: "string", description: "id of the chosen stay offer" },
        rationale: { type: "string", description: "one or two warm sentences explaining the picks" },
      },
      required: ["rationale"],
      additionalProperties: false,
    },
  },
];

export async function runAgentLoop(tripId: string, brief: Brief): Promise<ProposedPlan> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: config.anthropicKey });

  let flights: Offer[] = [];
  let stays: Offer[] = [];

  const findOffer = (id: string | undefined, pool: Offer[]) =>
    pool.find((o) => o.id === id) ?? pool[0];

  async function executeTool(name: string, input: any): Promise<unknown> {
    if (name === "search_offers") {
      const res = await runSearch(tripId, brief); // emits search + score events
      flights = res.flights;
      stays = res.stays;
      const slim = (o: Offer) => ({ id: o.id, title: o.title, priceUsd: o.priceUsd, score: o.score, summary: o.summary });
      return { flights: flights.slice(0, 6).map(slim), stays: stays.slice(0, 6).map(slim) };
    }
    if (name === "propose_plan") {
      const flight = findOffer(input.flightId, flights);
      const stay = findOffer(input.stayId, stays);
      const totalUsd = (flight?.priceUsd ?? 0) + (stay?.priceUsd ?? 0);
      const withinBudget = !brief.budgetUsd || totalUsd <= brief.budgetUsd;
      const plan: ProposedPlan = { tripId, flight, stay, totalUsd, withinBudget, rationale: input.rationale };
      emitEvent(tripId, "propose", "Proposed plan", {
        detail: input.rationale,
        data: { totalUsd, withinBudget, flightId: flight?.id, stayId: stay?.id },
      });
      return { ok: true, totalUsd, withinBudget };
    }
    return { error: `unknown tool ${name}` };
  }

  const messages: any[] = [
    {
      role: "user",
      content:
        `BRIEF:\n${JSON.stringify(brief, null, 2)}\n\n` +
        `Find and propose the best flight + stay within this brief.`,
    },
  ];

  let proposed: ProposedPlan | null = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });

    // Surface the model's reasoning to the live stream.
    for (const block of resp.content) {
      if (block.type === "text" && block.text.trim()) {
        emitEvent(tripId, "status", "Tures is thinking", { detail: block.text.trim().slice(0, 280) });
      }
    }

    if (resp.stop_reason !== "tool_use") break;

    messages.push({ role: "assistant", content: resp.content });
    const toolResults: any[] = [];
    for (const block of resp.content) {
      if (block.type !== "tool_use") continue;
      emitEvent(tripId, "status", `Calling ${block.name}`, {});
      const result = await executeTool(block.name, block.input);
      if (block.name === "propose_plan" && (result as any)?.ok) {
        proposed = {
          tripId,
          flight: findOffer((block.input as any).flightId, flights),
          stay: findOffer((block.input as any).stayId, stays),
          totalUsd: (result as any).totalUsd,
          withinBudget: (result as any).withinBudget,
          rationale: (block.input as any).rationale,
        };
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: toolResults });

    if (proposed) return proposed; // model committed a plan — done.
  }

  if (proposed) return proposed;

  // Model never proposed (rare) — fall back to the top scored picks so the caller always gets a plan.
  log.warn("agent loop ended without propose_plan; using top scored offers", { tripId });
  if (flights.length === 0 && stays.length === 0) {
    const res = await runSearch(tripId, brief);
    flights = res.flights;
    stays = res.stays;
  }
  const flight = flights[0];
  const stay = stays[0];
  const totalUsd = (flight?.priceUsd ?? 0) + (stay?.priceUsd ?? 0);
  return {
    tripId,
    flight,
    stay,
    totalUsd,
    withinBudget: !brief.budgetUsd || totalUsd <= brief.budgetUsd,
    rationale: "Top scored flight + stay within your brief.",
  };
}
