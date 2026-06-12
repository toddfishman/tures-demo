// Traveler Context — the unifying input the user asked for. At plan time we fold together the
// account's STANDING memory (Taste Print, cabin default, loyalty, "where you've been") with the
// THIS-TRIP brief (placeTypes, sentiment, budget posture) into one object the scorer and the agent
// both consume. This is what makes planning feel like a concierge who already knows you, instead
// of a search box.
import type { Brief } from "../types.ts";
import { getPrefs } from "../profile/prefs.ts";
import { getTravelerProfileRedacted } from "../profile/index.ts";
import { tasteSignal } from "../places/index.ts";

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
export function assembleContext(accountId: string, brief: Brief): { context: TravelerContext; brief: Brief } {
  const prefs = getPrefs(accountId);
  const signal = tasteSignal(accountId);
  const profile = getTravelerProfileRedacted(accountId);
  const loyalty = ((profile?.meta as any)?.memberships ?? []).map((m: any) => m.program).filter(Boolean);

  const tp = prefs?.tastePrint;
  const placeTypes = [...new Set([...(brief.placeTypes ?? []), ...(tp?.placeTypes ?? [])])];
  const tasteTags = [...new Set([...(signal.favoriteTags ?? []), ...(tp?.tags ?? [])])];
  const avoid = [...new Set([...(prefs?.avoid ?? []), ...(brief.tripSentiment?.avoid ?? [])])];
  const cabin = (brief.cabin && brief.cabin !== "economy" ? brief.cabin : prefs?.cabinDefault ?? brief.cabin) as Brief["cabin"];
  const priceSensitivity = (brief.priceSensitivity ?? prefs?.priceSensitivityDefault ?? "balanced") as NonNullable<Brief["priceSensitivity"]>;

  const lines: string[] = [];
  lines.push(`The traveler ${POSTURE_PHRASE[priceSensitivity]}${brief.budgetUsd ? `, with a hard cap of $${brief.budgetUsd.toLocaleString()}` : ""}.`);
  if (tp?.signature) lines.push(`Taste Print: ${tp.signature}`);
  else if (tasteTags.length) lines.push(`Reads as: ${tasteTags.join(", ")}.`);
  if (signal.lovedPlaces?.length) lines.push(`Has loved: ${signal.lovedPlaces.slice(0, 5).join(", ")}.`);
  if (brief.tripSentiment?.purpose?.length) lines.push(`This trip is for: ${brief.tripSentiment.purpose.join(", ")} (pace: ${brief.tripSentiment.pace}).`);
  if (avoid.length) lines.push(`Keep off the table: ${avoid.join(", ")}.`);
  if (loyalty.length) lines.push(`Loyalty to credit/weigh: ${loyalty.join(", ")}.`);
  if (placeTypes.length) lines.push(`Place types that fit: ${placeTypes.join(", ")}.`);

  const context: TravelerContext = { placeTypes, tasteTags, avoid, cabin, priceSensitivity, loyalty, prose: lines.join(" ") };
  const effectiveBrief: Brief = { ...brief, placeTypes, cabin, priceSensitivity };
  return { context, brief: effectiveBrief };
}
