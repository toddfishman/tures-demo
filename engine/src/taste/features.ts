// Reading an offer's taste — "what kind of place IS this?"
//
// The old scorer did `haystack.includes(tag)`, which is wrong in both directions: "grand" matched
// Rio Grande, and a tag like "full days" could never match a hotel name at all. This module
// replaces that with a real read of the offer on the same six axes as the traveler's print, so
// fit becomes a distance between two comparable vectors instead of a bag-of-words coincidence.
//
// Two rules keep it honest:
//   1. WORD BOUNDARIES, not substrings. "grand" matches "Grand Hôtel", never "Rio Grande".
//   2. NEVER GUESS. Each axis carries a 0..1 confidence and axes with no evidence are simply
//      absent. The scorer then weights taste by how much of the offer it could actually read —
//      a bare "Hotel 42, $310" pulls the ranking toward price, exactly as it should.
//
// Structured signals (Google Places `types`/`rating`/`priceLevel`, Duffel star `rating`, mock
// `style`, flight `stops`/`cabin`) are trusted well above lexicon hits, because they are facts
// rather than marketing words.
import type { Offer } from "../types.ts";
import type { Axis, OfferTaste } from "./types.ts";
import { clampDim } from "./types.ts";

/** A lexicon entry: term(s) → an axis reading, with the confidence that reading deserves. */
interface Term {
  /** Matched case-insensitively on word boundaries. Multi-word phrases are matched verbatim. */
  words: string[];
  axis: Axis;
  /** Where this term places the offer on the axis, 0..100. */
  value: number;
  /** How much to trust it, 0..1. Marketing adjectives are weak; category nouns are strong. */
  weight: number;
}

// ── Lexicon ────────────────────────────────────────────────────────────────────────────────
// Kept deliberately small and high-precision. A term earns its place only if seeing it in a
// property name or editorial line is genuinely diagnostic. Ambiguous words are omitted, not
// hedged — coverage lost to caution is cheaper than a confidently wrong read.
const LEXICON: Term[] = [
  // register — under-the-radar ←→ grand
  { words: ["boutique", "townhouse", "guesthouse", "guest house", "inn", "riad", "ryokan", "pension", "bed and breakfast", "b&b"], axis: "register", value: 22, weight: 0.7 },
  { words: ["hidden", "tucked", "unmarked", "under the radar", "family-run", "family run"], axis: "register", value: 26, weight: 0.5 },
  { words: ["grand", "palace", "palais", "ritz", "regency", "imperial", "royal", "landmark"], axis: "register", value: 82, weight: 0.65 },
  { words: ["luxury", "five-star", "5-star", "deluxe", "flagship", "signature"], axis: "register", value: 76, weight: 0.5 },
  { words: ["hostel", "capsule", "budget", "motel", "lodge"], axis: "register", value: 12, weight: 0.7 },

  // aesthetic — heritage ←→ design-led
  { words: ["design", "design-led", "designer", "minimalist", "modern", "contemporary", "architect", "brutalist"], axis: "aesthetic", value: 82, weight: 0.65 },
  { words: ["historic", "heritage", "manor", "chateau", "château", "castle", "restored", "18th-century", "19th-century", "centuries-old", "antique", "belle epoque", "belle époque"], axis: "aesthetic", value: 18, weight: 0.65 },
  { words: ["farmhouse", "rustic", "cabin", "chalet", "cottage", "hacienda", "villa"], axis: "aesthetic", value: 26, weight: 0.5 },

  // energy — solitude ←→ social
  { words: ["retreat", "hideaway", "secluded", "private", "adults-only", "adults only", "tranquil", "serene", "quiet"], axis: "energy", value: 16, weight: 0.6 },
  { words: ["resort", "club", "beach club", "rooftop", "nightlife", "buzzing", "lively", "party", "vibrant"], axis: "energy", value: 78, weight: 0.6 },
  { words: ["spa", "wellness", "sanctuary", "onsen", "thermal", "sauna"], axis: "energy", value: 24, weight: 0.5 },

  // palate — comfort ←→ adventurous
  { words: ["tasting menu", "chef's table", "chefs table", "omakase", "michelin", "experimental", "foraged", "seasonal tasting"], axis: "palate", value: 84, weight: 0.7 },
  { words: ["street food", "hawker", "market stall", "izakaya", "taqueria", "night market"], axis: "palate", value: 76, weight: 0.65 },
  { words: ["steakhouse", "brasserie", "trattoria", "bistro", "classic", "traditional", "comfort food", "american"], axis: "palate", value: 26, weight: 0.5 },

  // pace — languid ←→ packed
  { words: ["residence", "apartment", "aparthotel", "suite", "villa", "long stay", "extended stay", "kitchenette"], axis: "pace", value: 28, weight: 0.55 },
  { words: ["all-inclusive", "all inclusive"], axis: "pace", value: 32, weight: 0.4 },

  // planning — spontaneous ←→ scripted
  { words: ["guided", "itinerary", "small-group tour", "small group tour", "scheduled departure", "guided tour"], axis: "planning", value: 78, weight: 0.6 },
  { words: ["self-guided", "self guided", "walk-in", "walk in", "no reservation", "first-come"], axis: "planning", value: 22, weight: 0.6 },
];

