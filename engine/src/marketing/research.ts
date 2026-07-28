// Research step — the loop's "researches your customer's pain points" (the tweet scrapes Reddit
// with Perplexity; we use Claude + web search when ANTHROPIC_API_KEY is set). Honest by
// construction: the model is told to return only real, sourced frustrations and never to invent
// one. With no key it falls back to a small CURATED seed set of well-known travel pains, each
// labeled source:"seed" so nothing modeled is ever passed off as a fresh web finding.
import type { PainPoint } from "./types.ts";
import { config } from "../config.ts";
import { log } from "../logger.ts";

let painCounter = 0;
const pid = () => `pp_${Date.now().toString(36)}_${painCounter++}`;

// Curated, real travel frustrations paired with the honest Tures angle. Used when there's no
// Anthropic key, and as a floor so a campaign always has something to build on.
const SEED: Array<Omit<PainPoint, "id">> = [
  { pain: "Booked ten tabs and still don't have a single confirmation I can trust", angle: "Tures hands back confirmation numbers, not links", source: "seed" },
  { pain: "Travel agents cost a fortune and still email me PDFs", angle: "An AI concierge that actually books every leg", source: "seed" },
  { pain: "A flight got cancelled and I found out from the airport board, not my planner", angle: "Tures watches the trip and rebooks with your say-so", source: "seed" },
  { pain: "I want the good places, not the top TripAdvisor result everyone else gets", angle: "Tures learns your taste and books to it", source: "seed" },
  { pain: "I don't want a bot spending my money without asking", angle: "A human confirms before any money moves", source: "seed" },
];

const REPORT_TOOL = {
  name: "report_pains",
  description:
    "Report the real, specific traveler frustrations you found for this audience. Include ONLY genuine pains people actually express; if you found few, return few. Never invent one.",
  input_schema: {
    type: "object" as const,
    properties: {
      pains: {
        type: "array",
        items: {
          type: "object",
          properties: {
            pain: { type: "string", description: "The frustration in the traveler's own words, short." },
            angle: { type: "string", description: "The honest Tures angle that answers it." },
            source: { type: "string", description: "Where you saw it (site/community name)." },
            url: { type: "string", description: "Source link if you have a real one." },
          },
          required: ["pain", "angle", "source"],
        },
      },
    },
    required: ["pains"],
  },
};

const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 4 } as const;

/** Surface pain points for an audience. Always returns at least the seed floor so a campaign can
 *  proceed offline. `product` colors the angle; `audience` targets the search. */
export async function researchPains(product: string, audience: string, want = 5): Promise<PainPoint[]> {
  const seed = SEED.map((s) => ({ ...s, id: pid() }));
  if (!config.anthropicKey) return seed.slice(0, want);

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: config.anthropicKey });
    const resp = await client.messages.create({
      model: process.env.AGENT_MODEL ?? "claude-opus-4-8",
      max_tokens: 1024,
      system:
        `You research real customer pain points for ${product}, an AI travel concierge that books ` +
        `every leg of a trip and returns confirmation numbers (not links), with a human confirming ` +
        `before money moves. Find genuine frustrations this audience expresses about planning and ` +
        `booking travel. Return only real, specific pains via report_pains. Never invent one.`,
      tools: [WEB_SEARCH_TOOL as any, REPORT_TOOL],
      messages: [
        { role: "user", content: `Audience: ${audience || "people who plan their own trips"}. Find up to ${want} real pain points.` },
      ],
    });
    const call = resp.content.find((b: any) => b.type === "tool_use" && b.name === "report_pains") as any;
    const found: PainPoint[] = (call?.input?.pains ?? [])
      .filter((p: any) => p?.pain && p?.angle)
      .map((p: any) => ({ id: pid(), pain: String(p.pain), angle: String(p.angle), source: String(p.source ?? "web"), url: p.url }));
    // Web findings first, seed as a floor so we never return empty.
    const merged = [...found, ...seed];
    return merged.slice(0, Math.max(want, found.length));
  } catch (e) {
    log.warn("marketing research fell back to seed", { err: String(e) });
    return seed.slice(0, want);
  }
}
