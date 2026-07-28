// Brand guardrails — the tweet's "vision model to check it against brand guidelines," done as a
// deterministic text check so it is always on (no key required) and never fabricates a verdict.
// Every creative must pass brandCheck() before it can publish. The rules encode Tures' core
// promises so an ad can never say something the product won't do.
//
// Matching is on WORD BOUNDARIES, never substrings. This is the same lesson the Taste scorer
// learned the hard way (`includes("grand")` matched "Rio Grande") — a banned word must match the
// word, not a fragment of an innocent one. There's a test for it in test/marketing.ts.
import type { BrandCheck } from "./types.ts";

export interface Brand {
  name: string;
  /** One line the model is told to write in. */
  voice: string;
  /** Concrete proof words that earn voice score — the brand's substance, in its own words. */
  proof: string[];
  /** Phrases an ad may NEVER contain (hard fail). These are promises the product won't keep or
   *  claims that would be a fake-success state. */
  forbidden: string[];
  /** Hype words that don't fail the check but drag the voice score down. */
  hype: string[];
}

// The brands this engine can grow. Keyed by product so the SAME marketing loop runs Tures or any
// other brand — you register its voice + guardrails here and point a campaign at it.
export const BRANDS: Record<string, Brand> = {
  Tures: {
    name: "Tures",
    voice:
      "Short, plain English. Calm and concrete. Tures is an AI travel concierge that books every " +
      "leg and hands back confirmation numbers, not links. A human always confirms before money moves.",
    proof: ["confirmation number", "confirmation numbers", "books every leg", "concierge", "no links"],
    // Fake-success + broken-promise claims. "books it automatically" / "no confirmation needed"
    // contradict the human-confirm gate; "guaranteed"/"instantly booked" are fake certainty.
    forbidden: [
      "guaranteed",
      "guarantee",
      "instantly booked",
      "books it automatically",
      "no confirmation needed",
      "without asking you",
      "cheapest guaranteed",
      "risk-free",
      "click here",
      "link in bio",
    ],
    hype: ["revolutionary", "game-changer", "game changer", "unbeatable", "insane", "magic", "10x", "disrupt"],
  },
};

const wordRe = (phrase: string) =>
  new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");

/** Deterministic brand check. Hard rules fail the gate; hype and length only move the score.
 *  An unknown product falls back to a neutral pass so the engine never blocks on a missing brand
 *  entry — but it earns no voice credit either (it is not flattered). */
export function brandCheck(product: string, c: { headline: string; body: string; cta: string }): BrandCheck {
  const brand = BRANDS[product];
  const text = `${c.headline}\n${c.body}\n${c.cta}`;
  const violations: string[] = [];
  const notes: string[] = [];

  if (!brand) {
    return { pass: true, score: 0.5, violations: [], notes: [`no brand guide for "${product}" — neutral pass`] };
  }

  for (const bad of brand.forbidden) {
    if (wordRe(bad).test(text)) violations.push(`says "${bad}" — against Tures' promises`);
  }

  // Voice score: start neutral, reward proof words, penalize hype and over-long copy.
  let score = 0.5;
  if (brand.proof.some((p) => wordRe(p).test(text))) score += 0.25;
  else notes.push("no concrete proof word (e.g. 'confirmation number') — copy reads generic");

  let hypeHits = 0;
  for (const h of brand.hype) if (wordRe(h).test(text)) hypeHits++;
  if (hypeHits) {
    score -= Math.min(0.3, hypeHits * 0.12);
    notes.push(`${hypeHits} hype word(s) — Tures stays calm and concrete`);
  }

  // Plain English: long headlines and long sentences read as ad-speak, not concierge.
  if (c.headline.length > 70) notes.push("headline is long — plainer is more Tures");
  const longestSentence = c.body.split(/[.!?]/).reduce((m, s) => Math.max(m, s.trim().split(/\s+/).length), 0);
  if (longestSentence > 24) notes.push("a sentence runs long — short is on-brand");

  score = Math.max(0, Math.min(1, score));
  return { pass: violations.length === 0, score: Math.round(score * 100) / 100, violations, notes };
}

/** The system voice line for the creative generator, so copy is on-brand at the source, not just
 *  filtered after. */
export function brandVoice(product: string): string {
  return BRANDS[product]?.voice ?? `Short, plain, honest copy for ${product}.`;
}
