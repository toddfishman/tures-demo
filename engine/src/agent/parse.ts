// Prose → Brief. Turns a free-text trip description ("two of us, a long weekend in Lisbon,
// somewhere design-y") into the structured Brief the engine plans against. With an Anthropic key
// Claude does the extraction; without one, a heuristic produces a best-effort Brief plus a list
// of the assumptions it made — so the chat's "describe it once" promise works either way.
import { BriefSchema } from "../types.ts";
import type { Brief } from "../types.ts";
import { config } from "../config.ts";
import { log } from "../logger.ts";

export interface ParseResult {
  brief: Brief;
  assumptions: string[];
  via: "agent" | "heuristic";
}

// Minimal city → IATA table for the heuristic path (the agent path needs none).
const CITY_IATA: Record<string, string> = {
  paris: "CDG", lisbon: "LIS", london: "LHR", "new york": "JFK", tokyo: "HND",
  kyoto: "KIX", seattle: "SEA", "san francisco": "SFO", "sf": "SFO", copenhagen: "CPH",
  helsinki: "HEL", ivalo: "IVL", rome: "FCO", barcelona: "BCN", amsterdam: "AMS",
  berlin: "BER", reykjavik: "KEF", oslo: "OSL", stockholm: "ARN", lima: "LIM",
  "big island": "KOA", kona: "KOA", hawaii: "KOA", honolulu: "HNL", maui: "OGG",
};

function isoDaysFromNow(days: number): string {
  const ms = Date.parse("2026-06-09T00:00:00Z") + days * 86400000; // stable base; refined by deploy clock
  return new Date(ms).toISOString().slice(0, 10);
}

function heuristicParse(text: string): ParseResult {
  const t = text.toLowerCase();
  const assumptions: string[] = [];

  const found: string[] = [];
  for (const city of Object.keys(CITY_IATA)) {
    if (t.includes(city)) found.push(city);
  }
  const fromMatch = t.match(/from\s+([a-z\s]+?)[,.\n]/);
  const fromCity = fromMatch?.[1]?.trim() ?? "";
  const origin = CITY_IATA[fromCity] ?? "SFO";
  if (!CITY_IATA[fromCity]) assumptions.push("assumed home airport SFO");

  const destCity = found.find((c) => CITY_IATA[c] !== origin) ?? found[0];
  const destination = destCity ? CITY_IATA[destCity]! : "LIS";
  if (!destCity) assumptions.push("couldn't read a destination yet — tell me the city and I'll re-plan");

  // Children, e.g. "(2 kids)", "2 children", "two kids".
  let children = 0;
  const kidMatch = t.match(/(\d+)\s*(?:kids?|children|child)/);
  if (kidMatch) children = Number(kidMatch[1]) || 0;

  let adults = 1;
  if (/family of (\d+)|(\d+) of us|party of (\d+)|(\d+)\s*people|(\d+)\s*adults/.test(t)) {
    const m = t.match(/family of (\d+)|(\d+) of us|party of (\d+)|(\d+)\s*people|(\d+)\s*adults/)!;
    const total = Number(m[1] || m[2] || m[3] || m[4] || m[5]) || 1;
    // "4 people (2 kids)" → 4 total, 2 kids → 2 adults. "2 adults" → 2 adults flat.
    adults = m[5] ? total : Math.max(1, total - children);
  } else if (/\b(couple|two of us|both of us|me and|my partner|my wife|my husband)\b/.test(t)) {
    adults = 2;
  }

  const cabin = /business/.test(t)
    ? "business"
    : /premium economy/.test(t)
      ? "premium_economy"
      : /first class/.test(t)
        ? "first"
        : "economy";

  const placeTypes: string[] = [];
  for (const kw of ["design-hotel", "design", "boutique", "ryokan", "sauna", "spa", "waterfront", "minimalist", "grand"]) {
    if (t.includes(kw.replace("-hotel", "")) || t.includes(kw)) placeTypes.push(kw);
  }

  const departDate = isoDaysFromNow(45);
  const returnDate = /weekend/.test(t) ? isoDaysFromNow(48) : isoDaysFromNow(52);
  assumptions.push(`assumed dates ${departDate} → ${returnDate} (none clearly stated)`);

  if (children) assumptions.push(`read ${adults} adult${adults > 1 ? "s" : ""} + ${children} child${children > 1 ? "ren" : ""}`);

  const brief = BriefSchema.parse({
    origin, destination, departDate, returnDate, adults, children, cabin,
    placeTypes: [...new Set(placeTypes)], bookingMode: "confirm_each",
  });
  return { brief, assumptions, via: "heuristic" };
}

