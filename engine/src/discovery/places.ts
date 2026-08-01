// Real-place discovery via Google Places API (New) Text Search. Powers hotels (Duffel Stays is
// gated, so lodging comes from Places), restaurants, and things-to-do. Returns normalized Offers.
//
// Honest pricing note: Places gives a priceLevel BUCKET (free…very expensive), not a real rate.
// We model a believable price from that bucket + the category. Data (name/rating/reviews/address)
// is real; the price is a labeled estimate — consistent with "real data, simulated booking".
import type { Brief, Offer, OfferKind } from "../types.ts";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import type { GeoPoint } from "../geo/index.ts";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.location",
  "places.types",
  "places.photos",
  "places.editorialSummary",
].join(",");

const PRICE_INDEX: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

interface RawPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  photos?: Array<{ name?: string }>;
  editorialSummary?: { text?: string };
}

async function textSearch(
  textQuery: string,
  geo: GeoPoint,
  includedType: string | undefined,
  maxResultCount = 8,
): Promise<RawPlace[]> {
  if (!config.googleMapsKey) return [];
  try {
    const body: Record<string, unknown> = {
      textQuery,
      maxResultCount,
      locationBias: {
        circle: { center: { latitude: geo.lat, longitude: geo.lng }, radius: 20000 },
      },
    };
    if (includedType) body.includedType = includedType;
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": config.googleMapsKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      log.warn("places textSearch non-OK", { textQuery, status: res.status, body: t.slice(0, 300) });
      return [];
    }
    const json: any = await res.json();
    return (json?.places ?? []) as RawPlace[];
  } catch (e) {
    log.warn("places textSearch failed", { textQuery, err: String(e) });
    return [];
  }
}

/** Stable photo reference (the Places media path). The front-end / a server proxy can turn this
 *  into an image; we don't embed the API key in a client URL here. */
function photoRef(p: RawPlace): string | undefined {
  const name = p.photos?.[0]?.name;
  return name || undefined;
}

function priceTier(p: RawPlace): number {
  const idx = p.priceLevel ? PRICE_INDEX[p.priceLevel] : undefined;
  return idx ?? 2;
}

// Nudge the modeled price by rating so options aren't all identical when Places omits priceLevel.
// ~0.85x at 3.5★ up to ~1.35x at 5★. Returns 1.0 when there's no rating.
function ratingMult(p: RawPlace): number {
  if (!p.rating) return 1;
  return Math.round((0.5 + p.rating / 6) * 100) / 100;
}

function toOffer(p: RawPlace, kind: OfferKind, i: number, priceUsd: number, extraSummary: string[]): Offer {
  const name = p.displayName?.text ?? "Place";
  const rating = p.rating ? `${p.rating}★` : null;
  const reviews = p.userRatingCount ? `${p.userRatingCount.toLocaleString()} reviews` : null;
  return {
    id: p.id ?? `gp-${kind}-${i}`,
    kind,
    supplier: "google-places",
    title: name,
    priceUsd,
    currency: "USD",
    raw: {
      placeId: p.id,
      address: p.formattedAddress,
      rating: p.rating,
      reviewCount: p.userRatingCount,
      priceLevel: p.priceLevel,
      photoRef: photoRef(p),
      summary: p.editorialSummary?.text,
      types: p.types,
      location: p.location,
      estimatedPrice: true, // price is modeled from priceLevel, not a live rate
    },
    summary: [rating, reviews, ...extraSummary].filter(Boolean) as string[],
  };
}

/** Hotels via Places (lodging). Modeled nightly price × nights from the priceLevel bucket. */
export async function searchHotels(geo: GeoPoint, brief: Brief): Promise<Offer[]> {
  const places = await textSearch(`hotels in ${geo.label}`, geo, "lodging", 8);
  const nights = brief.returnDate
    ? Math.max(1, Math.round((Date.parse(brief.returnDate) - Date.parse(brief.departDate)) / 86400000))
    : 3;
  const NIGHTLY = [120, 180, 260, 420, 650]; // by price tier 0..4
  return places.map((p, i) => {
    const nightly = Math.round((NIGHTLY[priceTier(p)] ?? 180) * ratingMult(p));
    const total = nightly * nights;
    return toOffer(p, "stay", i, total, [`~$${nightly}/night`, `${nights} nights · ~$${total.toLocaleString()}`, "est. price"]);
  });
}

/** Restaurants via Places. Modeled per-person dinner cost from the priceLevel bucket. */
export async function searchDining(geo: GeoPoint, brief: Brief): Promise<Offer[]> {
  const places = await textSearch(`best restaurants in ${geo.label}`, geo, "restaurant", 8);
  const PER_PERSON = [15, 25, 45, 85, 140];
  const pax = Math.max(1, brief.adults + brief.children);
  return places.map((p, i) => {
    const pp = Math.round((PER_PERSON[priceTier(p)] ?? 25) * ratingMult(p));
    return toOffer(p, "dining", i, pp * pax, [`~$${pp}/person`, `table for ${pax}`, "est. price"]);
  });
}

// Result types that aren't "things to do" — the locality itself, lodging, dining, transit hubs.
const NON_ACTIVITY = new Set([
  "locality", "political", "administrative_area_level_1", "administrative_area_level_2",
  "country", "lodging", "hotel", "restaurant", "food", "airport", "bus_station", "train_station",
]);

/** Things to do via Places. No includedType (it over-filtered to just the town) — open text query,
 *  then drop results that are really the city/hotels/restaurants. Modeled ticket price by tier. */
export async function searchActivities(geo: GeoPoint, brief: Brief): Promise<Offer[]> {
  const raw = await textSearch(`top attractions, tours and things to do in ${geo.label}`, geo, undefined, 14);
  const places = raw.filter((p) => {
    const types = p.types ?? [];
    if (types.some((t) => NON_ACTIVITY.has(t))) return false;
    return (p.userRatingCount ?? 0) >= 20; // real, reviewed attractions
  }).slice(0, 10);
  const TICKET = [0, 25, 55, 110, 200];
  const pax = Math.max(1, brief.adults + brief.children);
  return places.map((p, i) => {
    const each = TICKET[priceTier(p)] ?? 25;
    const total = each * pax;
    const label = each === 0 ? "often free" : `~$${each}/person · ${pax} = ~$${total.toLocaleString()}`;
    return toOffer(p, "activity", i, total, [label, "est. price"]);
  });
}
