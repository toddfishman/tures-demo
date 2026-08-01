// The learning loop — "it learns the way a good concierge would, by paying attention."
//
// taste.html promises Tures learns from your trips, your corrections and your bookings. This is
// the code behind that sentence. The design turns on one idea:
//
//   LEARN FROM THE CONTRAST, NOT THE CHOICE.
//
// If a traveler books a design hotel when every other option was also a design hotel, the booking
// teaches nothing about `aesthetic` — they had no alternative. If they book the one 12-room
// townhouse over three glass towers, that single act is strong evidence about `register`. So each
// axis moves in proportion to how much the chosen offer DIFFERED from the ones it beat. Without
// this, a print drifts toward whatever the supplier happens to stock.
//
// Two more guards keep it stable:
//   • The learning rate decays with evidence — the first booking moves an axis ~12 points, the
//     tenth ~3. A print converges instead of oscillating.
//   • Total movement per event is capped, so no single booking rewrites a person.
import type { Offer } from "../types.ts";
import type { Axis, TasteDims, TastePrint, Learning } from "./types.ts";
import { AXES, clampDim } from "./types.ts";
import { readOffer, type PeerContext } from "./features.ts";

/** Base step for a brand-new axis, in points. */
const BASE_RATE = 14;
/** How fast the step decays as evidence accumulates. */
const DECAY = 0.55;
/** Never freeze completely — taste changes. */
const MIN_RATE = 2.5;
/** Max total absolute movement across all axes from one event. */
const MAX_EVENT_MOVE = 26;
/** Below this contrast (0..1) the choice was not informative on that axis. */
const CONTRAST_FLOOR = 0.12;

export type ObservationType = "booked" | "swapped" | "declined" | "rated";

export interface Observation {
  type: ObservationType;
  /** What the traveler chose / kept / rated well. */
  chosen?: Offer;
  /** What it beat — the alternatives that were on screen and not taken. Drives contrast. */
  rejected?: Offer[];
  /** For a swap: what they moved AWAY from. Treated as a strong rejection. */
  replaced?: Offer;
  /** 1–10, for `rated`. Above 7 pulls toward, below 4 pushes away. */
  rating?: number;
  /** Free-text reason the traveler gave, kept in the history line. */
  note?: string;
}

export interface LearnResult {
  dims: TasteDims;
  evidence: TastePrint["evidence"];
  learning: Learning | null;
}

function rateFor(evidence: number): number {
  return Math.max(MIN_RATE, BASE_RATE / (1 + evidence * DECAY));
}

/** Mean of the readable values for an axis across a set of offers, or null if none read it. */
function meanAxis(reads: Array<ReturnType<typeof readOffer>>, axis: Axis): { value: number; confidence: number } | null {
  let sum = 0;
  let weight = 0;
  for (const r of reads) {
    const v = r.dims[axis];
    const c = r.confidence[axis] ?? 0;
    if (v === undefined || c <= 0) continue;
    sum += v * c;
    weight += c;
  }
  if (weight <= 0) return null;
  return { value: sum / weight, confidence: Math.min(1, weight / reads.length) };
}

/**
 * Fold one observation into a print. Pure — returns the new dims/evidence and the audit line;
 * the caller decides whether to persist.
 */
