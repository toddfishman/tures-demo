// Standing traveler preferences — the non-sensitive half of "memory" that personalizes planning:
// the Taste Print from the swipe engine, a default cabin, and standing dislikes/dietary needs.
// Durable + file-backed like places (no PII, so no vault tokenization). Distinct from the encrypted
// traveler_profile (passport/KTN/loyalty), which booking uses; this is what the PLANNER reads.
import { z } from "zod";
import { Collection } from "../db/persist.ts";

export const TastePrintSchema = z.object({
  placeTypes: z.array(z.string()).default([]), // engine search vocabulary (design-hotel, boutique…)
  tags: z.array(z.string()).default([]), // human-readable taste tags ("Hidden over famous"…)
  dims: z.record(z.string(), z.number()).default({}), // pace/register/energy/… 0–100
  signature: z.string().optional(), // the prose "you read as…" line
});
export type TastePrint = z.infer<typeof TastePrintSchema>;

export const PrefsSchema = z.object({
  tastePrint: TastePrintSchema.optional(),
  cabinDefault: z.enum(["economy", "premium_economy", "business", "first"]).optional(),
  priceSensitivityDefault: z.enum(["thrifty", "balanced", "premium", "no_limit"]).optional(),
  avoid: z.array(z.string()).default([]), // standing dislikes ("US Marriott", "long layovers")
  dietary: z.array(z.string()).default([]),
});
export type Prefs = z.infer<typeof PrefsSchema>;

interface PrefsRow extends Prefs {
  accountId: string;
  updatedAt: string;
}

const store = new Collection<PrefsRow>("traveler_prefs");

export function getPrefs(accountId: string): Prefs | null {
  const row = store.get(accountId);
  if (!row) return null;
  const { accountId: _a, updatedAt: _u, ...prefs } = row;
  return prefs;
}

/** Merge a partial update into the account's prefs (arrays replace when provided). */
export function setPrefs(accountId: string, patch: Partial<Prefs>): Prefs {
  const existing: Prefs = getPrefs(accountId) ?? { avoid: [], dietary: [] };
  const merged: PrefsRow = {
    ...existing,
    ...patch,
    // nested taste print: shallow-merge so saving just placeTypes doesn't wipe dims
    tastePrint: patch.tastePrint ? { ...(existing.tastePrint ?? {}), ...patch.tastePrint } : existing.tastePrint,
    avoid: patch.avoid ?? existing.avoid ?? [],
    dietary: patch.dietary ?? existing.dietary ?? [],
    accountId,
    updatedAt: new Date().toISOString(),
  } as PrefsRow;
  store.set(accountId, merged);
  return getPrefs(accountId)!;
}
