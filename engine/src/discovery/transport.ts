// Ground-transport options — the leg from the arrival airport to where the traveler actually
// stays. Uber/Lyft and transfer providers have no open price/booking API, so we MODEL realistic
// fares over the real airport→lodging distance when known. The fare is a labeled estimate.
import type { Brief, Offer } from "../types.ts";
import type { GeoPoint } from "../geo/index.ts";

const TIERS = [
  { name: "Rideshare (UberX / Lyft)", base: 4, perMile: 1.8, note: "standard car, 1-4 riders" },
  { name: "Rideshare XL (SUV)", base: 7, perMile: 2.6, note: "larger car, up to 6 riders" },
  { name: "Premium (Uber Black)", base: 15, perMile: 4.2, note: "luxury sedan, pro driver" },
  { name: "Private airport transfer", base: 35, perMile: 3.0, note: "pre-booked, meet & greet" },
];

function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function shortPlace(label: string): string {
  return (label || "").split(",")[0]?.trim() || label;
}

/** Estimated airport→lodging transport options. Pass airport + lodging when they differ. */
export function estimateTransport(
  airport: GeoPoint | null,
  lodging: GeoPoint | null,
  _brief: Brief,
): Offer[] {
  const from = airport || lodging;
  const to = lodging || airport;
  if (!from || !to) return [];

  const straight = haversineMiles(from, to);
  const roadMiles = Math.max(8, Math.round(straight * 1.25));
  const etaMin = Math.round(roadMiles * 1.35);
  const routeLabel =
    airport && lodging && airport.label !== lodging.label
      ? `${shortPlace(airport.label)} airport → ${shortPlace(lodging.label)}`
      : "airport → town";

  return TIERS.map((t, i) => {
    const fare = Math.round(t.base + t.perMile * roadMiles);
    return {
      id: `transport-${i}`,
      kind: "transport",
      supplier: "estimate",
      title: t.name,
      priceUsd: fare,
      currency: "USD",
      raw: { roadMiles, etaMin, tier: t.name, estimatedPrice: true, routeLabel },
      summary: [t.note, `${routeLabel} · ~${roadMiles} mi · ~${etaMin} min`, `~$${fare} est.`],
    } satisfies Offer;
  });
}