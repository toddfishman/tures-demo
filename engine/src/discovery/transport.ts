// Ground-transport options (airport → destination). Uber/Lyft and most transfer providers don't
// expose open price/booking APIs, so we MODEL realistic fares from the real great-circle distance
// between the two geocoded points. Data basis (distance) is real; the fare is a labeled estimate.
import type { Brief, Offer } from "../types.ts";
import type { GeoPoint } from "../geo/index.ts";

function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const R = 3958.8; // miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const TIERS = [
  { name: "Rideshare (UberX / Lyft)", base: 4, perMile: 1.8, note: "standard car, 1-4 riders" },
  { name: "Rideshare XL (SUV)", base: 7, perMile: 2.6, note: "larger car, up to 6 riders" },
  { name: "Premium (Uber Black)", base: 15, perMile: 4.2, note: "luxury sedan, pro driver" },
  { name: "Private airport transfer", base: 35, perMile: 3.0, note: "pre-booked, meet & greet" },
];

/** Estimated airport→destination transport options. Returns [] if either point can't be geocoded. */
export function estimateTransport(origin: GeoPoint | null, dest: GeoPoint | null, _brief: Brief): Offer[] {
  if (!origin || !dest) return [];
  const miles = Math.max(1, Math.round(haversineMiles(origin, dest)));
  // Straight-line underestimates road distance; nudge up a bit for a believable fare.
  const roadMiles = Math.round(miles * 1.25);
  const etaMin = Math.max(8, Math.round(roadMiles * 1.7)); // rough drive time

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
      summary: [t.note, `~${roadMiles} mi · ~${etaMin} min`, `~$${fare} est.`],
    } satisfies Offer;
  });
}
