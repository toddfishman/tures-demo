// Traveler Context — the unifying input. At plan time we fold together the account's STANDING
// memory (Taste Print, cabin default, loyalty, "where you've been") with the THIS-TRIP brief
// (placeTypes, sentiment, budget posture) into one object the scorer and the agent both consume.
// This is what makes planning feel like a concierge who already knows you, instead of a search box.
//
// v2: the Taste Print is no longer just a bag of tags. `taste` carries the two profiles — the
// standing six-axis print and the same print bent by THIS trip's lens — plus how much evidence
// stands behind it. The scorer uses the axes; the agent reads the prose; the front-end shows the
// lens. One source of truth for all three.
import type { Brief } from "../types.ts";
import { getPrefs } from "../profile/prefs.ts";
import { getTravelerProfileRedacted, partySummary, type PartySummary } from "../profile/index.ts";
import { tasteSignal } from "../places/index.ts";
import { effectiveTaste, tasteProse, paceForBrief, type EffectiveTaste } from "../taste/service.ts";

export interface TravelerContext {
  /** Effective place-type terms for scoring: this-trip placeTypes + standing Taste Print. */
  placeTypes: string[];
  /** Personalization tags that boost (favorite tags from places + Taste Print tags). */
  tasteTags: string[];
  /** Dislikes that penalize a match (standing avoid + this-trip avoid). */
  avoid: string[];
  /** Cabin to plan for (brief wins; else the standing default; else economy). */
  cabin: Brief["cabin"];
  /** Budget posture (brief wins; else the standing default). */
  priceSensitivity: NonNullable<Brief["priceSensitivity"]>;
  /** Loyalty programs on file, for the agent to weigh routing/earn. */
  loyalty: string[];
  /** The two taste profiles for this trip — standing print, lens, and the bent result. */
  taste: EffectiveTaste;
  /** Standing household composition (self + saved companions) — who Tures plans for by default. */
  party: PartySummary;
  /** A short prose brief the agent reads ahead of the raw JSON. */
  prose: string;
}

const POSTURE_PHRASE: Record<string, string> = {
  thrifty: "is watching the budget — favor value",
  balanced: "wants a fair balance of value and quality",
  premium: "wants to treat themselves — lean into quality",
  no_limit: "is not price-sensitive — optimize purely for the best fit",
};

/** Build the context. `effectiveBrief` returns the brief with standing defaults applied so the
 *  rest of the pipeline (search/score/agent) sees one coherent picture. */
export function assembleContext(accountId: string, brief: Brief, lensId?: string): { context: TravelerContext; brief: Brief } {
  const prefs = getPrefs(accountId);
  const signal = tasteSignal(accountId);
  const profile = getTravelerProfileRedacted(accountId);
  const loyalty = ((profile?.meta as any)?.memberships ?? []).map((m: any) => m.program).filter(Boolean);
  const party = partySummary(accountId);

  const taste = effectiveTaste(accountId, brief, lensId);
  const tp = prefs?.tastePrint;
  const placeTypes = [...new Set([...(brief.placeTypes ?? []), ...(tp?.placeTypes ?? [])])];
  const tasteTags = [...new Set([...(signal.favoriteTags ?? []), ...(tp?.tags ?? [])])];
  const avoid = [...new Set([...(prefs?.avoid ?? []), ...(brief.tripSentiment?.avoid ?? [])])];
  const cabin = (brief.cabin && brief.cabin !== "economy" ? brief.cabin : prefs?.cabinDefault ?? brief.cabin) as Brief["cabin"];
  const priceSensitivity = (brief.priceSensitivity ?? prefs?.priceSensitivityDefault ?? "balanced") as NonNullable<Brief["priceSensitivity"]>;

  const lines: string[] = [];
  lines.push(`The traveler ${POSTURE_PHRASE[priceSensitivity]}${brief.budgetUsd ? `, with a hard cap of $${brief.budgetUsd.toLocaleString()}` : ""}.`);
  const tasteLine = tasteProse(taste);
  if (tasteLine) lines.push(`Taste Print: ${tasteLine}`);
  else if (tasteTags.length) lines.push(`Reads as: ${tasteTags.join(", ")}.`);
  if (signal.lovedPlaces?.length) lines.push(`Has loved: ${signal.lovedPlaces.slice(0, 5).join(", ")}.`);
  if (brief.tripSentiment?.purpose?.length) lines.push(`This trip is for: ${brief.tripSentiment.purpose.join(", ")} (pace: ${brief.tripSentiment.pace}).`);
  if (avoid.length) lines.push(`Keep off the table: ${avoid.join(", ")}.`);
  if (loyalty.length) lines.push(`Loyalty to credit/weigh: ${loyalty.join(", ")}.`);
  if (placeTypes.length) lines.push(`Place types that fit: ${placeTypes.join(", ")}.`);

  // Household on file — who Tures plans for by default. The per-trip brief still overrides this;
  // it's the standing crew so a family trip reads as one without the traveler re-stating it.
  if (party.travelingAs === "family") {
    const kids = party.childAges.length ? ` (ages ${party.childAges.join(", ")})` : "";
    lines.push(
      `Household on file: ${party.adults} adult${party.adults > 1 ? "s" : ""} + ${party.children} child${party.children > 1 ? "ren" : ""}${kids} — plan kid-friendly (room configs that fit everyone, family-appropriate spots) unless this trip says otherwise.`,
    );
  } else if (party.travelingAs === "couple") {
    lines.push(`Household on file: usually travels as a couple (2 adults).`);
  } else if (party.travelingAs === "group") {
    lines.push(`Household on file: a group of ${party.adults + party.children}.`);
  }
  const dietary = [...new Set([...(prefs?.dietary ?? []), ...party.dietary])];
  if (dietary.length) lines.push(`Dietary needs across the party: ${dietary.join(", ")}.`);

  const context: TravelerContext = { placeTypes, tasteTags, avoid, cabin, priceSensitivity, loyalty, taste, party, prose: lines.join(" ") };

  // Keep the brief's own pace consistent with the lensed print rather than letting the two
  // disagree — a "unwind" lens that leaves pace on "full" produces incoherent plans.
  const tripSentiment = brief.tripSentiment
    ? { ...brief.tripSentiment, pace: taste.known ? paceForBrief(taste) : brief.tripSentiment.pace }
    : brief.tripSentiment;
  const effectiveBrief: Brief = { ...brief, placeTypes, cabin, priceSensitivity, tripSentiment };
  return { context, brief: effectiveBrief };
}
