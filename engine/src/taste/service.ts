// Taste Engine service — the read/write face of the two-profile model.
//
// Storage note: the print continues to live on `traveler_prefs.tastePrint`, so every existing
// caller (/prefs, onboarding, funnel.context) keeps working. What changes is that a v1 print
// (dims/tags/placeTypes/signature only) is upgraded on read — missing dims fill from neutral,
// evidence starts at zero — so nothing has to be migrated and no one loses their quiz result.
import type { Brief } from "../types.ts";
import type { Axis, TasteDims, TastePrint } from "./types.ts";
import { AXES, NEUTRAL, normalizeDims } from "./types.ts";
import { getPrefs, setPrefs } from "../profile/prefs.ts";
import { applyLens, getLens, lensForPurpose, paceFromDims, type Lens } from "./lens.ts";
import { learn, confidenceOf, type Observation } from "./learn.ts";
import { log } from "../logger.ts";

const HISTORY_CAP = 40;

/** Read the account's standing print, upgrading a v1 shape in place. Never returns null — an
 *  account with no print reads as fully neutral, which the scorer treats as "no opinion". */
export function getPrint(accountId: string): TastePrint {
  const stored = getPrefs(accountId)?.tastePrint as Partial<TastePrint> | undefined;
  const dims = normalizeDims(stored?.dims as Record<string, number> | undefined);
  return {
    version: 2,
    dims,
    placeTypes: stored?.placeTypes ?? [],
    tags: stored?.tags ?? [],
    signature: stored?.signature ?? "",
    evidence: {
      pace: stored?.evidence?.pace ?? 0,
      register: stored?.evidence?.register ?? 0,
      energy: stored?.evidence?.energy ?? 0,
      palate: stored?.evidence?.palate ?? 0,
      planning: stored?.evidence?.planning ?? 0,
      aesthetic: stored?.evidence?.aesthetic ?? 0,
    },
    history: stored?.history ?? [],
    updatedAt: stored?.updatedAt ?? new Date().toISOString(),
  };
}

/** True when the traveler has actually expressed taste — used to keep sample/real copy honest. */
export function hasPrint(accountId: string): boolean {
  const p = getPrint(accountId);
  return AXES.some((a) => p.dims[a] !== NEUTRAL[a]) || p.tags.length > 0;
}

export function savePrint(accountId: string, print: TastePrint): TastePrint {
  const next: TastePrint = {
    ...print,
    // Vocabulary and prose are DERIVED — regenerating on every save keeps them from drifting
    // out of sync with dims after the engine learns something.
    placeTypes: placeTypesFor(print.dims),
    signature: signatureFor(print.dims),
    history: print.history.slice(-HISTORY_CAP),
    updatedAt: new Date().toISOString(),
  };
  setPrefs(accountId, { tastePrint: next as any });
  return next;
}

/** Record the quiz result. Quiz answers REPLACE dims (the traveler just told us directly) but
 *  keep accumulated evidence, so learning already earned isn't thrown away. */
export function setQuizResult(accountId: string, input: { dims: Record<string, number>; tags?: string[] }): TastePrint {
  const current = getPrint(accountId);
  const dims = normalizeDims(input.dims);
  const evidence = { ...current.evidence };
  // The quiz is worth a solid unit of evidence per axis — enough that the first booking refines
  // rather than overwrites it.
  for (const a of AXES) evidence[a] = Math.max(evidence[a], 1.5);
  return savePrint(accountId, {
    ...current,
    dims,
    tags: [...new Set([...(input.tags ?? [])])].slice(0, 10),
    evidence,
    history: [
      ...current.history,
      { ts: new Date().toISOString(), source: "quiz" as const, subject: "Taste quiz", shifts: {}, note: "built from the this-or-that quiz" },
    ],
  });
}

/** Fold an observation (booking, swap, decline, rating) into the account's print. Returns null
 *  when the observation carried no information — an uninformative event is not an error. */
export function observe(accountId: string, obs: Observation): TastePrint | null {
  if (!accountId || accountId === "demo") return null; // never learn onto the shared demo account
  try {
    const current = getPrint(accountId);
    const { dims, evidence, learning } = learn(current, obs);
    if (!learning) return null;
    const saved = savePrint(accountId, { ...current, dims, evidence, history: [...current.history, learning] });
    log.info("taste learned", { accountId, source: learning.source, shifts: learning.shifts });
    return saved;
  } catch (e) {
    // Learning is never allowed to break a booking. Log and move on.
    log.warn("taste learn failed", { accountId, err: String(e) });
    return null;
  }
}

