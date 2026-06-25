import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import { recall, remember } from "../mem0.ts";
import { fuguChat } from "../agent/fugu.ts";

// Conversational Tures — a guided back-and-forth that gathers a complete trip brief and hands it
// to the planner. Not scripted: a strong identity (the system prompt) plus a hard checklist (the
// submit_brief tool's required fields) the model reasons against. Shared by voice + the Page 2 chat.
const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).default([]),
  text: z.string().optional(),
  // Optional: what we already know about this traveler (home airport, Taste Print, etc.) so the
  // agent skips questions those answer. The front-end fills this from the profile/prefs when present.
  context: z.string().optional(),
  // Stable id for this traveler — keys their mem0 memory (personalization across sessions).
  userId: z.string().optional(),
  // Diagnostics: when true, the response includes the raw Fugu assistant message so we can see how
  // (or whether) it emitted the submit_brief tool. Safe — it's the model's own message, no secrets.
  debug: z.boolean().optional(),
});

const SYSTEM = `You are Tures — a portable, do-it-all AI travel concierge who actually books the trip and then travels with the customer, watching it around the clock. You are warm, sharp, and genuinely useful, and you know the ways of the world and especially of travel: how flights connect, how time zones and red-eyes and layovers really work, when a fare is a trap, what a place is like in a given season.

YOUR GOAL: get the customer booked with the least possible friction, and be genuinely helpful the whole way. Learn how they like to travel, what they can spend, and how they like to communicate — then anticipate, and once they are on the trip, watch for anything that matters, good or bad, and handle it.

WHAT TURES IS (weave in only when relevant — never as a pitch list):
- An executor, not a search box: you end in confirmation numbers, not links. You check real availability and fares before you ever promise something — you never invent a price, a seat, or a time.
- Their fixer and their alarm system: once a trip is booked you watch every leg and pre-stage the fix before a disruption reaches them — and you flag the upside too, like a fare drop, a free upgrade, or a better table.
- A local expert wherever they're going, and a maximizer: the right card for each spend, the miles credited, the better room at the same price.
- Someone who learns them: a few choices become a Taste Print so you stop asking the same things every trip. Their payment, IDs, and travel docs live encrypted in the Vault so you can book in their name — that is why real details matter, it is what unlocks booking, not bureaucracy.

THIS CONVERSATION: a natural back-and-forth, spoken or typed. Your job here is to understand the trip well enough to build it, then hand it off. Keep every reply short — one or two sentences, no markdown, no lists, no emoji, no exclamation marks. Talk like an intelligent, warm human with a light sense of humor — not a form.

WHAT YOU NEED before you can plan (gather it conversationally, one natural question at a time, skipping anything already known): where they're leaving from, where they're going (a vibe like "somewhere warm, you pick" is fine), when and for how long, who's coming, how they like to fly and stay, and how freely they want to spend. Origin is required — if you do not know their home airport, ask; never guess it. Accept vague answers and refine later. The moment you have enough for a strong first plan, stop asking, recap it in one line, and offer to build it.

LOOKING THINGS UP: you can web_search for real, current facts when it genuinely helps the traveler — the season and weather pattern at a destination, whether dates collide with a festival, marathon, holiday, or strike, entry rules, or a current safety/event note. Use it sparingly and only when it changes your advice; never let a search slow down simple slot-gathering, and never invent a fact you could have checked. Cite what you found in plain language, briefly.

READING THEM: notice how they communicate and match it — terse or chatty, detail-first or vibe-first, reading or listening (you can speak, via voice). If they arrive ready, confirm the gaps and go. If they arrive with a wish, take the lead warmly and teach as you go.

THE REAL RULES:
- Confirm the specifics — dates, times, who is traveling — before you commit a booking.
- Never invent availability or prices; those come from a real check.
- Never spend their money beyond the trip you agreed on without asking first.
- When you are genuinely unsure, ask one short question. Otherwise use common sense and keep things moving.
- Do not open with the time of day; you may be reaching them in any timezone.

HAND-OFF: the moment you have all the essentials, CALL the submit_brief tool — fill every required field plus a one-sentence brief — and tell them you are putting it together now. Do not keep asking once you have enough.`;

const TOOLS = [
  {
    name: "submit_brief",
    description:
      "Call this ONLY when you have all six essentials — origin, destination, timing, travelers, style, and budget. It hands a complete brief to the booking engine, which plans flights and stays. Do not call it early, and never invent a value to fill it; if something is missing, ask for it instead.",
    input_schema: {
      type: "object" as const,
      properties: {
        origin: { type: "string", description: "Home / departure city or airport. Required — never guess it." },
        destination: { type: "string", description: "Where they're going. A vibe like 'somewhere warm, you pick' is acceptable if they want you to choose." },
        timing: { type: "string", description: "Exact dates or a window plus length, e.g. 'Dec 3–14' or 'a week this winter'." },
        travelers: { type: "string", description: "Who's coming, e.g. '2 adults' or '2 adults + 2 kids'." },
        style: { type: "string", description: "How they fly and stay — cabin + lodging, e.g. 'business, boutique', or 'apply my Taste Print'." },
        budget: { type: "string", description: "Budget posture: budget-friendly | balanced | treat-ourselves | no-limit, plus an optional cap." },
        brief: { type: "string", description: "One sentence the planner can act on, weaving the above together. E.g. 'From Seattle, a week on Maui in December for two, premium cabin and a boutique stay, treat-ourselves with no hard cap.'" },
        purpose: { type: "string", description: "Optional. celebrate | decompress | adventure | romance | reconnect | business." },
        mustHaves: { type: "string", description: "Optional. Named non-negotiables — a specific hotel, restaurant, or excursion." },
      },
      required: ["origin", "destination", "timing", "travelers", "style", "budget", "brief"],
    },
  },
];

