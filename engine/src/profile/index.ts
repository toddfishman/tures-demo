// Traveler profile — the identity documents + memberships a real booking needs (Duffel requires
// passport + Known Traveler Number at order time; loyalty numbers credit miles/status). Stored
// ENCRYPTED in the vault as a `traveler_profile` connection; the secret holds the sensitive
// fields, meta holds masked, safe-to-return display values.
import { z } from "zod";
import { connect, activeConnection, connectionsByKind, connectionById, revoke, reveal } from "../vault/index.ts";
import { redact } from "../vault/types.ts";
import type { RedactedConnection } from "../vault/types.ts";

export const MembershipSchema = z.object({
  kind: z.enum(["airline", "hotel", "auto_club", "rail", "other"]),
  program: z.string(), // "United MileagePlus", "Marriott Bonvoy", "AAA"
  number: z.string(),
  status: z.string().optional(), // "1K", "Titanium", "Plus"
});
export type Membership = z.infer<typeof MembershipSchema>;

export const TravelerProfileSchema = z.object({
  fullName: z.string().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  nationality: z.string().optional(),
  passport: z
    .object({ number: z.string(), expiry: z.string().optional(), country: z.string().optional() })
    .optional(),
  knownTravelerNumber: z.string().optional(), // TSA PreCheck
  redressNumber: z.string().optional(),
  memberships: z.array(MembershipSchema).default([]),
});
export type TravelerProfile = z.infer<typeof TravelerProfileSchema>;

function mask(v: string | undefined): string | undefined {
  if (!v) return v;
  return v.length <= 4 ? "••" : "••••" + v.slice(-4);
}

/** Save (replace) the traveler profile for an account. Returns the redacted connection. */
export async function setTravelerProfile(accountId: string, profile: TravelerProfile): Promise<RedactedConnection> {
  const meta = {
    hasPassport: !!profile.passport,
    passportMasked: mask(profile.passport?.number),
    ktnOnFile: !!profile.knownTravelerNumber,
    ktnMasked: mask(profile.knownTravelerNumber),
    memberships: profile.memberships.map((m) => ({ kind: m.kind, program: m.program, status: m.status, numberMasked: mask(m.number) })),
  };
  return connect({ accountId, kind: "traveler_profile", label: profile.fullName ?? "Traveler", secret: profile, meta });
}

/** Resolve the full profile (internal — for booking/passenger details). */
export async function getTravelerProfile(accountId: string): Promise<TravelerProfile | null> {
  const conn = activeConnection(accountId, "traveler_profile");
  if (!conn) return null;
  return (await reveal(conn)) as TravelerProfile;
}

/** Redacted profile connection for API responses. */
export function getTravelerProfileRedacted(accountId: string): RedactedConnection | null {
  const conn = activeConnection(accountId, "traveler_profile");
  return conn ? redact(conn) : null;
}

// ---- additional travelers (family / companions on the account) ----
export const CompanionSchema = TravelerProfileSchema.extend({
  fullName: z.string(),
  relationship: z.enum(["spouse", "partner", "child", "parent", "companion"]).default("companion"),
  dietary: z.array(z.string()).default([]), // per-traveler needs, e.g. ["nut allergy"]
  age: z.number().int().min(0).max(120).optional(), // when known from chat but the exact DOB isn't
});
export type Companion = z.infer<typeof CompanionSchema>;

/** Coarse age from an ISO date of birth. We keep the exact DOB only in the encrypted secret (a
 *  real booking manifest needs it); the redacted meta carries just the age the planner reasons on,
 *  so "there's a 10-year-old on this trip" never requires revealing a child's birth date. */
export function ageFromDob(dob: string | undefined): number | undefined {
  const m = dob && /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--;
  return age >= 0 && age < 130 ? age : undefined;
}

/** Add a traveler (spouse/child/companion). PII is VGS-tokenized like the account holder's.
 *  meta exposes only planner-safe values: relationship, coarse age (not DOB), dietary. */
