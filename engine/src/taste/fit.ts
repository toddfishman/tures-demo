// Taste fit — how well does this offer match this traveler, and can we say why?
//
// fit(offer, print) compares two vectors on the same six axes. Three things make it behave like
// a concierge rather than a filter:
//
//   1. NEUTRAL AXES ARE SILENT. Weight scales with how far the traveler sits from 50. Someone
//      with no opinion on `energy` never has a pick nudged by energy — which is why a fresh,
//      half-built print degrades gracefully instead of ranking randomly.
//   2. UNREADABLE OFFERS AREN'T PUNISHED. Weight also scales with the confidence of the offer
//      read. A bare listing scores ~0.5 with low coverage, and the caller uses `coverage` to
//      weight taste down in the blend rather than pretending to know.
//   3. EVERY PICK CARRIES ITS REASON. The axes that actually moved the number produce the
//      "why this one" line, including the honest negative ("grander than your usual").
import type { Offer } from "../types.ts";
import type { Axis, TasteDims, TasteFit, OfferTaste } from "./types.ts";
import { AXES, AXIS_PHRASE } from "./types.ts";
import { readOffer, type PeerContext } from "./features.ts";

/** How strongly an axis counts, given how opinionated the traveler is on it. */
function extremity(value: number): number {
  return Math.abs(value - 50) / 50; // 0 at neutral, 1 at either pole
}

/** Distance → agreement. Slightly convex so a near-miss still reads as a match and a wrong-side
 *  pick falls away fast: 0 apart → 1.0, 25 apart → 0.83, 50 apart → 0.5, 80 apart → 0.17. */
function agreementFor(distance: number): number {
  const d = Math.min(100, Math.max(0, distance)) / 100;
  return Math.max(0, 1 - Math.pow(d, 1.35) * 1.0 - (d > 0.5 ? (d - 0.5) * 0.3 : 0));
}

export interface FitOptions {
  /** Like-kind offers this one competes with — unlocks the relative-price read. */
  peers?: PeerContext;
  /** A pre-computed offer read (avoids re-reading when the caller already did). */
  read?: OfferTaste;
  /** Cap on how many "why" lines to produce. */
  maxReasons?: number;
}

export function tasteFit(offer: Offer, dims: TasteDims, opts: FitOptions = {}): TasteFit {
  const read = opts.read ?? readOffer(offer, opts.peers);
  const maxReasons = opts.maxReasons ?? 2;

  const axes: TasteFit["axes"] = [];
  let weighted = 0;
  let totalWeight = 0;
  let possibleWeight = 0;

  for (const axis of AXES) {
    const opinion = extremity(dims[axis]);
    possibleWeight += opinion; // what we COULD have judged if we read the offer perfectly
    const offerValue = read.dims[axis];
    const conf = read.confidence[axis] ?? 0;
    if (offerValue === undefined || conf <= 0 || opinion <= 0) continue;

    const weight = opinion * conf;
    const agreement = agreementFor(Math.abs(dims[axis] - offerValue));
    weighted += weight * agreement;
    totalWeight += weight;
    axes.push({ axis, offer: offerValue, traveler: dims[axis], weight, agreement });
  }

  // Nothing readable, or a traveler with no opinions at all → taste is neutral and says so.
  if (totalWeight <= 0) {
    return { fit: 0.5, coverage: 0, reasons: [], axes: [] };
  }

  const fit = weighted / totalWeight;
  const coverage = possibleWeight > 0 ? Math.min(1, totalWeight / possibleWeight) : 0;

  // ── Why this one ──────────────────────────────────────────────────────────────────────
  // Rank by how much each axis actually moved the score. Strong agreement becomes a positive
  // line; strong disagreement becomes an honest caveat, because a concierge who only ever
  // agrees with you is not telling you anything.
  const ranked = [...axes].sort((x, y) => y.weight * Math.abs(y.agreement - 0.5) - x.weight * Math.abs(x.agreement - 0.5));
  const reasons: string[] = [];
  for (const a of ranked) {
    if (reasons.length >= maxReasons) break;
    const pole = a.offer >= 50 ? "high" : "low";
    const phrase = AXIS_PHRASE[a.axis][pole as "low" | "high"];
    if (a.agreement >= 0.72) reasons.push(`${phrase} — the way you travel`);
    else if (a.agreement <= 0.34) reasons.push(offMarkPhrase(a.axis, a.traveler, a.offer));
  }

  return { fit: Math.round(fit * 100) / 100, coverage: Math.round(coverage * 100) / 100, reasons, axes };
}

/** The honest caveat when an offer sits on the wrong side of an axis the traveler cares about. */
function offMarkPhrase(axis: Axis, traveler: number, offer: number): string {
  const higher = offer > traveler;
  const map: Record<Axis, [string, string]> = {
    pace: ["slower than your usual rhythm", "busier than your usual rhythm"],
    register: ["more low-key than you usually go", "grander than your usual"],
    energy: ["quieter than you usually like", "livelier than you usually like"],
    palate: ["safer on the plate than you like", "more adventurous on the plate than you usually go"],
    planning: ["looser than you usually plan", "more scheduled than you usually plan"],
    aesthetic: ["more traditional than your usual rooms", "more modern than your usual rooms"],
  };
  return `note: ${map[axis][higher ? 1 : 0]}`;
}

/** Convenience for ranking a whole like-kind set: reads peers once and returns fits in order. */
export function fitAll(offers: Offer[], dims: TasteDims): Map<string, TasteFit> {
  const peers: PeerContext = { prices: offers.map((o) => o.priceUsd) };
  const out = new Map<string, TasteFit>();
  for (const o of offers) out.set(o.id, tasteFit(o, dims, { peers }));
  return out;
}
