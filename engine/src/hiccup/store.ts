// Proposal storage + the dedupe index.
//
// Two problems this fixes. First, a proposal used to be an SSE event and nothing else — by the
// time the traveler tapped "yes" there was nothing left to accept. Proposals are now durable
// rows with a status and an expiry. Second, the watcher escalates on every travel-impacting
// signal; three signals about one storm used to mean three rebooks and three fare differences.
// Every disruption now carries a dedupe key, and a live proposal for that key short-circuits.
import { Collection } from "../db/persist.ts";
import type { Disruption, HiccupProposal } from "./types.ts";

const store = new Collection<HiccupProposal>("hiccup_proposals");
let counter = 0;

export function nextProposalId(): string {
  return `hcp_${Date.now().toString(36)}_${counter++}`;
}

/** A stable identity for "this disruption". Prefers the upstream event id; falls back to the
 *  shape of the event, which is enough to collapse repeat reports of the same thing. */
export function dedupeKey(bookingId: string, d: Disruption, componentIndex: number): string {
  const basis = d.sourceId ?? `${d.kind}:${componentIndex}:${d.newDepartureIso ?? d.delayMinutes ?? d.detail ?? ""}`.slice(0, 160);
  return `${bookingId}::${basis}`;
}

export function get(id: string): HiccupProposal | undefined {
  return store.get(id);
}

export function put(p: HiccupProposal): HiccupProposal {
  return store.set(p.id, p);
}

export function forBooking(bookingId: string): HiccupProposal[] {
  return store
    .values()
    .filter((p) => p.bookingId === bookingId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function isExpired(p: HiccupProposal): boolean {
  return Date.parse(p.expiresAt) <= Date.now();
}

/** Pending proposals for a booking, expiring any that have aged out as a side effect. */
export function pendingFor(bookingId: string): HiccupProposal[] {
  const out: HiccupProposal[] = [];
  for (const p of forBooking(bookingId)) {
    if (p.status !== "pending") continue;
    if (isExpired(p)) {
      p.status = "expired";
      p.resolvedAt = new Date().toISOString();
      store.set(p.id, p);
      continue;
    }
    out.push(p);
  }
  return out;
}

/** A live (pending, unexpired) proposal for the same underlying event, if one exists. */
export function liveForKey(bookingId: string, key: string): HiccupProposal | undefined {
  return pendingFor(bookingId).find((p) => dedupeKey(p.bookingId, p.disruption, p.componentIndex) === key);
}

/** Retire any other pending proposals on the same component — one open question at a time. */
export function supersedeOthers(bookingId: string, componentIndex: number, keepId: string): number {
  let n = 0;
  for (const p of pendingFor(bookingId)) {
    if (p.id === keepId || p.componentIndex !== componentIndex) continue;
    p.status = "superseded";
    p.resolvedAt = new Date().toISOString();
    store.set(p.id, p);
    n++;
  }
  return n;
}

export function resolve(id: string, status: HiccupProposal["status"], patch: Partial<HiccupProposal> = {}): HiccupProposal | undefined {
  const p = store.get(id);
  if (!p) return undefined;
  p.status = status;
  p.resolvedAt = new Date().toISOString();
  Object.assign(p, patch);
  return store.set(p.id, p);
}

export const proposals = { get, put, forBooking, pendingFor, liveForKey, supersedeOthers, resolve, dedupeKey, nextProposalId };