export interface EffectiveTaste {
  /** The standing print, unbent. */
  standing: TasteDims;
  /** The print after this trip's lens — what the scorer actually uses. */
  effective: TasteDims;
  lens: Lens;
  /** 0..1 — how much evidence stands behind the standing print. */
  confidence: number;
  /** Whether the traveler has expressed any taste at all. */
  known: boolean;
}

/** Resolve the two profiles for a trip: standing print + the lens this brief implies. */
export function effectiveTaste(accountId: string, brief?: Pick<Brief, "tripSentiment">, explicitLensId?: string): EffectiveTaste {
  const print = getPrint(accountId);
  const lens = lensForPurpose(brief?.tripSentiment?.purpose, explicitLensId);
  return {
    standing: print.dims,
    effective: applyLens(print.dims, lens),
    lens,
    confidence: confidenceOf(print.evidence).confidence,
    known: hasPrint(accountId),
  };
}

// ── Derived vocabulary + prose ────────────────────────────────────────────────────────────
// Both were previously computed only in taste.html, which meant the words the traveler read and
// the terms the planner searched could disagree. They live here now; the page renders what the
// engine says.

export function placeTypesFor(dims: TasteDims): string[] {
  const pt: string[] = [];
  if (dims.register >= 62) pt.push("grand-hotel");
  if (dims.register <= 38) pt.push("boutique");
  if (dims.aesthetic >= 62) pt.push("design-hotel");
  if (dims.aesthetic <= 38) pt.push("heritage-hotel");
  if (dims.palate >= 62) pt.push("chef's-table");
  if (dims.energy <= 40) pt.push("quiet-table");
  if (dims.energy >= 68) pt.push("lively-neighborhood");
  if (dims.pace <= 40) pt.push("long-stay");
  if (!pt.length) pt.push("boutique");
  return [...new Set(pt)].slice(0, 5);
}

export function signatureFor(dims: TasteDims): string {
  const pace = dims.pace <= 45 ? "unhurried" : dims.pace >= 60 ? "full, moving" : "easy";
  const reg = dims.register <= 45 ? "small, under-the-radar places" : dims.register >= 60 ? "grand, landmark addresses" : "a quiet kind of grand";
  const aes = dims.aesthetic <= 45 ? "heritage rooms with patina" : dims.aesthetic >= 60 ? "clean, design-led rooms" : "rooms with character";
  const pal = dims.palate >= 60 ? "a table the chef is excited about" : dims.palate <= 40 ? "the reliable great over the experiment" : "good food, no fuss";
  const eng = dims.energy <= 45 ? "kept quiet and few" : dims.energy >= 60 ? "with the room alive around you" : "sociable but unforced";
  const plan = dims.planning <= 45 ? "room to drift" : dims.planning >= 60 ? "the day already shaped" : "a loose plan";
  return `You travel at ${pace} pace — ${reg}, ${aes}, ${pal}, evenings ${eng}, with ${plan}.`;
}

/** A compact line for the agent/planner context: who this traveler is, on this trip. */
export function tasteProse(t: EffectiveTaste): string {
  if (!t.known) return "";
  const parts = [signatureFor(t.effective)];
  if (t.lens.id !== "usual") {
    const moved: string[] = [];
    for (const axis of AXES) {
      const d = t.effective[axis] - t.standing[axis];
      if (Math.abs(d) >= 8) moved.push(`${axis} ${d > 0 ? "up" : "down"}`);
    }
    if (moved.length) parts.push(`For this trip (${t.lens.label.toLowerCase()}) that bends: ${moved.join(", ")}.`);
  }
  if (t.confidence < 0.35) parts.push("This read is still early — ask rather than assume when it matters.");
  return parts.join(" ");
}

/** Keep the brief's own pace consistent with the lensed print instead of letting them disagree. */
export function paceForBrief(t: EffectiveTaste): "easy" | "balanced" | "full" {
  return paceFromDims(t.effective);
}

export { getLens };
export type { Axis };
