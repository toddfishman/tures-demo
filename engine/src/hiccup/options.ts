// Finding the replacement.
//
// The old line was:
//
//     const alt = flights.find((f) => f.id !== flight.offerId) ?? flights[0];
//
// The fallback re-selects the DISRUPTED flight whenever it is the only result — so a cancelled
// flight could be "rebooked" onto itself, complete with a fresh confirmation number and a $0
// fare difference. Nothing downstream would have caught it.
//
// Replacement rules here: never return the disrupted offer, ever; rank for a REBOOKING rather
// than a fresh search (continuity and getting there matter more than saving $40); and return
// several options, because a proposal with one choice isn't a choice.
import type { Booking, BookedComponent } from "../booking/types.ts";
import type { Offer } from "../types.ts";
import { runSearch } from "../search/service.ts";
import { assembleContext } from "../agent/context.ts";
import { tasteFit } from "../taste/fit.ts";
import type { HiccupOption } from "./types.ts";

/** How many replacements to surface. Three is enough to feel like a choice, few enough to read. */
const MAX_OPTIONS = 3;

/** The carrier/chain behind an offer, for the continuity bonus. */
function operatorOf(o: Pick<Offer, "title" | "raw">): string {
  const raw = (o.raw ?? {}) as Record<string, unknown>;
  const named = raw.carrier ?? raw.owner ?? raw.chain;
  if (typeof named === "string" && named.trim()) return named.trim().toLowerCase();
  // Fall back to the leading words of the title ("Delta 288" → "delta").
  return (o.title.split(/[\s·—-]/)[0] ?? "").toLowerCase();
}

export interface OptionSearch {
  options: HiccupOption[];
  /** True when the search came back with nothing usable that wasn't the disrupted offer itself. */
  empty: boolean;
  /** Surfaced so the caller can say *why* there was nothing, rather than a bare "no options". */
  searched: number;
}

/**
 * Rank replacements for a disrupted component.
 *
 * The rebooking rank is not the search score. On a normal search, value carries real weight; in
 * a disruption the traveler wants to GET THERE, on something that still feels like their trip,
 * without a surprise bill. So: fit (taste) and continuity (same carrier keeps status, seats and
 * one PNR) count for more, and the upcharge is a penalty rather than a headline.
 */
export async function findOptions(booking: Booking, component: BookedComponent, disrupted?: Offer): Promise<OptionSearch> {
  const { context, brief } = assembleContext(booking.accountId, booking.brief);
  const { flights, stays } = await runSearch(booking.tripId, brief, booking.accountId, context);
  const pool = component.kind === "stay" ? stays : flights;

  // Hard exclusion — by offer id AND by the id we already hold on the component. This is the
  // guard the `?? flights[0]` fallback bypassed.
  const excludeIds = new Set([component.offerId, disrupted?.id].filter(Boolean) as string[]);
  const candidates = pool.filter((o) => !excludeIds.has(o.id));

  if (!candidates.length) return { options: [], empty: true, searched: pool.length };

  const previousOperator = operatorOf({ title: component.title, raw: disrupted?.raw ?? {} });
  const dims = context.taste?.effective;

  const scored = candidates.map((o) => {
    const upchargeUsd = Math.round((o.priceUsd - component.amountUsd) * 100) / 100;
    const reasons: string[] = [];

    // Base: how well it fits the brief at all (the search score already blends value + fit).
    let rank = o.score ?? 0.5;

    // Continuity: same carrier or chain means the existing record, status and seat can usually
    // move with the traveler. Worth real weight in a disruption; worth nothing in a fresh search.
    const sameOperator = previousOperator && operatorOf(o) === previousOperator;
    if (sameOperator) {
      rank += 0.12;
      reasons.push("same carrier — your record and status move with you");
    }

    // Taste: on a stay especially, a replacement that doesn't feel like your trip is a bad fix.
    if (dims) {
      const fit = tasteFit(o, dims);
      if (fit.coverage >= 0.25) {
        rank += (fit.fit - 0.5) * 0.24;
        for (const r of fit.reasons.slice(0, 1)) reasons.push(r);
      }
    }

    // Upcharge: a penalty, scaled to the original fare so $80 on a $250 ticket stings more than
    // $80 on a $2,400 one. Cheaper replacements get a small, honest credit.
    const relative = component.amountUsd > 0 ? upchargeUsd / component.amountUsd : 0;
    rank -= Math.max(0, relative) * 0.35;
    if (upchargeUsd <= 0) {
      rank += 0.05;
      reasons.push(upchargeUsd < 0 ? `$${Math.abs(upchargeUsd).toLocaleString()} cheaper than the original` : "same fare as the original");
    }

    // Nonstop matters more when you're already behind — and when it isn't nonstop, say so.
    // A traveler choosing under pressure needs the connection count on the card, not buried in
    // a summary line they may not read.
    const stops = Number((o.raw as any)?.stops);
    if (o.kind === "flight" && isFinite(stops)) {
      if (stops === 0) {
        rank += 0.06;
        if (!reasons.includes("nonstop")) reasons.push("nonstop");
      } else {
        rank -= stops * 0.04;
        reasons.push(`${stops} stop${stops > 1 ? "s" : ""} — a connection to make`);
      }
    }

    // Every option must explain itself. A card with no line under it reads as filler, and a
    // traveler choosing under pressure deserves to know what they're trading.
    const merged = [...new Set([...reasons, ...(o.scoreReasons ?? [])])];
    if (!merged.length) {
      merged.push(
        upchargeUsd > 0
          ? `gets you there for $${upchargeUsd.toLocaleString()} more`
          : "gets you there at the same cost",
      );
    }

    return {
      offerId: o.id,
      title: o.title,
      priceUsd: o.priceUsd,
      upchargeUsd,
      summary: o.summary ?? [],
      rank: Math.round(Math.max(0, Math.min(1.5, rank)) * 100) / 100,
      reasons: merged.slice(0, 3),
    } satisfies HiccupOption;
  });

  scored.sort((a, b) => b.rank - a.rank);
  return { options: scored.slice(0, MAX_OPTIONS), empty: false, searched: pool.length };
}

/** Re-resolve a chosen option to a live Offer at accept time. Options expire; the fare quoted
 *  forty minutes ago may be gone, and booking a stale id would be a fake success. */
export async function resolveOffer(booking: Booking, kind: BookedComponent["kind"], offerId: string): Promise<Offer | null> {
  const { context, brief } = assembleContext(booking.accountId, booking.brief);
  const { flights, stays } = await runSearch(booking.tripId, brief, booking.accountId, context);
  const pool = kind === "stay" ? stays : flights;
  return pool.find((o) => o.id === offerId) ?? null;
}
