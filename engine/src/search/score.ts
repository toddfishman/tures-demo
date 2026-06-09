// Scoring v1 — "the right kinds of places." Ranks offers 0..1 against the brief. This is the
// deterministic, explainable baseline; Chunk 2's agent can layer LLM judgment on top, but the
// numeric floor here keeps results sane and gives every pick a reason string.
import type { Brief, Offer } from "../types.ts";

/** Score a set of like-kind offers in place (mutates score/scoreReasons) and return sorted.
 *  `tasteTags` are the account's favorite tags (from "where you've been") — a personalization
 *  boost layered on top of the brief's own placeTypes. */
export function scoreOffers(offers: Offer[], brief: Brief, tasteTags: string[] = []): Offer[] {
  if (offers.length === 0) return offers;

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
    let taste = 0.5;
    const terms = [...brief.placeTypes, ...tasteTags];
    if (terms.length) {
      const hay = [o.title, ...o.summary, String((o.raw as any).style ?? "")]
        .join(" ")
        .toLowerCase();
      const briefHits = brief.placeTypes.filter((t) => hay.includes(t.toLowerCase()));
      const tasteHits = tasteTags.filter((t) => hay.includes(t.toLowerCase()));
      const total = briefHits.length + tasteHits.length;
      taste = total ? Math.min(1, 0.5 + total * 0.22) : 0.4;
      if (briefHits.length) reasons.push(`matches ${briefHits.join(", ")}`);
      if (tasteHits.length) reasons.push(`your taste: ${tasteHits.join(", ")}`);
    }

    // Flight convenience: fewer stops is better.
    let convenience = 0.7;
    if (o.kind === "flight") {
      const stops = Number((o.raw as any).stops ?? 0);
      convenience = stops === 0 ? 1 : stops === 1 ? 0.7 : 0.4;
      if (stops === 0) reasons.push("nonstop");
    }

    // Weighted blend. Stays lean on taste; flights lean on convenience.
    const w =
      o.kind === "stay"
        ? { value: 0.35, budgetFit: 0.2, taste: 0.4, convenience: 0.05 }
        : { value: 0.4, budgetFit: 0.2, taste: 0.0, convenience: 0.4 };
    const score =
      value * w.value + budgetFit * w.budgetFit + taste * w.taste + convenience * w.convenience;

    o.score = Math.round(score * 100) / 100;
    o.scoreReasons = reasons;
  }

  return [...offers].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
