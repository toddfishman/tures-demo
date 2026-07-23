// The per-trip lens — "what is THIS trip for?"
//
// A lens applies small per-axis deltas to the standing Taste Print. The rule Todd set: the lens
// bends the OUTLIERS, not the whole person. So deltas are modest (≤30 on any axis) and are
// applied with diminishing return near the poles — a traveler already at 88 on register doesn't
// get shoved to 100 by "Celebrate"; someone at 40 moves further. That keeps a lensed print
// recognizably the same traveler.
//
// This table is the SINGLE SOURCE OF TRUTH. taste.html used to hardcode its own copy; it now
// fetches this via GET /taste/lenses so the panel a traveler sees is exactly what the planner
// scores against.
import type { Axis, Lens, TasteDims } from "./types.ts";
import { AXES, clampDim } from "./types.ts";

export type { Lens };

export const LENSES: Lens[] = [
  {
    id: "usual",
    label: "My usual",
    icon: "feather",
    deltas: {},
    blurb: "This is <b>you, in general</b> — what Tures reaches for when nothing about the trip says otherwise.",
  },
  {
    id: "celebrate",
    label: "Celebrate",
    icon: "spark",
    deltas: { register: 24, energy: 30, palate: 12, aesthetic: 6 },
    blurb: "A celebration <b>trades up</b> — louder energy, sharper rooms, bolder plates than your everyday. The rest stays you.",
  },
  {
    id: "unwind",
    label: "Unwind",
    icon: "moon",
    deltas: { pace: -26, energy: -22, planning: -18, palate: -8 },
    blurb: "To decompress, Tures <b>drops the pace hard</b> — slow mornings, low energy, nothing over-planned.",
  },
  {
    id: "adventure",
    label: "Adventure",
    icon: "compass",
    deltas: { energy: 30, pace: 22, palate: 16, planning: -16, aesthetic: -8 },
    blurb: "On an adventure it <b>pushes out</b> — full days, high energy, food you've never tried, loosely mapped.",
  },
  {
    id: "work",
    label: "Work",
    icon: "briefcase",
    deltas: { planning: 28, pace: 22, register: 16, energy: -10 },
    blurb: "A work trip <b>tightens up</b> — mapped, efficient, a notch more polished — energy dialed down.",
  },
  {
    id: "romance",
    label: "Romance",
    icon: "heart",
    deltas: { register: 22, aesthetic: 14, energy: -16, pace: -12 },
    blurb: "Romance goes <b>quieter and finer</b> — refined, beautiful rooms, unhurried and low-key.",
  },
  {
    id: "family",
    label: "Family",
    icon: "users",
    deltas: { pace: -20, palate: -22, energy: 8, planning: 12 },
    blurb: "With family it <b>simplifies</b> — gentler pace, crowd-pleasing food, a little more structure.",
  },
];

const BY_ID = new Map(LENSES.map((l) => [l.id, l]));

/** Words a traveler actually types into `tripSentiment.purpose`, mapped to a lens. The brief is
 *  written by an LLM from free prose, so this has to be forgiving. */
const PURPOSE_ALIASES: Array<[RegExp, string]> = [
  [/anniversar|birthday|celebrat|honeymoon|milestone|graduat|wedding/i, "celebrate"],
  [/unwind|relax|decompress|recharge|rest|spa|reset|burn ?out/i, "unwind"],
  [/adventur|explor|hike|hiking|trek|surf|safari|dive|climb|backpack/i, "adventure"],
  [/work|business|conference|client|meeting|offsite|summit|corporate/i, "work"],
  [/roman|couple|date|getaway with (my )?(wife|husband|partner|girlfriend|boyfriend)/i, "romance"],
  [/family|kids|children|grandparent|multigenerational|toddler/i, "family"],
];

export function getLens(id: string | undefined | null): Lens {
  return (id && BY_ID.get(id)) || BY_ID.get("usual")!;
}

/** Resolve a lens from the brief's tripSentiment. Explicit lens id wins; otherwise the first
 *  purpose phrase that matches an alias; otherwise "usual". */
export function lensForPurpose(purposes: string[] | undefined, explicitId?: string): Lens {
  if (explicitId && BY_ID.has(explicitId)) return BY_ID.get(explicitId)!;
  for (const p of purposes ?? []) {
    for (const [re, id] of PURPOSE_ALIASES) if (re.test(p)) return BY_ID.get(id)!;
  }
  return BY_ID.get("usual")!;
}

/** Apply a lens with diminishing return near the poles, so a lens bends outliers rather than
 *  flattening everyone to the same extreme. A +24 delta moves a 40 by ~+21 but an 88 by ~+7. */
export function applyLens(dims: TasteDims, lens: Lens): TasteDims {
  const out = { ...dims };
  for (const axis of AXES) {
    const d = lens.deltas[axis];
    if (!d) continue;
    // Headroom toward the pole we're pushing to, normalized 0..1.
    const headroom = d > 0 ? (100 - dims[axis]) / 100 : dims[axis] / 100;
    // Squash: full delta at mid-scale, tapering as the axis approaches the pole.
    out[axis] = clampDim(dims[axis] + d * Math.min(1, headroom * 1.6));
  }
  return out;
}

/** Axes the lens moved by ≥ threshold, for the "↑ livelier" annotations. */
export function lensShifts(base: TasteDims, lensed: TasteDims, threshold = 8): Array<{ axis: Axis; delta: number }> {
  const out: Array<{ axis: Axis; delta: number }> = [];
  for (const axis of AXES) {
    const delta = lensed[axis] - base[axis];
    if (Math.abs(delta) >= threshold) out.push({ axis, delta });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/** The pace the brief should carry, derived from the lensed pace axis. Keeps
 *  brief.tripSentiment.pace consistent with the lens instead of letting them disagree. */
export function paceFromDims(dims: TasteDims): "easy" | "balanced" | "full" {
  if (dims.pace <= 38) return "easy";
  if (dims.pace >= 62) return "full";
  return "balanced";
}
