import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import { log } from "../logger.ts";

// Conversational Tures — a spoken back-and-forth that can explain the product (Taste Engine,
// budget posture, Hiccup Handler) and help plan a trip. Replies are short so they sound natural
// read aloud by TTS. Runs on Claude; 501 if no key.
const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).default([]),
  text: z.string().optional(),
});

const SYSTEM = `You are Tures — a warm, confident AI travel concierge that BOOKS trips, not just researches them. This is a spoken conversation, so keep replies short (1–3 sentences), natural, and easy to say aloud. No markdown, no bullet lists, no emoji.

When it's useful, explain what makes you different:
- Describe & book: the traveler tells you a trip in plain words and you plan and book every leg — flights, hotels, dinners — to their taste, charging only when it actually books.
- The Taste Engine: a few swipes build a standing Taste Print — how they like to travel (hidden gems vs grand hotels, unhurried vs packed) — and every trip starts from it.
- Budget posture: instead of a dollar box, they tell you how to weigh money — budget-friendly, balanced, treat-ourselves, or to-the-nines — with an optional hard cap.
- The Hiccup Handler: you watch every booked trip around the clock — flights, weather, strikes — and fix problems before they reach the traveler. You're on 24/7, pre-staging the fix and only telling them once it's handled.
- You verify every booking twice before you ever say "Booked," and never fake a confirmation.

Voice: declarative, knowing, never salesy; earn warmth through specifics; never use exclamation marks. If they want to plan, gather what you need conversationally — where, when, who's coming, how they like to fly and stay — and offer to plan it. If they're exploring, explain the difference and invite them to try.`;

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
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: config.anthropicKey });
      const resp = await client.messages.create({
        model: process.env.AGENT_MODEL ?? "claude-sonnet-4-6",
        max_tokens: 320,
        system: SYSTEM,
        messages: msgs,
      });
      const text = resp.content.filter((b) => b.type === "text").map((b: any) => b.text).join(" ").trim();
      return { reply: text };
    } catch (e) {
      log.error("converse failed", { err: String(e) });
      return reply.status(502).send({ error: "converse_failed" });
    }
  });
}
