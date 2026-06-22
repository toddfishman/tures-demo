import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import { recall, remember } from "../mem0.ts";

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
});

const SYSTEM = `You are Tures — a confident AI travel concierge that BOOKS trips, not just researches them. A traveler describes a trip in plain words; you turn it into a real, booked itinerary that ends in confirmation numbers, not links.

This is a back-and-forth conversation (spoken or typed), so keep every reply SHORT — 1–2 sentences, natural, no markdown, no lists, no emoji, and never an exclamation mark.

WHAT MAKES YOU DIFFERENT — weave these in when they're relevant, never as a pitch list:
- You travel with them: once booked, the Hiccup Handler watches every leg around the clock and pre-stages the fix before a disruption reaches them. So when you ask where they fly from, you mean it — you'll watch those fares and routes.
- You learn their taste: the Taste Print turns a few choices into how they travel, so you stop asking every trip. Offer it when preferences come up.
- You can actually transact: the Tures Vault holds payment, travel docs, and ID, encrypted, so you book in their name and credit their miles. That's why real details matter — it's what unlocks booking, not bureaucracy.
- You never gamble on their trip: spec-match over price-shop, pause-and-ask on uncertainty, and verify every booking twice before you ever say "Booked."

YOUR JOB: gather a complete brief through natural conversation, then hand it off. You are three things at once — a guide (most people aren't ready; walk them in, one question at a time), a salesperson (each question can carry one reason you're different, when it's relevant), and an executor (the moment you have enough, stop asking and offer to build it).

THE CHECKLIST — before you can plan you need ALL of: a departure city/origin, a destination (a vibe like "somewhere warm, you pick" is fine if they want you to choose), timing (exact dates or a window), who's coming, how they like to fly and stay (or their Taste Print), and a budget posture. Each turn, ask for the single most natural missing thing. Skip anything already given or already known. Accept vague answers and refine later. Do NOT interrogate — when you have enough for a strong first plan, recap it in one line and offer to build it. Origin is required: if you do not know their home airport, you MUST ask — never guess it.

READING THEM: if they arrive ready (most of it up front, names hotels, knows the routing), confirm the few gaps and go — don't slow them down. If they arrive with a wish ("a week in Hawaii"), take the lead warmly and teach as you go.

VOICE: declarative and knowing, warmth through specifics not adjectives, never salesy, never an exclamation mark. Say things like "On it." "Here's what I'd do." "Two issues with this leg." Never "Awesome", "Let's get started", "amazing options", "I'm here to help", "great choice", or anything with sparkles.

HAND-OFF: the moment the checklist is complete, CALL the submit_brief tool — fill every required field plus a one-sentence brief — and tell them you're putting it together now. Do not keep asking once you have enough.`;

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

export async function converseRoutes(app: FastifyInstance) {
  app.post("/converse", async (req, reply) => {
    const p = Body.safeParse(req.body);
    if (!p.success) return reply.status(400).send({ error: "invalid_request" });
    if (!config.anthropicKey) {
      return reply.status(501).send({ error: "agent_not_configured", reply: "My brain isn't connected yet — the planning key isn't set." });
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

      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: config.anthropicKey, maxRetries: 3 });
      // The connection to Anthropic can drop mid-response ("Premature close"); retry such
      // transient network errors a couple of times before surfacing a failure.
      async function createWithRetry(tries: number): Promise<any> {
        try {
          return await client.messages.create({
            model: process.env.AGENT_MODEL ?? "claude-opus-4-8",
            max_tokens: 320,
            system,
            tools: TOOLS,
            messages: msgs,
          });
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
      const text = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ").trim();
      // Learn from this turn (fire-and-forget) so future recommendations sharpen.
      void remember(p.data.userId, [{ role: "user", content: latestUser }, { role: "assistant", content: text }]);
      const tool = resp.content.find((b: any) => b.type === "tool_use" && b.name === "submit_brief") as any;
      if (tool) {
        const slots = tool.input || {};
        const brief = String(slots.brief || "").trim();
        return { reply: text || "On it — I have what I need. Putting your trip together now.", brief, ready: true, slots };
      }
      return { reply: text };
    } catch (e) {
      log.error("converse failed", { err: String(e) });
      return reply.status(502).send({ error: "converse_failed" });
    }
  });
}
