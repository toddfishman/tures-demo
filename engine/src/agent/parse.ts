// Prose → Brief. Turns a free-text trip description ("two of us, a long weekend in Lisbon,
// somewhere design-y") into the structured Brief the engine plans against. With an Anthropic key
// Claude does the extraction; without one, a heuristic produces a best-effort Brief plus a list
// of the assumptions it made — so the chat's "describe it once" promise works either way.
import { BriefSchema } from "../types.ts";
import type { Brief } from "../types.ts";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import { heuristicParse } from "./parse-heuristic.ts";

export interface ParseResult {
  brief: Brief;
  assumptions: string[];
  via: "agent" | "heuristic";
}

// Minimal city → IATA table for the heuristic path (the agent path needs none).
// Heuristic implementation lives in parse-heuristic.ts (also used by scenario tests).

export async function parseBrief(text: string, opts?: { heuristic?: boolean }): Promise<ParseResult> {
  if (opts?.heuristic || !config.anthropicKey) return heuristicParse(text);

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: config.anthropicKey });
    const resp = await client.messages.create({
      model: process.env.AGENT_MODEL ?? "claude-opus-4-8",
      max_tokens: 512,
      system:
        `Today is ${new Date().toISOString().slice(0, 10)}. ` +
        "Extract a structured travel brief from the user's prose. Use IATA codes for origin/" +
        "destination. Count travelers precisely: 'adults' is the number of adults and 'children' " +
        "the number of kids — e.g. '4 people (2 kids)' is adults:2, children:2. Resolve all dates " +
        "to the future relative to today — a bare month/day like 'December 3rd' means the next " +
        "December 3rd that has not yet passed; never return a date in the past. Read budget posture " +
        "into priceSensitivity: phrases like 'budget-friendly'/'cheap'/'save money' → thrifty; " +
        "'splurge'/'to the nines'/'money is no object'/'not price sensitive' → no_limit; 'nice but " +
        "reasonable'/'treat ourselves' → premium; otherwise balanced. If a hard dollar cap is stated " +
        "('under $5k'), set budgetUsd too. When they fly into one city but stay elsewhere " +
        "(e.g. PDX then Cannon Beach), set destination to the arrival airport IATA and lodgingArea " +
        "to the actual town. Read tripScope: 'flight + car/transfer only' → flights_transport; " +
        "'flights only' → flights_only; 'no activities/restaurants' → flights_stay; else full. " +
        "The prose may arrive as an initial brief followed by corrections — treat later updates as " +
        "overrides and merge them into one coherent brief. If something isn't stated, choose a " +
        "sensible default and note it in assumptions. Call emit_brief.",
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
              priceSensitivity: { type: "string", enum: ["thrifty", "balanced", "premium", "no_limit"] },
              budgetUsd: { type: "number" },
              cabin: { type: "string", enum: ["economy", "premium_economy", "business", "first"] },
              placeTypes: { type: "array", items: { type: "string" } },
              lodgingArea: { type: "string" },
              tripScope: { type: "string", enum: ["full", "flights_stay", "flights_transport", "flights_only"] },
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
