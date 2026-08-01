// The intelligent, real-time provider: Claude + Anthropic web search. This is the catch-all for the
// signals no clean free API exists for — transit strikes, major events/festivals/closures, safety &
// security notes, big traffic/construction, severe-weather alerts beyond the 16-day forecast. The
// model searches the live web and returns ONLY real, current, place+time-specific items via a
// structured tool. Configured whenever ANTHROPIC_API_KEY is set. Honest by construction: if it finds
// nothing notable it returns an empty list — it is instructed never to invent a signal.
import type { Signal, SignalContext, SignalProvider } from "../types.ts";
import { config } from "../../config.ts";
import { log } from "../../logger.ts";

const REPORT_TOOL = {
  name: "report_signals",
  description:
    "Report the trip-relevant situational signals you found. Include ONLY things that are real, current, and specific to this destination and time window. If you found nothing notable, return an empty array — never invent a signal.",
  input_schema: {
    type: "object" as const,
    properties: {
      signals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: { type: "string", enum: ["advisory", "transit", "traffic", "event", "health", "news"] },
            severity: { type: "string", enum: ["info", "watch", "warning", "critical"] },
            title: { type: "string", description: "Short headline, no trailing period." },
            detail: { type: "string", description: "One or two sentences: what it is and why it matters for this trip." },
            url: { type: "string", description: "Source link if available." },
            travelImpacting: { type: "boolean", description: "True if it could affect flights or ground plans." },
          },
          required: ["category", "severity", "title", "detail"],
        },
      },
    },
    required: ["signals"],
  },
};

const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 4 } as const;

export const webProvider: SignalProvider = {
  name: "Claude web search",
  category: "news",
  configured: () => !!config.anthropicKey,
  async fetch(ctx: SignalContext): Promise<Signal[]> {
    if (!config.anthropicKey) return [];
    const window = ctx.departDate ? `${ctx.departDate}${ctx.returnDate ? ` to ${ctx.returnDate}` : ""}` : "the coming days";
    const prompt =
      `You are Tures' situational-awareness scout. Search the live web for anything that could affect or enhance a trip to ${ctx.label} during ${window}. ` +
      `Look for: transit strikes or major flight/rail disruptions, big events/festivals/marathons/holidays or closures that change the city, current safety or security advisories, major traffic or construction, and any severe-weather alerts. ` +
      `Only report items that are real, current, and specific to this place and time. When done, call report_signals with what you found (empty array if nothing notable). Do not invent anything.`;

    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: config.anthropicKey, maxRetries: 2 });
      const resp = await client.messages.stream({
        model: process.env.SIGNAL_MODEL ?? process.env.AGENT_MODEL ?? "claude-opus-4-8",
        max_tokens: 1200,
        system: "You find real, current, location- and date-specific travel risks and opportunities using web search, then report them via the tool. Never fabricate.",
        tools: [WEB_SEARCH_TOOL, REPORT_TOOL] as any,
        messages: [{ role: "user", content: prompt }],
      }).finalMessage();

      const tool = resp.content.find((b: any) => b.type === "tool_use" && b.name === "report_signals") as any;
      const raw: any[] = tool?.input?.signals ?? [];
      return raw.slice(0, 8).map((s, i) => ({
        id: `web:${ctx.label}:${String(s.title || i).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`,
        category: (s.category ?? "news") as Signal["category"],
        severity: (s.severity ?? "watch") as Signal["severity"],
        title: String(s.title ?? "Note"),
        detail: s.detail ? String(s.detail) : undefined,
        source: "web",
        url: typeof s.url === "string" ? s.url : undefined,
        when: ctx.departDate ? { from: ctx.departDate, to: ctx.returnDate } : undefined,
        travelImpacting: !!s.travelImpacting,
      }));
    } catch (e) {
      log.warn("web signal failed", { err: String(e) });
      return [];
    }
  },
};
