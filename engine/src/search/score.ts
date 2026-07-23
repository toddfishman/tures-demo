// Scoring — "the right kinds of places." Ranks offers 0..1 against the brief. This is the
// deterministic, explainable baseline; the agent can layer LLM judgment on top, but the numeric
// floor here keeps results sane and gives every pick a reason string.
//
// v2 (Taste Engine): the taste term is no longer a substring hunt over the offer's text. It is a
// distance between the traveler's six-axis print (bent by this trip's lens) and a read of the
// offer on those same axes — see taste/features.ts and taste/fit.ts. Two consequences worth
// knowing before you touch the weights:
//
//   • Taste's share of the blend now scales with COVERAGE. When an offer can't be read (a bare
//     "Hotel 42, $310"), taste steps back and value/convenience decide — instead of a confident
//     0.4 pulled out of nowhere.
//   • The brief's explicit `placeTypes` still match literally, because "I want a design hotel" is
//     a request, not an inference, and it should outrank a learned preference.
import type { Brief, Offer } from "../types.ts";
import type { TasteDims } from "../taste/types.ts";
import { NEUTRAL } from "../taste/types.ts";
import { tasteFit } from "../taste/fit.ts";
import type { PeerContext } from "../taste/features.ts";

export interface ScoreOptions {
  /** Effective (lens-bent) taste dims. Omit for no personalization — everything stays neutral. */
  dims?: TasteDims;
  /** Favorite tags from "where you've been" + the quiz. Literal, soft matching. */
  tasteTags?: string[];
  /** Dislikes (standing + this-trip) that penalize a match. */
  avoid?: string[];
}

/** Word-boundary match — so "grand" hits "Grand Hôtel" and never "Rio Grande". */
function mentions(haystack: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const left = /^\w/.test(t) ? "\\b" : "";
  const right = /\w$/.test(t) ? "\\b" : "";
  return new RegExp(`${left}${esc}${right}`, "i").test(haystack);
}

/** Score a set of like-kind offers in place (mutates score/scoreReasons/taste) and return sorted. */
export function scoreOffers(offers: Offer[], brief: Brief, optsOrTags: ScoreOptions | string[] = {}, legacyAvoid: string[] = []): Offer[] {
  if (offers.length === 0) return offers;

  // Back-compat: the old signature was (offers, brief, tasteTags[], avoid[]).
  const opts: ScoreOptions = Array.isArray(optsOrTags) ? { tasteTags: optsOrTags, avoid: legacyAvoid } : optsOrTags;
  const dims = opts.dims ?? NEUTRAL;
  const tasteTags = opts.tasteTags ?? [];
  const avoid = opts.avoid ?? [];

  // Budget posture sets how hard "value" pulls against "taste/quality".
  //   thrifty  → value matters most;     no_limit → value irrelevant, optimize for fit.
  const posture = brief.priceSensitivity ?? "balanced";
  const valueMul = { thrifty: 1.6, balanced: 1, premium: 0.6, no_limit: 0.15 }[posture];
  const tasteMul = { thrifty: 0.7, balanced: 1, premium: 1.35, no_limit: 1.6 }[posture];

  const prices = offers.map((o) => o.priceUsd);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const peers: PeerContext = { prices };

  for (const o of offers) {
    const reasons: string[] = [];

    // Value: cheaper is better, normalized within the result set. (0..1)
    const value = 1 - (o.priceUsd - min) / span;
    if (value > 0.66) reasons.push("strong value vs. alternatives");

    // Budget fit: hard penalty if a single component already blows the trip budget.
    let budgetFit = 1;
    if (brief.budgetUsd) {
      const share = o.priceUsd / brief.budgetUsd;
      budgetFit = share <= 1 ? 1 : Math.max(0, 1 - (share - 1));
      if (share > 1) reasons.push("over budget");
      else if (share <= 0.5) reasons.push("well within budget");
    }

    const hay = [o.title, ...o.summary, String((o.raw as any)?.style ?? ""), String((o.raw as any)?.summary ?? "")].join(" · ");

    // ── Taste, three layers ──────────────────────────────────────────────────────────────
    // 1. The six-axis fit — the real personalization.
    const fit = tasteFit(o, dims, { peers });
    o.taste = fit;

    // 2. Explicit this-trip requests match literally and count for more than an inference.
    const briefHits = (brief.placeTypes ?? []).filter((t) => mentions(hay, t));
    // 3. Favorite tags from past trips — a soft nudge.
    const tagHits = tasteTags.filter((t) => mentions(hay, t));

    // Blend: start from the axis fit, weighted by how much of it we could actually read, and
    // fall back toward neutral for the unread remainder. Then add the literal bonuses.
    let taste = fit.coverage > 0 ? 0.5 + (fit.fit - 0.5) * (0.45 + 0.55 * fit.coverage) : 0.5;
    taste = Math.min(1, taste + briefHits.length * 0.14 + tagHits.length * 0.07);

    if (briefHits.length) reasons.push(`matches ${briefHits.join(", ")}`);
    if (tagHits.length) reasons.push(`your taste: ${tagHits.join(", ")}`);
    // The axis-level "why this one" lines, but only when the read was strong enough to mean it.
    if (fit.coverage >= 0.25) for (const r of fit.reasons) reasons.push(r);

    // This-trip dislikes: a hit pulls the option down and is called out honestly.
    const avoidHits = avoid.filter((t) => t && mentions(hay, t));
    if (avoidHits.length) {
      taste = Math.max(0, taste - 0.3 * avoidHits.length);
      reasons.push(`note: you said avoid ${avoidHits.join(", ")}`);
    }

    // Flight convenience: fewer stops is better.
    let convenience = 0.7;
    if (o.kind === "flight") {
      const stops = Number((o.raw as any)?.stops ?? 0);
      convenience = stops === 0 ? 1 : stops === 1 ? 0.7 : 0.4;
      if (stops === 0) reasons.push("nonstop");
    }

    // Weighted blend. Stays lean on taste; flights lean on convenience. The value vs. taste
    // pull is scaled by the budget posture (thrifty pushes value up, premium/no_limit push taste).
    const w =
      o.kind === "flight"
        ? { value: 0.4 * valueMul, budgetFit: 0.2, taste: 0.1 * tasteMul, convenience: 0.4 }
        : { value: 0.35 * valueMul, budgetFit: 0.2, taste: 0.4 * tasteMul, convenience: 0.05 };
    const score = value * w.value + budgetFit * w.budgetFit + taste * w.taste + convenience * w.convenience;

    o.score = Math.round(score * 100) / 100;
    // De-dupe reasons while preserving order; cap so a card stays readable.
    o.scoreReasons = [...new Set(reasons)].slice(0, 6);
  }

  return [...offers].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
