import { BriefSchema } from "../types.ts";
import type { Brief } from "../types.ts";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import { parseBrief } from "../agent/parse.ts";
import { heuristicImportParse } from "./parse-heuristic.ts";
import type { ImportLeg, ImportParseResult } from "./types.ts";

const LEG_KINDS = ["flight", "stay", "dining", "activity", "transport"] as const;

function countGaps(legs: ImportLeg[]): number {
  return legs.filter((l) => {
    if (l.confidence === "low") return true;
    if ((l.kind === "flight" || l.kind === "stay") && !l.confirmation) return true;
    return false;
  }).length;
}

function normalizeLeg(raw: any, i: number): ImportLeg | null {
  const kind = LEG_KINDS.includes(raw.kind) ? raw.kind : "activity";
  const title = String(raw.title || "").trim();
  if (!title) return null;
  const conf = raw.confidence;
  const confidence =
    conf === "high" || conf === "medium" || conf === "low" ? conf : raw.confirmation ? "high" : "medium";
  return {
    kind,
    title,
    supplier: String(raw.supplier || kind).slice(0, 80),
    detail: raw.detail ? String(raw.detail) : undefined,
    confirmation: raw.confirmation ? String(raw.confirmation).toUpperCase().slice(0, 20) : undefined,
    confidence,
    sourceHint: raw.sourceHint ? String(raw.sourceHint) : "extracted",
    schedule: raw.schedule ? String(raw.schedule) : undefined,
    amountUsd: typeof raw.amountUsd === "number" ? raw.amountUsd : undefined,
  };
}

export async function parseImportItinerary(text: string, opts?: { heuristic?: boolean }): Promise<ImportParseResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    const empty = BriefSchema.parse({
      origin: "SEA",
      destination: "OGG",
      departDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      bookingMode: "propose_only",
      rebooking: { mode: "propose" },
    });
    return {
      brief: empty,
      legs: [],
      assumptions: ["no text provided"],
      via: "heuristic",
      gaps: 0,
    };
  }

  if (opts?.heuristic || !config.anthropicKey) return heuristicImportParse(trimmed);

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: config.anthropicKey, maxRetries: 2 });
    const briefResult = await parseBrief(trimmed);
    const resp = await client.messages.create({
      model: process.env.AGENT_MODEL ?? "claude-opus-4-8",
      max_tokens: 2000,
      system:
        `Today is ${new Date().toISOString().slice(0, 10)}. Extract every travel leg from confirmation emails, ` +
        "screenshots described in text, or itinerary prose. For each leg return kind (flight/stay/dining/activity/transport), " +
        "title, supplier, detail, confirmation code if present, schedule, and confidence (high/medium/low). " +
        "Mark low when time or confirmation is missing on flights or hotels. Call emit_import.",
      tools: [
        {
          name: "emit_import",
          description: "Return structured trip legs from the itinerary.",
          input_schema: {
            type: "object",
            properties: {
              legs: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    kind: { type: "string", enum: [...LEG_KINDS] },
                    title: { type: "string" },
                    supplier: { type: "string" },
                    detail: { type: "string" },
                    confirmation: { type: "string" },
                    schedule: { type: "string" },
                    confidence: { type: "string", enum: ["high", "medium", "low"] },
                    sourceHint: { type: "string" },
                  },
                  required: ["kind", "title"],
                },
              },
              assumptions: { type: "array", items: { type: "string" } },
            },
            required: ["legs"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "emit_import" },
      messages: [{ role: "user", content: trimmed }],
    });

    const tool = resp.content.find((b) => b.type === "tool_use" && b.name === "emit_import");
    if (tool && tool.type === "tool_use") {
      const input = tool.input as any;
      const legs = (Array.isArray(input.legs) ? input.legs : [])
        .map((l: any, i: number) => normalizeLeg(l, i))
        .filter(Boolean) as ImportLeg[];
      const assumptions = [
        ...briefResult.assumptions,
        ...(Array.isArray(input.assumptions) ? input.assumptions.map(String) : []),
      ];
      const brief: Brief = {
        ...briefResult.brief,
        bookingMode: "propose_only",
        rebooking: { mode: "propose" },
      };
      if (!legs.length) return heuristicImportParse(trimmed);
      return { brief, legs, assumptions, via: "agent", gaps: countGaps(legs) };
    }
  } catch (e) {
    log.warn("import parse agent failed, falling back", { err: String(e) });
  }

  return heuristicImportParse(trimmed);
}