/** Google Places `types` are facts, not adjectives — the strongest signal we get on a stay,
 *  table or activity. Weighted accordingly. */
const PLACE_TYPES: Record<string, Array<{ axis: Axis; value: number; weight: number }>> = {
  resort_hotel: [{ axis: "energy", value: 76, weight: 0.8 }, { axis: "register", value: 70, weight: 0.6 }],
  bed_and_breakfast: [{ axis: "register", value: 22, weight: 0.85 }, { axis: "energy", value: 30, weight: 0.6 }],
  guest_house: [{ axis: "register", value: 20, weight: 0.85 }],
  hostel: [{ axis: "register", value: 10, weight: 0.9 }, { axis: "energy", value: 74, weight: 0.7 }],
  motel: [{ axis: "register", value: 14, weight: 0.85 }],
  cottage: [{ axis: "aesthetic", value: 26, weight: 0.7 }, { axis: "energy", value: 22, weight: 0.6 }],
  farmstay: [{ axis: "aesthetic", value: 20, weight: 0.8 }, { axis: "energy", value: 20, weight: 0.7 }],
  campground: [{ axis: "register", value: 12, weight: 0.85 }, { axis: "aesthetic", value: 22, weight: 0.6 }],
  fine_dining_restaurant: [{ axis: "register", value: 80, weight: 0.85 }, { axis: "planning", value: 72, weight: 0.6 }],
  bar: [{ axis: "energy", value: 74, weight: 0.7 }],
  night_club: [{ axis: "energy", value: 90, weight: 0.9 }],
  cafe: [{ axis: "energy", value: 42, weight: 0.4 }],
  spa: [{ axis: "energy", value: 20, weight: 0.8 }, { axis: "pace", value: 28, weight: 0.6 }],
  museum: [{ axis: "aesthetic", value: 30, weight: 0.5 }, { axis: "planning", value: 62, weight: 0.4 }],
  art_gallery: [{ axis: "aesthetic", value: 78, weight: 0.6 }],
  historical_landmark: [{ axis: "aesthetic", value: 18, weight: 0.7 }],
  hiking_area: [{ axis: "energy", value: 30, weight: 0.5 }, { axis: "pace", value: 70, weight: 0.6 }],
  national_park: [{ axis: "aesthetic", value: 24, weight: 0.5 }, { axis: "energy", value: 26, weight: 0.5 }],
  tourist_attraction: [{ axis: "register", value: 66, weight: 0.35 }],
  amusement_park: [{ axis: "energy", value: 82, weight: 0.7 }, { axis: "pace", value: 74, weight: 0.6 }],
};

/** Escape a lexicon term and wrap it so it only matches as a whole word/phrase. Apostrophes and
 *  hyphens inside a term are literal; the boundaries use \b where the edge is a word char. */
function termRegex(word: string): RegExp {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const left = /^\w/.test(word) ? "\\b" : "";
  const right = /\w$/.test(word) ? "\\b" : "";
  return new RegExp(`${left}${esc}${right}`, "i");
}
const COMPILED: Array<Term & { res: RegExp[] }> = LEXICON.map((t) => ({ ...t, res: t.words.map(termRegex) }));

/** Accumulate weighted readings per axis, then collapse to a weighted mean + a confidence that
 *  rises with corroboration but saturates (three agreeing signals ≈ as sure as we get). */
class AxisAccumulator {
  private acc = new Map<Axis, { sum: number; weight: number; top: number }>();
  readonly signals: string[] = [];

  add(axis: Axis, value: number, weight: number, signal?: string) {
    if (weight <= 0) return;
    const cur = this.acc.get(axis) ?? { sum: 0, weight: 0, top: 0 };
    cur.sum += value * weight;
    cur.weight += weight;
    cur.top = Math.max(cur.top, weight);
    this.acc.set(axis, cur);
    if (signal && !this.signals.includes(signal)) this.signals.push(signal);
  }

  collapse(): OfferTaste {
    const dims: Partial<Record<Axis, number>> = {};
    const confidence: Partial<Record<Axis, number>> = {};
    for (const [axis, v] of this.acc) {
      dims[axis] = clampDim(v.sum / v.weight);
      // Confidence: the strongest single signal, lifted a little by corroboration, capped at 0.95.
      const corroboration = Math.min(0.25, Math.max(0, v.weight - v.top) * 0.2);
      confidence[axis] = Math.min(0.95, v.top + corroboration);
    }
    return { dims, confidence, signals: this.signals.slice(0, 8) };
  }
}

