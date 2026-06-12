// Scoring v1 — "the right kinds of places." Ranks offers 0..1 against the brief. This is the
// deterministic, explainable baseline; Chunk 2's agent can layer LLM judgment on top, but the
// numeric floor here keeps results sane and gives every pick a reason string.
import type { Brief, Offer } from "../types.ts";

/** Score a set of like-kind offers in place (mutates score/scoreReasons) and return sorted.
 *  `tasteTags` are the account's favorite tags (from "where you've been") — a personalization
 *  boost layered on top of the brief's own placeTypes. `avoid` are this-trip dislikes that
 *  penalize a match. */
export function scoreOffers(offers: Offer[], brief: Brief, tasteTags: string[] = [], avoid: string[] = []): Offer[] {
  if (offers.length === 0) return offers;

  // Budget posture sets how hard "value" pulls against "taste/quality".
  //   thrifty  → value matters most;     no_limit → value irrelevant, optimize for fit.
  const posture = brief.priceSensitivity ?? "balanced";
  const valueMul = { thrifty: 1.6, balanced: 1, premium: 0.6, no_limit: 0.15 }[posture];
  const tasteMul = { thrifty: 0.7, balanced: 1, premium: 1.35, no_limit: 1.6 }[posture];

  const prices = offers.map((o) => o.priceUsd);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;

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

    // Taste match: the brief's placeTypes PLUS the account's favorite tags ("where you've been").
    const hay = [o.title, ...o.summary, String((o.raw as any).style ?? "")]
      .join(" ")
      .toLowerCase();
    let taste = 0.5;
    const terms = [...brief.placeTypes, ...tasteTags];
    if (terms.length) {
      const briefHits = brief.placeTypes.filter((t) => hay.includes(t.toLowerCase()));
      const tasteHits = tasteTags.filter((t) => hay.includes(t.toLowerCase()));
      const total = briefHits.length + tasteHits.length;
      taste = total ? Math.min(1, 0.5 + total * 0.22) : 0.4;
      if (briefHits.length) reasons.push(`matches ${briefHits.join(", ")}`);
      if (tasteHits.length) reasons.push(`your taste: ${tasteHits.join(", ")}`);
    }

    // This-trip dislikes: a hit pulls the option down and is called out honestly.
    const avoidHits = avoid.filter((t) => t && hay.includes(t.toLowerCase()));
    if (avoidHits.length) {
      taste = Math.max(0, taste - 0.3 * avoidHits.length);
      reasons.push(`note: you said avoid ${avoidHits.join(", ")}`);
    }

    // Flight convenience: fewer stops is better.
    let convenience = 0.7;
    if (o.kind === "flight") {
      const stops = Number((o.raw as any).stops ?? 0);
      convenience = stops === 0 ? 1 : stops === 1 ? 0.7 : 0.4;
      if (stops === 0) reasons.push("nonstop");
    }

    // Weighted blend. Stays lean on taste; flights lean on convenience. The value vs. taste
    // pull is scaled by the budget posture (thrifty pushes value up, premium/no_limit push taste).
    const w =
      o.kind === "stay"
        ? { value: 0.35 * valueMul, budgetFit: 0.2, taste: 0.4 * tasteMul, convenience: 0.05 }
        : { value: 0.4 * valueMul, budgetFit: 0.2, taste: 0.1 * tasteMul, convenience: 0.4 };
    const score =
      value * w.value + budgetFit * w.budgetFit + taste * w.taste + convenience * w.convenience;

    o.score = Math.round(score * 100) / 100;
    o.scoreReasons = reasons;
  }

  return [...offers].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
