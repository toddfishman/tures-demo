// The Taste Engine — domain model.
//
// Two profiles, one traveler (the model Todd set out in taste.html):
//   • STANDING Taste Print — "you, in general". Six 0–100 axes, built by the quiz and then
//     sharpened by what you actually book. Lives on the account.
//   • PER-TRIP LENS — "what THIS trip is for". Small per-axis deltas that bend only the
//     outliers; everything else stays you. Maps to brief.tripSentiment.purpose.
//
// The axes are deliberately few and orthogonal. Each is a spectrum with a low pole (0) and a
// high pole (100); 50 means "no opinion", which is load-bearing — an axis at 50 contributes
// NOTHING to scoring, so a half-finished print never pushes a bad pick.
import { z } from "zod";

/** The six axes. Order matters only for display. */
export const AXES = ["pace", "register", "energy", "palate", "planning", "aesthetic"] as const;
export type Axis = (typeof AXES)[number];

export const AXIS_POLES: Record<Axis, { low: string; high: string }> = {
  pace: { low: "languid", high: "packed" },
  register: { low: "under-the-radar", high: "grand" },
  energy: { low: "solitude", high: "social" },
  palate: { low: "comfort", high: "adventurous" },
  planning: { low: "spontaneous", high: "scripted" },
  aesthetic: { low: "heritage", high: "design-led" },
};

/** Human labels used in "why this one" copy, per pole. */
export const AXIS_PHRASE: Record<Axis, { low: string; high: string }> = {
  pace: { low: "unhurried, one base", high: "full days, keeps moving" },
  register: { low: "small and under-the-radar", high: "grand, landmark address" },
  energy: { low: "quiet and few", high: "alive, sociable" },
  palate: { low: "the reliable great", high: "adventurous on the plate" },
  planning: { low: "room to drift", high: "the day already shaped" },
  aesthetic: { low: "heritage, patina, character", high: "clean and design-led" },
};

export type TasteDims = Record<Axis, number>;

export const NEUTRAL: TasteDims = { pace: 50, register: 50, energy: 50, palate: 50, planning: 50, aesthetic: 50 };

export const DimsSchema = z.object({
  pace: z.number().min(0).max(100),
  register: z.number().min(0).max(100),
  energy: z.number().min(0).max(100),
  palate: z.number().min(0).max(100),
  planning: z.number().min(0).max(100),
  aesthetic: z.number().min(0).max(100),
});

/** How much evidence stands behind each axis. Drives both the learning rate (early observations
 *  move a lot, later ones barely) and the honesty of the UI ("learned across N trips"). */
export const EvidenceSchema = z.object({
  pace: z.number().nonnegative().default(0),
  register: z.number().nonnegative().default(0),
  energy: z.number().nonnegative().default(0),
  palate: z.number().nonnegative().default(0),
  planning: z.number().nonnegative().default(0),
  aesthetic: z.number().nonnegative().default(0),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** One thing the engine learned, kept so the traveler can see (and undo) why their print moved.
 *  This is what makes the Taste Print auditable instead of a black box. */
export const LearningSchema = z.object({
  ts: z.string(),
  source: z.enum(["quiz", "booked", "swapped", "declined", "rated", "manual"]),
  /** What the traveler acted on, in their words ("Hôtel Particulier Montmartre"). */
  subject: z.string().default(""),
  /** Axis → signed shift actually applied, after the learning-rate damping. */
  shifts: z.record(z.string(), z.number()).default({}),
  /** One plain-English line: "chose the 12-room townhouse over two big-box towers". */
  note: z.string().default(""),
});
export type Learning = z.infer<typeof LearningSchema>;

/** The stored Taste Print. v2 = v1 (dims/tags/placeTypes/signature) + evidence + history.
 *  v1 prints load cleanly: missing fields default, dims fill from NEUTRAL. */
export const TastePrintSchema = z.object({
  version: z.literal(2).default(2),
  dims: DimsSchema.default(NEUTRAL),
  /** Engine search vocabulary derived from dims (design-hotel, boutique…). Regenerated on save. */
  placeTypes: z.array(z.string()).default([]),
  /** Human-readable taste tags from the quiz ("Hidden over famous"). Display + soft matching. */
  tags: z.array(z.string()).default([]),
  /** The prose "you read as…" line. Regenerated whenever dims move materially. */
  signature: z.string().default(""),
  evidence: EvidenceSchema.default({ pace: 0, register: 0, energy: 0, palate: 0, planning: 0, aesthetic: 0 }),
  /** Last 40 learnings, newest last. Bounded so the row never grows without limit. */
  history: z.array(LearningSchema).default([]),
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type TastePrint = z.infer<typeof TastePrintSchema>;

/** The per-trip lens. `deltas` bend the standing print; only axes present are touched. */
export interface Lens {
  id: string;
  label: string;
  /** Icon key the front-end maps to an SVG. */
  icon: string;
  deltas: Partial<Record<Axis, number>>;
  /** The one-line explanation shown under the lens picker. `<b>` allowed. */
  blurb: string;
}

/** What a scored offer got from taste, and why. Attached to Offer.taste. */
export interface TasteFit {
  /** 0..1 — how well this offer matches the effective (lensed) print. 0.5 when unreadable. */
  fit: number;
  /** How much of the print we could actually evaluate against this offer, 0..1. Low coverage
   *  means "we couldn't read this one", and the blend weights taste down accordingly. */
  coverage: number;
  /** Human "why this one" lines, strongest first. */
  reasons: string[];
  /** Per-axis detail for the UI / debugging: what we read the offer as, and how far off it is. */
  axes: Array<{ axis: Axis; offer: number; traveler: number; weight: number; agreement: number }>;
}

/** What the offer itself reads as. Only axes we found real evidence for are present. */
export interface OfferTaste {
  dims: Partial<Record<Axis, number>>;
  /** Per-axis 0..1 — how sure we are we read that axis correctly. */
  confidence: Partial<Record<Axis, number>>;
  /** Terms/signals that drove the read, for explainability. */
  signals: string[];
}

export function clampDim(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Fill a partial/legacy dims object out to all six axes, defaulting to neutral. */
export function normalizeDims(input: Record<string, number> | undefined | null): TasteDims {
  const out = { ...NEUTRAL };
  if (!input) return out;
  for (const a of AXES) if (typeof input[a] === "number" && isFinite(input[a])) out[a] = clampDim(input[a]);
  return out;
}
