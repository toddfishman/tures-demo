import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import { recall, remember, rememberTranscript } from "../mem0.ts";
import { logTurn } from "../conversation-log.ts";
import { compactConversation, capContext, recallQueryFromMessages } from "../agent/history.ts";
import { fuguChat } from "../agent/fugu.ts";
import { loadPlaybook } from "../agent/playbooks.ts";
import { resolveAccountId } from "../auth/index.ts";
import { partySummary, type PartySummary } from "../profile/index.ts";

/** A natural-language description of the saved crew for the system prompt / "same crew?" nudge.
 *  Prefers real names; falls back to relationship + age. Exported for testing. */
export function crewLine(party: PartySummary): string {
  const others = party.members.filter((m) => m.relationship !== "self");
  const names = others.map((m) => {
    const placeholder = !m.name || /^child \(\d+\)$/i.test(m.name) || /^(spouse|partner|parent|companion)$/i.test(m.name);
    if (!placeholder) return m.name as string;
    if (m.relationship === "child") return m.age != null ? `a ${m.age}-year-old` : "a child";
    return `your ${m.relationship}`;
  });
  const composition =
    `${party.adults} adult${party.adults > 1 ? "s" : ""}` +
    (party.children
      ? ` + ${party.children} child${party.children > 1 ? "ren" : ""}${party.childAges.length ? ` (ages ${party.childAges.join(", ")})` : ""}`
      : "");
  return names.length ? `${composition} — ${names.join(", ")}` : composition;
}

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
  // Client session id — keys verbatim transcript (mem0 run_id + engine audit log).
  sessionId: z.string().optional(),
  // Diagnostics: when true, the response includes the raw Fugu assistant message so we can see how
  // (or whether) it emitted the submit_brief tool. Safe — it's the model's own message, no secrets.
  debug: z.boolean().optional(),
});

const SYSTEM = loadPlaybook("converse");