export async function parseBrief(text: string): Promise<ParseResult> {
  if (!config.anthropicKey) return heuristicParse(text);

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: config.anthropicKey });
    const resp = await client.messages.create({
      model: process.env.AGENT_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 512,
      system:
        `Today is ${new Date().toISOString().slice(0, 10)}. ` +
        "Extract a structured travel brief from the user's prose. Use IATA codes for origin/" +
        "destination. Count travelers precisely: 'adults' is the number of adults and 'children' " +
        "the number of kids — e.g. '4 people (2 kids)' is adults:2, children:2. Resolve all dates " +
        "to the future relative to today — a bare month/day like 'December 3rd' means the next " +
        "December 3rd that has not yet passed; never return a date in the past. The prose may arrive " +
        "as an initial brief followed by '[Update]' corrections — treat later updates as overrides " +
        "and merge them into one coherent brief. If something isn't stated, choose a sensible default " +
        "and note it in assumptions. Call emit_brief.",
      tools: [
        {
          name: "emit_brief",
          description: "Return the structured brief.",
          input_schema: {
            type: "object",
            properties: {
              origin: { type: "string" }, destination: { type: "string" },
              departDate: { type: "string" }, returnDate: { type: "string" },
              adults: { type: "number" },
              children: { type: "number" },
              cabin: { type: "string", enum: ["economy", "premium_economy", "business", "first"] },
              placeTypes: { type: "array", items: { type: "string" } },
              assumptions: { type: "array", items: { type: "string" } },
            },
            required: ["origin", "destination", "departDate"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "emit_brief" },
      messages: [{ role: "user", content: text }],
    });
    const toolUse = resp.content.find((b) => b.type === "tool_use");
    if (toolUse && toolUse.type === "tool_use") {
      const input = toolUse.input as any;
      const assumptions: string[] = Array.isArray(input.assumptions) ? [...input.assumptions] : [];

      // The model can't always emit a 3-letter IATA origin (the traveler rarely states their
      // home airport). Rather than fail the whole parse — which silently drops us back to the
      // heuristic and loses the real Claude reading of dates/cabin/destination — fill the same
      // sensible default the heuristic uses, and surface it as an assumption.
      const iata = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : "");
      let origin = iata(input.origin);
      if (!/^[A-Z]{3}$/.test(origin)) {
        origin = "SFO";
        if (!assumptions.some((a) => /home airport/i.test(a))) assumptions.push("assumed home airport SFO");
      }
      const destination = iata(input.destination);
      if (!/^[A-Z]{3}$/.test(destination)) {
        // A missing/garbled destination means the model didn't actually understand the trip;
        // the heuristic's keyword matching is a safer read in that case.
        return heuristicParse(text);
      }

      // Deterministic backstop: never let a past departure through, even if the model ignores
      // the "future only" instruction. Roll the year forward until depart is today or later.
      const today = new Date().toISOString().slice(0, 10);
      let depart = String(input.departDate || "");
      let ret = input.returnDate ? String(input.returnDate) : undefined;
      if (/^\d{4}-\d{2}-\d{2}$/.test(depart) && depart < today) {
        const bumpYears = Number(today.slice(0, 4)) - Number(depart.slice(0, 4)) + (depart.slice(5) < today.slice(5) ? 1 : 0);
        const roll = (d: string) => `${Number(d.slice(0, 4)) + bumpYears}${d.slice(4)}`;
        depart = roll(depart);
        if (ret && /^\d{4}-\d{2}-\d{2}$/.test(ret)) ret = roll(ret);
        if (!assumptions.some((a) => /year/i.test(a))) assumptions.push(`assumed ${depart.slice(0, 4)} (next future occurrence)`);
      }

      const brief = BriefSchema.parse({ ...input, origin, destination, departDate: depart, returnDate: ret, bookingMode: "confirm_each" });
      return { brief, assumptions, via: "agent" };
    }
  } catch (e) {
    log.warn("parse via agent failed, falling back to heuristic", { err: String(e) });
  }
  return heuristicParse(text);
}