export async function addTraveler(accountId: string, c: Companion): Promise<RedactedConnection> {
  const meta = {
    fullName: c.fullName,
    relationship: c.relationship,
    age: c.age ?? ageFromDob(c.dateOfBirth), // exact DOB (in secret) preferred; else the stated age
    dietary: c.dietary ?? [],
    dobOnFile: !!c.dateOfBirth, // whether an exact DOB is stored (else collected just-in-time at booking)
    hasPassport: !!c.passport,
    passportMasked: mask(c.passport?.number),
    ktnOnFile: !!c.knownTravelerNumber,
    memberships: c.memberships.map((m) => ({ kind: m.kind, program: m.program, numberMasked: mask(m.number) })),
  };
  return connect({ accountId, kind: "traveler", label: c.fullName, secret: c, meta });
}

// ---- party composition (the redacted household view the planner reasons on) ----
export interface PartySummary {
  adults: number; // includes the account holder
  children: number;
  childAges: number[]; // known ages only, high → low
  dietary: string[]; // companions' dietary needs (the holder's live in prefs)
  travelingAs: "solo" | "couple" | "family" | "group";
  members: { relationship: string; age?: number; name?: string }[];
}

/** Standing household composition = the account holder (1 adult) + saved companions. The brief's
 *  per-trip travelers still override this; it's the default so Tures can plan and ask "same crew?". */
export function partySummary(accountId: string): PartySummary {
  const members: PartySummary["members"] = [{ relationship: "self" }];
  let adults = 1;
  let children = 0;
  const childAges: number[] = [];
  const dietary = new Set<string>();
  for (const t of listTravelers(accountId)) {
    const m = ((t as unknown as { meta?: Record<string, unknown> }).meta ?? {}) as Record<string, any>;
    const relationship = String(m.relationship ?? "companion");
    const age = typeof m.age === "number" ? m.age : undefined;
    const isChild = relationship === "child" || (age !== undefined && age < 18);
    if (isChild) {
      children++;
      if (age !== undefined) childAges.push(age);
    } else {
      adults++;
    }
    (Array.isArray(m.dietary) ? m.dietary : []).forEach((d: unknown) => typeof d === "string" && dietary.add(d));
    members.push({ relationship, age, name: typeof m.fullName === "string" ? m.fullName : undefined });
  }
  const total = adults + children;
  const travelingAs = children > 0 ? "family" : total <= 1 ? "solo" : total === 2 ? "couple" : "group";
  return { adults, children, childAges: childAges.sort((a, b) => b - a), dietary: [...dietary], travelingAs, members };
}

// ---- booking manifest (Phase 2): the passenger list a real order needs, pre-filled from memory ----
export interface ManifestPassenger {
  relationship: string; // "self" | spouse | child | ...
  name?: string;
  approxAge?: number; // planner-safe age from the household (children)
  dobOnFile: boolean; // exact DOB available for the manifest?
  ktnOnFile: boolean;
}

/** Pre-fill a passenger manifest from what Tures already knows: the account holder plus saved
 *  companions. Per the minors'-data advisory the standing household keeps only APPROX age for kids,
 *  so `needsAtBooking` lists everyone whose exact DOB must still be gathered just-in-time before a
 *  real order. This turns "who's on this trip + their details" from a form into a confirmation. */
export async function bookingManifest(accountId: string): Promise<{
  lead: ManifestPassenger;
  party: ManifestPassenger[];
  needsAtBooking: string[];
}> {
  const p = await getTravelerProfile(accountId);
  const lead: ManifestPassenger = {
    relationship: "self",
    name: p?.fullName,
    dobOnFile: !!p?.dateOfBirth,
    ktnOnFile: !!p?.knownTravelerNumber,
  };
  const party: ManifestPassenger[] = [lead];
  for (const t of listTravelers(accountId)) {
    const m = ((t as unknown as { meta?: Record<string, unknown> }).meta ?? {}) as Record<string, any>;
    party.push({
      relationship: String(m.relationship ?? "companion"),
      name: typeof m.fullName === "string" ? m.fullName : undefined,
      approxAge: typeof m.age === "number" ? m.age : undefined,
      dobOnFile: !!m.dobOnFile,
      ktnOnFile: !!m.ktnOnFile,
    });
  }
  const needsAtBooking = party.filter((x) => !x.dobOnFile).map((x) => x.name || x.relationship);
  return { lead, party, needsAtBooking };
}

