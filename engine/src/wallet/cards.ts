// Multi-card wallet — pick the best card for a given charge by reward value.
//
// Curated reward profiles for common cards. Earn rates assume Tures's booking style (flights
// booked DIRECT with the airline, hotels booked DIRECT with the property) — which matters: e.g.
// Amex Platinum earns 5x on airfare booked with the airline but only 1x on a hotel booked direct
// (its 5x hotel rate requires Amex Travel). pointValueCents is a reasonable program valuation so
// we can compare across currencies. This is an explainable v1, not a perfect points optimizer.
import type { OfferKind } from "../types.ts";
import { connectionsByKind } from "../vault/index.ts";

export type ChargeCategory = "airfare" | "hotel" | "dining" | "other";

export interface CardProfile {
  key: string;
  name: string;
  network: string;
  /** Points earned per $1 by category; falls back to `base`. */
  earn: Partial<Record<ChargeCategory, number>> & { base: number };
  /** Cents per point — lets us compare e.g. Amex MR vs Citi TY vs cash back. */
  pointValueCents: number;
  perks?: string[];
}

export const CARD_CATALOG: Record<string, CardProfile> = {
  amex_platinum: { key: "amex_platinum", name: "Amex Platinum", network: "Amex", earn: { airfare: 5, hotel: 1, base: 1 }, pointValueCents: 2.0, perks: ["airline fee credit", "hotel elite status"] },
  amex_gold: { key: "amex_gold", name: "Amex Gold", network: "Amex", earn: { airfare: 3, hotel: 1, dining: 4, base: 1 }, pointValueCents: 2.0, perks: ["dining credits"] },
  chase_sapphire_reserve: { key: "chase_sapphire_reserve", name: "Chase Sapphire Reserve", network: "Visa", earn: { airfare: 3, hotel: 3, dining: 3, base: 1 }, pointValueCents: 2.0, perks: ["Priority Pass", "$300 travel credit"] },
  chase_sapphire_preferred: { key: "chase_sapphire_preferred", name: "Chase Sapphire Preferred", network: "Visa", earn: { airfare: 2, hotel: 2, dining: 3, base: 1 }, pointValueCents: 2.0 },
  capital_one_venture_x: { key: "capital_one_venture_x", name: "Capital One Venture X", network: "Visa", earn: { airfare: 2, hotel: 2, base: 2 }, pointValueCents: 1.85, perks: ["Priority Pass", "$300 travel credit"] },
  citi_strata_premier: { key: "citi_strata_premier", name: "Citi Strata Premier", network: "Mastercard", earn: { airfare: 3, hotel: 3, dining: 3, base: 1 }, pointValueCents: 1.7 },
  generic_cashback: { key: "generic_cashback", name: "Cash-back card", network: "—", earn: { base: 1.5 }, pointValueCents: 1.0 },
};

export function getCardProfile(key: string | undefined): CardProfile {
  return (key && CARD_CATALOG[key]) || CARD_CATALOG.generic_cashback!;
}

/** Map a booking component to a charge category. */
export function categoryForKind(kind: OfferKind): ChargeCategory {
  return kind === "flight" ? "airfare" : kind === "stay" ? "hotel" : "other";
}

function rewardRate(p: CardProfile, category: ChargeCategory): number {
  const earn = p.earn[category] ?? p.earn.base;
  return (earn * p.pointValueCents) / 100; // fraction of spend returned in value
}

export interface CardChoice {
  connectionId: string;
  key: string;
  name: string;
  last4?: string;
  estValueUsd: number;
  rate: number; // 0..1
  reason: string;
}

/** Choose the best card in the account's wallet for a charge. Returns null if no cards. */
export function chooseCard(accountId: string, charge: { category: ChargeCategory; amountUsd: number }): CardChoice | null {
  const cards = connectionsByKind(accountId, "payment");
  if (cards.length === 0) return null;

  let best: CardChoice | null = null;
  for (const c of cards) {
    const key = (c.meta?.cardKey as string) ?? "generic_cashback";
    const profile = getCardProfile(key);
    const rate = rewardRate(profile, charge.category);
    const estValueUsd = Math.round(charge.amountUsd * rate * 100) / 100;
    const earn = profile.earn[charge.category] ?? profile.earn.base;
    const reason = `${profile.name} · ${earn}× ${charge.category} (~${(rate * 100).toFixed(1)}% back ≈ $${estValueUsd.toLocaleString()})`;
    if (!best || estValueUsd > best.estValueUsd) {
      best = { connectionId: c.id, key: profile.key, name: profile.name, last4: c.meta?.last4 as string | undefined, estValueUsd, rate, reason };
    }
  }
  return best;
}
