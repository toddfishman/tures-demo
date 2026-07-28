// Creative step — "generates on-brand creative." One Creative per pain point, written in the
// brand voice, then run through brandCheck() so nothing off-brand can reach the publish gate.
// Claude writes the copy when ANTHROPIC_API_KEY is set; otherwise a deterministic template builds
// honest, on-brand copy straight from the pain + angle so the loop still works offline.
import type { Channel, Creative, PainPoint } from "./types.ts";
import { brandCheck, brandVoice } from "./brand.ts";
import { nextCreativeId } from "./store.ts";
import { config } from "../config.ts";
import { log } from "../logger.ts";

function emptyMetrics() {
  return { impressions: 0, clicks: 0, conversions: 0, spendUsd: 0, ctr: 0, cpaUsd: null, simulated: true, readAt: new Date().toISOString() };
}

function assemble(product: string, channel: Channel, pp: PainPoint, copy: { headline: string; body: string; cta: string; imageBrief: string }): Creative {
  const now = new Date().toISOString();
  const check = brandCheck(product, copy);
  return {
    id: nextCreativeId(),
    channel,
    painPointId: pp.id,
    angle: pp.angle,
    headline: copy.headline,
    body: copy.body,
    cta: copy.cta,
    imageBrief: copy.imageBrief,
    brandCheck: check,
    // A creative that fails the brand check is born "rejected" and can never publish.
    status: check.pass ? "proposed" : "rejected",
    budgetDailyUsd: 0, // set by the service against the campaign cap when approved
    metrics: emptyMetrics(),
    simulated: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** Deterministic, on-brand copy from a pain + angle. Written to pass brandCheck: plain English,
 *  a concrete proof word, no hype, a real CTA (never "click here"). */
function templateCopy(pp: PainPoint): { headline: string; body: string; cta: string; imageBrief: string } {
  return {
    headline: `${pp.pain.replace(/\.$/, "")}?`,
    body: `${pp.angle}. Describe the trip once — Tures books every leg and sends back confirmation numbers, not links. A human confirms before any money moves.`,
    cta: "Plan a trip",
    imageBrief: `Calm, premium travel scene matching the destination mood. A single clear confirmation number card overlaid, no clutter. On-brand for ${pp.angle}.`,
  };
}

const WRITE_TOOL = {
  name: "write_ads",
  description: "Return one on-brand ad per pain point.",
  input_schema: {
    type: "object" as const,
    properties: {
      ads: {
        type: "array",
        items: {
          type: "object",
          properties: {
            painIndex: { type: "number", description: "0-based index into the pain points provided." },
            headline: { type: "string", description: "≤ 70 chars, plain English." },
            body: { type: "string", description: "1–2 short sentences." },
            cta: { type: "string", description: "A real action, e.g. 'Plan a trip'. Never 'click here'." },
            imageBrief: { type: "string", description: "A short text brief for an image model." },
          },
          required: ["painIndex", "headline", "body", "cta", "imageBrief"],
        },
      },
    },
    required: ["ads"],
  },
};

/** Generate one creative per pain point on `channel`. Off-brand generations come back with
 *  status "rejected" — the caller keeps them for the audit but never publishes them. */
export async function generateCreatives(product: string, channel: Channel, pains: PainPoint[]): Promise<Creative[]> {
  if (!pains.length) return [];

  if (!config.anthropicKey) {
    return pains.map((pp) => assemble(product, channel, pp, templateCopy(pp)));
  }

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: config.anthropicKey });
    const resp = await client.messages.create({
      model: process.env.AGENT_MODEL ?? "claude-opus-4-8",
      max_tokens: 1500,
      system:
        `You are ${product}'s ad copywriter. Voice: ${brandVoice(product)} ` +
        `Write honest copy — never promise anything ${product} won't do, never claim a guaranteed or ` +
        `instant result, never say "click here". Use a concrete proof word where it fits. Channel: ${channel}.`,
      tools: [WRITE_TOOL],
      messages: [
        {
          role: "user",
          content:
            `Pain points:\n` +
            pains.map((p, i) => `${i}. ${p.pain} — angle: ${p.angle}`).join("\n") +
            `\n\nWrite one ad per pain point via write_ads.`,
        },
      ],
    });
    const call = resp.content.find((b: any) => b.type === "tool_use" && b.name === "write_ads") as any;
    const ads: any[] = call?.input?.ads ?? [];
    const byIndex = new Map<number, any>(ads.map((a) => [Number(a.painIndex), a]));
    return pains.map((pp, i) => {
      const a = byIndex.get(i);
      const copy = a
        ? { headline: String(a.headline), body: String(a.body), cta: String(a.cta), imageBrief: String(a.imageBrief) }
        : templateCopy(pp);
      return assemble(product, channel, pp, copy);
    });
  } catch (e) {
    log.warn("marketing creative fell back to template", { err: String(e) });
    return pains.map((pp) => assemble(product, channel, pp, templateCopy(pp)));
  }
}