/** Peer context lets us read RELATIVE signals — a $900 room among $300 rooms reads as grand;
 *  the same $900 among $2,000 rooms does not. Without peers we skip price entirely rather than
 *  invent an absolute threshold that would be wrong in Oslo and wrong again in Hanoi. */
export interface PeerContext {
  /** Prices of the like-kind offers this one is being ranked against. */
  prices: number[];
}

function priceRank(price: number, peers: number[]): number | null {
  const valid = peers.filter((p) => isFinite(p) && p > 0);
  if (valid.length < 3) return null; // too few to rank meaningfully
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (max - min < max * 0.15) return null; // prices too tightly bunched to be diagnostic
  return (price - min) / (max - min);
}

/** Read an offer's taste. `peers` is optional; supplying it unlocks the price-percentile read. */
export function readOffer(offer: Offer, peers?: PeerContext): OfferTaste {
  const a = new AxisAccumulator();
  const raw = (offer.raw ?? {}) as Record<string, unknown>;

  // ── 1. Structured facts first ──────────────────────────────────────────────────────────
  const types = Array.isArray(raw.types) ? (raw.types as string[]) : [];
  for (const t of types) {
    for (const r of PLACE_TYPES[t] ?? []) a.add(r.axis, r.value, r.weight, t.replace(/_/g, " "));
  }

  // Mock supplier style is an exact category label — treat it as a fact.
  const style = typeof raw.style === "string" ? raw.style : "";
  if (style) {
    const STYLE: Record<string, Array<{ axis: Axis; value: number }>> = {
      "design-hotel": [{ axis: "aesthetic", value: 86 }, { axis: "register", value: 62 }],
      boutique: [{ axis: "register", value: 24 }, { axis: "aesthetic", value: 66 }],
      "grand-dame": [{ axis: "register", value: 88 }, { axis: "aesthetic", value: 16 }],
      sauna: [{ axis: "energy", value: 22 }],
    };
    for (const r of STYLE[style] ?? []) a.add(r.axis, r.value, 0.8, style);
  }

  // Star rating (Duffel `rating`, 1–5) → register. A 5-star property IS a grand register claim.
  const stars = Number(raw.rating);
  if (isFinite(stars) && stars >= 1 && stars <= 5 && offer.kind === "stay") {
    a.add("register", clampDim(((stars - 1) / 4) * 80 + 12), 0.6, `${stars}-star`);
  }

  // Google price level → register (relative to its own market by construction).
  const level = raw.priceLevel;
  const LEVEL: Record<string, number> = {
    PRICE_LEVEL_INEXPENSIVE: 20,
    PRICE_LEVEL_MODERATE: 44,
    PRICE_LEVEL_EXPENSIVE: 70,
    PRICE_LEVEL_VERY_EXPENSIVE: 88,
  };
  if (typeof level === "string" && LEVEL[level] !== undefined) {
    a.add("register", LEVEL[level], 0.55, level.replace("PRICE_LEVEL_", "").toLowerCase().replace("_", " "));
  }

  // Review volume: a place with thousands of reviews is a known quantity, not a hidden one.
  const reviews = Number(raw.reviewCount);
  if (isFinite(reviews) && reviews > 0 && offer.kind !== "flight") {
    if (reviews >= 3000) a.add("register", 74, 0.4, "widely known");
    else if (reviews <= 150) a.add("register", 30, 0.35, "little-known");
  }

  // Flights read on convenience-adjacent axes only — a fare has no aesthetic.
  if (offer.kind === "flight") {
    const stops = Number(raw.stops);
    if (isFinite(stops)) a.add("pace", stops === 0 ? 40 : 66, 0.35, stops === 0 ? "nonstop" : `${stops} stop`);
    const cabin = typeof raw.cabin === "string" ? raw.cabin : "";
    const CABIN: Record<string, number> = { economy: 30, premium_economy: 52, business: 76, first: 90 };
    if (CABIN[cabin] !== undefined) a.add("register", CABIN[cabin], 0.45, cabin.replace("_", " "));
  }

  // ── 2. Relative price, when we have peers ──────────────────────────────────────────────
  if (peers && offer.kind !== "flight") {
    const rank = priceRank(offer.priceUsd, peers.prices);
    if (rank !== null) a.add("register", clampDim(18 + rank * 64), 0.45, rank > 0.66 ? "top of the set on price" : rank < 0.33 ? "gentlest price in the set" : "mid-priced here");
  }

  // ── 3. Lexicon over the words we have ──────────────────────────────────────────────────
  const editorial = typeof raw.summary === "string" ? raw.summary : "";
  const text = [offer.title, ...(offer.summary ?? []), editorial, style].join(" · ");
  for (const t of COMPILED) {
    const hit = t.words.find((_w, i) => t.res[i]?.test(text));
    if (hit) a.add(t.axis, t.value, t.weight, hit);
  }

  return a.collapse();
}