const TOOLS = [
  {
    name: "submit_brief",
    description:
      "Call this ONLY when you have all six essentials — origin, destination, timing, travelers, style, and budget. It hands a complete brief to the booking engine, which plans flights and stays. Do not call it early, and never invent a value to fill it; if something is missing, ask for it instead.",
    input_schema: {
      type: "object" as const,
      properties: {
        origin: { type: "string", description: "Home / departure city or airport. Required — never guess it." },
        destination: { type: "string", description: "Arrival airport or city they fly into (IATA if known, e.g. PDX). Not the final town if they ground-transfer elsewhere." },
        lodgingArea: { type: "string", description: "Where they actually stay or spend time when different from the arrival airport, e.g. 'Cannon Beach, OR'. Omit if same as destination." },
        timing: { type: "string", description: "Exact dates or a window plus length, e.g. 'Dec 3–14' or 'a week this winter'." },
        travelers: { type: "string", description: "Who's coming, e.g. '2 adults' or '2 adults + 2 kids'." },
        style: { type: "string", description: "How they fly and stay — cabin + lodging, e.g. 'business, boutique', or 'apply my Taste Print'." },
        budget: { type: "string", description: "Budget posture: budget-friendly | balanced | treat-ourselves | no-limit, plus an optional cap." },
        scope: {
          type: "string",
          description:
            "What to plan: full (flight+hotel+extras) | flights_stay | flights_transport (flight + ground transfer only, no dining/activities) | flights_only.",
        },
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
    let msgs = [...p.data.messages];
    if (p.data.text) msgs.push({ role: "user", content: p.data.text });
    if (!msgs.length) msgs.push({ role: "user", content: "Hello — what are you?" });
    const compacted = compactConversation(msgs);
    const sessionId = p.data.sessionId || `sess_${Date.now().toString(36)}`;

    const latestUser = [...compacted].reverse().find((m) => m.role === "user")?.content ?? "";
    const recallQuery = recallQueryFromMessages(compacted, latestUser);
    let system = SYSTEM;
    const ctx = capContext(p.data.context);
    if (ctx) system += `\n\nWHAT YOU ALREADY KNOW about this traveler (skip any question these answer; do not re-ask): ${ctx}`;

    let fuguErr: string | null = null; // why the primary brain fell back — hoisted so the catch can report it under debug

    try {
      // Personalize from mem0: what we remember about this traveler (taste, past trips). No-op without a key.
      const memories = await recall(p.data.userId, recallQuery);
      if (memories.length) {
        system += `\n\nWHAT YOU REMEMBER about this traveler (from past trips and chats — use it to personalize and to reference what they've loved before, but confirm before assuming):\n- ${memories.join("\n- ")}`;
      }

      // Household on file — so when the traveler doesn't say who's coming, Tures confirms the usual
      // crew ("Same crew — you and Sam & Ben?") instead of asking cold, and plans kid-friendly.
      const party = partySummary(resolveAccountId(req));
      if (party.members.length > 1) {
        system += `\n\nWHO USUALLY TRAVELS (household on file): ${crewLine(party)}. When this trip's travelers aren't stated, do NOT ask cold — confirm this crew ("Same crew this time?") and count them for the brief's travelers. Plan kid-friendly when children are along. If they mention someone new, offer to remember them; if this trip is clearly just them, that's fine — don't force the crew on.`;
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
            compacted,
            { name: "submit_brief", description: TOOLS[0]!.description, parameters: TOOLS[0]!.input_schema },
            320,
          );
          text = f.text;
          slots = f.toolInput;
          fuguRaw = f.raw;
          via = "fugu";
        } catch (err) {
          fuguErr = String((err as any)?.message ?? err).slice(0, 300);
          log.warn("sakana fugu failed — falling back to anthropic", { err: fuguErr });
          via = "anthropic";
        }
      }

      // Phantom hand-off guard: Fugu sometimes narrates "on it — building it" WITHOUT calling
      // submit_brief, which would leave the traveler waiting on a trip that never builds. When it
      // produced no brief but its reply clearly signals a hand-off, force exactly one structured
      // retry with tool_choice pinned to submit_brief.
      if (via === "fugu" && !slots && /\b(on it|buil(d|t|ding)|put(ting)?\b[^.]*together|here'?s your plan|let me put)/i.test(text)) {
        try {
          const forced = await fuguChat(
            system,
            [...compacted, { role: "assistant", content: text }, { role: "user", content: "Call submit_brief now with the essentials you have." }],
            { name: "submit_brief", description: TOOLS[0]!.description, parameters: TOOLS[0]!.input_schema },
            320,
            true,
          );
          if (forced.toolInput && Object.keys(forced.toolInput).length) {
            slots = forced.toolInput;
            if (forced.text) text = forced.text;
            log.info("fugu phantom hand-off recovered via forced submit_brief");
          }
        } catch (e) {
          log.warn("fugu forced hand-off retry failed", { err: String((e as any)?.message ?? e) });
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
              messages: compacted,
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

      // Verbatim transcript — exact turns for tracing (mem0 infer=false + local audit log).
      const ready = !!(slots && Object.keys(slots).length);
      if (p.data.userId && latestUser) {
        logTurn({ userId: p.data.userId, sessionId, role: "user", content: latestUser });
      }
      if (p.data.userId && text) {
        logTurn({ userId: p.data.userId, sessionId, role: "assistant", content: text, via, ready });
      }
      const turnPair: { role: string; content: string }[] = [];
      if (latestUser) turnPair.push({ role: "user", content: latestUser });
      if (text) turnPair.push({ role: "assistant", content: text });
      if (ready && p.data.userId && slots) {
        const tripLine = String(slots.brief || slots.destination || "trip").trim().slice(0, 240);
        void remember(p.data.userId, [
          { role: "user", content: latestUser || "Ready to plan this trip" },
          { role: "assistant", content: `Trip brief locked: ${tripLine}` },
        ]);
      }

      void rememberTranscript(p.data.userId, sessionId, turnPair, { via, ready, turns: compacted.length });

      const dbg = p.data.debug ? { _debug: { via, fuguMessage: fuguRaw } } : {};
      log.info("converse reply", {
        via,
        userId: p.data.userId ? p.data.userId.slice(0, 12) : "anon",
        sessionId: sessionId.slice(0, 16),
        turns: compacted.length,
        memories: memories.length,
        ready,
      });
      // submit_brief committed → hand the structured brief to the planner.
      if (slots && Object.keys(slots).length) {
        const brief = String(slots.brief || "").trim();
        return { reply: text || "On it — I have what I need. Putting your trip together now.", brief, ready: true, slots, via, sessionId, ...dbg };
      }
      return { reply: text, via, sessionId, ...dbg };
    } catch (e: any) {
      const detail = {
        message: String(e?.message ?? e).slice(0, 300),
        name: e?.name,
        status: e?.status,
        type: e?.error?.type ?? e?.type,
      };
      log.error("converse failed", detail);
      // Debug-gated diagnostic (opt-in via {debug:true}) so an operator can see WHICH brain failed
      // and why — Fugu's fallback reason plus the Anthropic error — without reading Render logs or
      // exposing anything to normal traffic. No secrets: provider error bodies carry none.
      const diag = p.data.debug
        ? { _debug: { brainsConfigured: { fugu: config.sakana.enabled, anthropic: !!config.anthropicKey }, fuguError: fuguErr, anthropicError: detail, agentModel: process.env.AGENT_MODEL ?? "claude-opus-4-8" } }
        : {};
      return reply.status(502).send({ error: "converse_failed", ...diag });
    }
  });
}
