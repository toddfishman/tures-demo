// "Where you've been" — a per-account graph of places visited with a personal 1–10 rating and
// notes. This is durable (file-backed) and feeds the planner: highly-rated past places sharpen
// destination suggestions and taste scoring over time. Not sensitive PII, so stored directly
// (no VGS tokenization needed).
import { z } from "zod";
import { Collection } from "../db/persist.ts";

export const PlaceSchema = z.object({
  kind: z.enum(["continent", "country", "city"]).default("country"),
  name: z.string().min(1),
  region: z.string().optional(), // e.g. continent for a country, country for a city
  been: z.boolean().default(true),
  rating: z.number().int().min(1).max(10).optional(), // how much YOU liked it
  notes: z.string().optional(),
  tags: z.array(z.string()).default([]), // e.g. "food", "design", "nature" — feeds taste
});
export type PlaceInput = z.infer<typeof PlaceSchema>;

export interface Place extends PlaceInput {
  id: string;
  accountId: string;
  updatedAt: string;
}

const places = new Collection<Place>("places");
let counter = 0;

function keyOf(accountId: string, name: string) {
  return `${accountId}::${name.toLowerCase()}`;
}

/** Upsert a place for an account (keyed by name, so re-rating updates in place). */
export function upsertPlace(accountId: string, input: PlaceInput): Place {
  const existing = places.get(keyOf(accountId, input.name));
  const place: Place = {
    id: existing?.id ?? `place_${Date.now().toString(36)}_${counter++}`,
    accountId,
    ...input,
    updatedAt: new Date().toISOString(),
  };
  return places.set(keyOf(accountId, input.name), place);
}

export function listPlaces(accountId: string): Place[] {
  return places
    .values()
    .filter((p) => p.accountId === accountId)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
}

export function removePlace(accountId: string, name: string): boolean {
  const k = keyOf(accountId, name);
  if (places.get(k)?.accountId !== accountId) return false;
  places.delete(k);
  return true;
}

/** A compact taste signal the planner can use: top-rated places + the tags you favor. */
export function tasteSignal(accountId: string): { lovedPlaces: string[]; favoriteTags: string[] } {
  const mine = listPlaces(accountId).filter((p) => p.been);
  const loved = mine.filter((p) => (p.rating ?? 0) >= 8);
  const tagCounts = new Map<string, number>();
  for (const p of loved) for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const favoriteTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map((e) => e[0]);
  return { lovedPlaces: loved.map((p) => p.name), favoriteTags };
}