// Anthropic server-side web search — executed by Anthropic mid-turn (no client round-trip). Gives
// the conversational agent real, current facts (weather/season, events, advisories) instead of
// only training data. Bounded so it can't run away with latency or cost.
const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 2 } as const;

export async function converseRoutes(app: FastifyInstance) {
  app.post("/converse", async (req, reply) => {
    const p = Body.safeParse(req.body);
    if (!p.success) return reply.status(400).send({ error: "invalid_request" });
    // A chat brain is either Sakana Fugu (primary, experimental) or Anthropic (fallback). Need one.
    if (!config.anthropicKey && !config.sakana.enabled) {
      return reply.status(501).send({ error: "agent_not_configured", reply: "My brain isn't connected yet — no chat model is set." });
    }
    const msgs = p.data.messages.slice(-12);
    if (p.data.text) msgs.push({ role: "user", content: p.data.text });
    if (!msgs.length) msgs.push({ role: "user", content: "Hello — what are you?" });

    const latestUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
    let system = SYSTEM;
    if (p.data.context) system += `\n\nWHAT YOU ALREADY KNOW about this traveler (skip any question these answer; do not re-ask): ${p.data.context}`;

    try {
      // Personalize from mem0: what we remember about this traveler (taste, past trips). No-op without a key.
      const memories = await recall(p.data.userId, latestUser);
      if (memories.length) {
        system += `\n\nWHAT YOU REMEMBER about this traveler (from past trips and chats — use it to personalize and to reference what they've loved before, but confirm before assuming):\n- ${memories.join("\n- ")}`;
      }

      let text = "";
      let slots: Record<string, any> | null = null; // submit_brief args when the model committed a brief
      let via: "fugu" | "anthropic" = "anthropic";
      let fuguRaw: any = null; // raw Fugu message, surfaced only under the debug flag

      // ── Primary brain: Sakana Fugu (experiment) ──
      // When keyed, Fugu answers the chat. ANY failure (missing/expired key, wrong endpoint,
      // unexpected shape, network) falls through to Anthropic so chat never breaks. Note: the
      // Anthropic-only web_search server tool isn't available on the Fugu path.
      if (config.sakana.enabled) {
        try {
          const f = await fuguChat(
            system,
            msgs,
            { name: "submit_brief", description: TOOLS[0]!.description, parameters: TOOLS[0]!.input_schema },
            320,
          );
          text = f.text;
          slots = f.toolInput;
          fuguRaw = f.raw;
          via = "fugu";
        } catch (err) {
          log.warn("sakana fugu failed — falling back to anthropic", { err: String((err as any)?.message ?? err) });
          via = "anthropic";
        }
      }

      // ── Fallback brain: Anthropic ──
      if (via !== "fugu") {
        if (!config.anthropicKey) {
          // Fugu was the only brain configured and it failed — no fallback to reach.
          return reply.status(502).send({ error: "chat_brain_unavailable" });
        }
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey: config.anthropicKey, maxRetries: 3 });
        // The connection to Anthropic can drop mid-response ("Premature close"); retry such
        // transient network errors a couple of times before surfacing a failure.
        async function createWithRetry(tries: number): Promise<any> {
          try {
            // Stream the response and assemble it — reads the body in chunks (SSE), which
            // survives transport quirks that break a single one-shot body read ("Premature close").
            return await client.messages.stream({
              model: process.env.AGENT_MODEL ?? "claude-opus-4-8",
              max_tokens: 320,
              system,
              tools: [...TOOLS, WEB_SEARCH_TOOL] as any,
              messages: msgs,
            }).finalMessage();
          } catch (err) {
            const m = String((err && (err as any).message) || err);
            if (tries > 0 && /premature close|fetcherror|econnreset|terminated|socket hang up|fetch failed|network|aborted/i.test(m)) {
              await new Promise((r) => setTimeout(r, 600));
              return createWithRetry(tries - 1);
            }
            throw err;
          }
        }
        const resp = await createWithRetry(2);
        text = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ").trim();
        const tool = resp.content.find((b: any) => b.type === "tool_use" && b.name === "submit_brief") as any;
        slots = tool ? (tool.input || {}) : null;
      }

      // Learn from this turn (fire-and-forget), regardless of which brain answered.
      void remember(p.data.userId, [{ role: "user", content: latestUser }, { role: "assistant", content: text }]);

      const dbg = p.data.debug ? { _debug: { via, fuguMessage: fuguRaw } } : {};
      // submit_brief committed → hand the structured brief to the planner.
      if (slots && Object.keys(slots).length) {
        const brief = String(slots.brief || "").trim();
        return { reply: text || "On it — I have what I need. Putting your trip together now.", brief, ready: true, slots, via, ...dbg };
      }
      return { reply: text, via, ...dbg };
    } catch (e: any) {
      log.error("converse failed", {
        message: String(e?.message ?? e),
        name: e?.name,
        status: e?.status,
        type: e?.error?.type ?? e?.type,
      });
      return reply.status(502).send({ error: "converse_failed" });
    }
  });
}
