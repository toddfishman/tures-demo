// Ground-transport options at the destination — the local hop from the arrival airport to the
// lodging/city center. Uber/Lyft and transfer providers have no open price/booking API, so we
// MODEL realistic fares over a typical airport-transfer distance. The fare is a labeled estimate.
import type { Brief, Offer } from "../types.ts";
import type { GeoPoint } from "../geo/index.ts";

const TIERS = [
  { name: "Rideshare (UberX / Lyft)", base: 4, perMile: 1.8, note: "standard car, 1-4 riders" },
  { name: "Rideshare XL (SUV)", base: 7, perMile: 2.6, note: "larger car, up to 6 riders" },
  { name: "Premium (Uber Black)", base: 15, perMile: 4.2, note: "luxury sedan, pro driver" },
  { name: "Private airport transfer", base: 35, perMile: 3.0, note: "pre-booked, meet & greet" },
];

// Most major airports sit ~12 miles from the city center / lodging — a believable transfer leg.
const TRANSFER_MILES = 12;

/** Estimated airport→lodging transport options for the destination. */
export function estimateTransport(dest: GeoPoint | null, _brief: Brief): Offer[] {
  if (!dest) return [];
  const roadMiles = TRANSFER_MILES;
  const etaMin = Math.round(roadMiles * 1.9); // rough city drive time

  return TIERS.map((t, i) => {
    const fare = Math.round(t.base + t.perMile * roadMiles);
    return {
      id: `transport-${i}`,
      kind: "transport",
      supplier: "estimate",
      title: t.name,
      priceUsd: fare,
      currency: "USD",
      raw: { roadMiles, etaMin, tier: t.name, estimatedPrice: true },
      summary: [t.note, `airport → town · ~${roadMiles} mi · ~${etaMin} min`, `~$${fare} est.`],
    } satisfies Offer;
  });
}