/** List the account's additional travelers (redacted/masked). */
export function listTravelers(accountId: string): RedactedConnection[] {
  return connectionsByKind(accountId, "traveler").map(redact);
}

/** Remove a traveler by connection id (must belong to the account). */
export function removeTraveler(accountId: string, id: string): boolean {
  const conn = connectionById(id);
  if (!conn || conn.accountId !== accountId || conn.kind !== "traveler") return false;
  return !!revoke(id);
}

/** What the booking flow attaches to a reservation, with audit-friendly notes. */
export async function passengerSummary(accountId: string): Promise<{ note: string; ktnApplied: boolean; passportOnFile: boolean; loyaltyCredited: string[] }> {
  const p = await getTravelerProfile(accountId);
  if (!p) return { note: "no traveler profile on file", ktnApplied: false, passportOnFile: false, loyaltyCredited: [] };
  const loyaltyCredited = p.memberships.map((m) => m.program);
  const bits = [
    p.passport ? "passport on file" : "no passport",
    p.knownTravelerNumber ? "KTN applied" : "no KTN",
    loyaltyCredited.length ? `crediting ${loyaltyCredited.join(", ")}` : "no loyalty",
  ];
  return { note: bits.join(" · "), ktnApplied: !!p.knownTravelerNumber, passportOnFile: !!p.passport, loyaltyCredited };
}

// ---- per-leg loyalty crediting (carrier/chain-aware) ----
export interface LoyaltyCredit {
  program: string;
  status?: string;
  numberMasked?: string;
  kind: Membership["kind"];
  estPoints: number;
  reason: string;
}

// Generic words that shouldn't drive a program↔carrier match.
const LOYALTY_STOP = new Set([
  "the", "of", "and", "rewards", "club", "airlines", "airline", "airways", "air", "hotels", "hotel",
  "resorts", "resort", "group", "membership", "program", "world", "one", "plus", "gold", "platinum",
  "titanium", "diamond", "elite", "status", "miles", "points", "by", "inn", "suites",
]);
function loyaltyTokens(s: string | undefined): string[] {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t && !LOYALTY_STOP.has(t));
}
function matchMembership(memberships: Membership[], wantKind: Membership["kind"], carrierOrChain: string): Membership | null {
  const want = new Set(loyaltyTokens(carrierOrChain));
  let best: Membership | null = null;
  let bestScore = 0;
  for (const m of memberships) {
    if (m.kind !== wantKind) continue;
    let score = 0;
    for (const t of loyaltyTokens(m.program)) if (want.has(t)) score++;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return bestScore > 0 ? best : null;
}

/** Returns a per-component crediter that matches the booked carrier/chain to a membership and
 *  estimates accrual. Reveals the profile once; returns masked numbers only. */
export async function loyaltyCrediter(
  accountId: string,
): Promise<(c: { kind: string; supplier?: string; title: string; amountUsd: number }) => LoyaltyCredit | null> {
  const p = await getTravelerProfile(accountId);
  const memberships = p?.memberships ?? [];
  return (c) => {
    const wantKind: Membership["kind"] | null = c.kind === "flight" ? "airline" : c.kind === "stay" ? "hotel" : null;
    if (!wantKind) return null;
    // The carrier/chain may live in the title (mock supplier: "Hawaiian SEA→OGG") or the supplier
    // field (real adapters) — match against both.
    const carrierOrChain = `${c.title || ""} ${c.supplier || ""}`;
    const m = matchMembership(memberships, wantKind, carrierOrChain);
    if (!m) return null;
    const perDollar = wantKind === "airline" ? 5 : 8; // explainable estimate, not a guarantee
    const statusBonus = m.status ? (wantKind === "airline" ? 1.4 : 1.3) : 1;
    const estPoints = Math.round(c.amountUsd * perDollar * statusBonus);
    const unit = wantKind === "airline" ? "miles" : "points";
    const reason = `${m.program}${m.status ? ` (${m.status})` : ""} · ~${estPoints.toLocaleString()} ${unit}`;
    return { program: m.program, status: m.status, numberMasked: mask(m.number), kind: m.kind, estPoints, reason };
  };
}