export function learn(print: TastePrint, obs: Observation): LearnResult {
  const dims = { ...print.dims };
  const evidence = { ...print.evidence };

  const chosen = obs.chosen;
  if (!chosen) return { dims, evidence, learning: null };

  // Read the chosen offer against its actual competitive set, so relative signals (price rank)
  // mean what they meant on screen.
  const field = [chosen, ...(obs.rejected ?? []), ...(obs.replaced ? [obs.replaced] : [])];
  const peers: PeerContext = { prices: field.map((o) => o.priceUsd) };
  const chosenRead = readOffer(chosen, peers);
  const rejectedReads = (obs.rejected ?? []).map((o) => readOffer(o, peers));
  const replacedRead = obs.replaced ? readOffer(obs.replaced, peers) : null;

  // Direction and strength by observation type.
  //   booked   — pull toward the choice, scaled by contrast with what it beat
  //   swapped  — the strongest signal we get: an explicit correction
  //   declined — push away, gently (a no is weaker evidence than a yes)
  //   rated    — pull toward or away depending on the score
  const polarity =
    obs.type === "declined" ? -1 : obs.type === "rated" ? ((obs.rating ?? 5) >= 7 ? 1 : (obs.rating ?? 5) <= 4 ? -1 : 0) : 1;
  if (polarity === 0) return { dims, evidence, learning: null };
  const typeGain = obs.type === "swapped" ? 1.5 : obs.type === "booked" ? 1 : 0.6;

  const shifts: Record<string, number> = {};
  const contrasts: Array<{ axis: Axis; contrast: number; toward: number }> = [];

  for (const axis of AXES) {
    const mine = chosenRead.dims[axis];
    const conf = chosenRead.confidence[axis] ?? 0;
    if (mine === undefined || conf <= 0) continue;

    // What did it beat on this axis? Prefer the explicitly replaced offer (a correction), else
    // the mean of the rejected field. With no comparison set we still learn, but at half force —
    // an uncontested choice is weak evidence.
    const foil = replacedRead
      ? { value: replacedRead.dims[axis] ?? NaN, confidence: replacedRead.confidence[axis] ?? 0 }
      : meanAxis(rejectedReads, axis);

    let contrast: number;
    if (foil && isFinite(foil.value) && foil.confidence > 0) {
      contrast = Math.min(1, (Math.abs(mine - foil.value) / 100) * 2.2) * Math.min(1, foil.confidence + 0.3);
    } else {
      contrast = 0.5; // uncontested — half force
    }
    if (contrast < CONTRAST_FLOOR) continue; // the field was uniform here; it teaches nothing

    contrasts.push({ axis, contrast, toward: mine });
  }

  if (!contrasts.length) return { dims, evidence, learning: null };

  // Compute raw shifts, then scale them all down together if the event would move too much.
  const raw = contrasts.map((c) => {
    const rate = rateFor(evidence[c.axis] ?? 0);
    const target = polarity > 0 ? c.toward : 100 - c.toward; // a "no" pushes toward the opposite pole
    const direction = Math.sign(target - dims[c.axis]);
    const magnitude = rate * c.contrast * typeGain * Math.min(1, Math.abs(target - dims[c.axis]) / 30);
    return { axis: c.axis, delta: direction * magnitude, contrast: c.contrast };
  });

  const totalMove = raw.reduce((s, r) => s + Math.abs(r.delta), 0);
  const scale = totalMove > MAX_EVENT_MOVE ? MAX_EVENT_MOVE / totalMove : 1;

  for (const r of raw) {
    const delta = r.delta * scale;
    if (Math.abs(delta) < 0.5) continue;
    dims[r.axis] = clampDim(dims[r.axis] + delta);
    evidence[r.axis] = Math.round(((evidence[r.axis] ?? 0) + r.contrast) * 100) / 100;
    shifts[r.axis] = Math.round(delta * 10) / 10;
  }

  if (!Object.keys(shifts).length) return { dims, evidence, learning: null };

  const learning: Learning = {
    ts: new Date().toISOString(),
    source: obs.type,
    subject: chosen.title,
    shifts,
    note: obs.note ?? describe(obs, chosen, chosenRead.signals),
  };
  return { dims, evidence, learning };
}

function describe(obs: Observation, chosen: Offer, signals: string[]): string {
  const what = signals.length ? ` (${signals.slice(0, 3).join(", ")})` : "";
  switch (obs.type) {
    case "swapped":
      return `swapped ${obs.replaced?.title ?? "the proposed option"} for ${chosen.title}${what}`;
    case "declined":
      return `passed on ${chosen.title}${what}`;
    case "rated":
      return `rated ${chosen.title} ${obs.rating}/10`;
    default: {
      const beat = obs.rejected?.length ?? 0;
      return `booked ${chosen.title}${what}${beat ? ` over ${beat} alternative${beat === 1 ? "" : "s"}` : ""}`;
    }
  }
}

/** Total evidence behind a print, and the 0..1 confidence the UI shows as "how well it knows you". */
export function confidenceOf(evidence: TastePrint["evidence"]): { total: number; confidence: number } {
  const total = AXES.reduce((s, a) => s + (evidence[a] ?? 0), 0);
  // Saturating: ~0.5 at 6 units of evidence, ~0.8 at 20, never quite 1.
  return { total: Math.round(total * 10) / 10, confidence: Math.round((total / (total + 6)) * 100) / 100 };
}
