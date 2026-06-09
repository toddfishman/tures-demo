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
});
export type Companion = z.infer<typeof CompanionSchema>;

/** Add a traveler (spouse/child/companion). PII is VGS-tokenized like the account holder's. */
export async function addTraveler(accountId: string, c: Companion): Promise<RedactedConnection> {
  const meta = {
    fullName: c.fullName,
    relationship: c.relationship,
    hasPassport: !!c.passport,
    passportMasked: mask(c.passport?.number),
    ktnOnFile: !!c.knownTravelerNumber,
    memberships: c.memberships.map((m) => ({ kind: m.kind, program: m.program, numberMasked: mask(m.number) })),
  };
  return connect({ accountId, kind: "traveler", label: c.fullName, secret: c, meta });
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
