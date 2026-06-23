// Geocoding: an IATA code / city name → coordinates. Used by Duffel Stays (needs lat/lng) and
// by real restaurant / things-to-do discovery (Places search is biased around a point).
//
// Two tiers: (1) a built-in airport table — precise, offline, covers the demo's destinations and
// CI with zero keys; (2) Google Geocoding API for anything off-table, when GOOGLE_MAPS_API_KEY is
// set. No key + off-table → null, and callers fall back to mock data.
import { config } from "../config.ts";
import { log } from "../logger.ts";

export interface GeoPoint {
  lat: number;
  lng: number;
  label: string; // human-readable "City, Country"
}

// IATA → city + approximate coordinates. Reliable and offline; extend freely.
const AIRPORTS: Record<string, { city: string; country: string; lat: number; lng: number }> = {
  // US
  SFO: { city: "San Francisco", country: "USA", lat: 37.7749, lng: -122.4194 },
  LAX: { city: "Los Angeles", country: "USA", lat: 34.0522, lng: -118.2437 },
  SEA: { city: "Seattle", country: "USA", lat: 47.6062, lng: -122.3321 },
  JFK: { city: "New York", country: "USA", lat: 40.7128, lng: -74.006 },
  EWR: { city: "Newark", country: "USA", lat: 40.7357, lng: -74.1724 },
  LGA: { city: "New York", country: "USA", lat: 40.7128, lng: -74.006 },
  BOS: { city: "Boston", country: "USA", lat: 42.3601, lng: -71.0589 },
  ORD: { city: "Chicago", country: "USA", lat: 41.8781, lng: -87.6298 },
  ATL: { city: "Atlanta", country: "USA", lat: 33.749, lng: -84.388 },
  MIA: { city: "Miami", country: "USA", lat: 25.7617, lng: -80.1918 },
  FLL: { city: "Fort Lauderdale", country: "USA", lat: 26.1224, lng: -80.1373 },
  DEN: { city: "Denver", country: "USA", lat: 39.7392, lng: -104.9903 },
  SAN: { city: "San Diego", country: "USA", lat: 32.7157, lng: -117.1611 },
  LAS: { city: "Las Vegas", country: "USA", lat: 36.1699, lng: -115.1398 },
  IAD: { city: "Washington", country: "USA", lat: 38.9072, lng: -77.0369 },
  DCA: { city: "Washington", country: "USA", lat: 38.9072, lng: -77.0369 },
  AUS: { city: "Austin", country: "USA", lat: 30.2672, lng: -97.7431 },
  PDX: { city: "Portland", country: "USA", lat: 45.5152, lng: -122.6784 },
  MCO: { city: "Orlando", country: "USA", lat: 28.5383, lng: -81.3792 },
  // Hawaii
  OGG: { city: "Maui (Kahului)", country: "USA", lat: 20.8893, lng: -156.474 },
  HNL: { city: "Honolulu", country: "USA", lat: 21.3069, lng: -157.8583 },
  KOA: { city: "Kailua-Kona", country: "USA", lat: 19.6406, lng: -155.9956 },
  LIH: { city: "Lihue (Kauai)", country: "USA", lat: 21.9788, lng: -159.3739 },
  ITO: { city: "Hilo", country: "USA", lat: 19.7297, lng: -155.09 },
  // Europe
  CDG: { city: "Paris", country: "France", lat: 48.8566, lng: 2.3522 },
  ORY: { city: "Paris", country: "France", lat: 48.8566, lng: 2.3522 },
  LHR: { city: "London", country: "UK", lat: 51.5072, lng: -0.1276 },
  LGW: { city: "London", country: "UK", lat: 51.5072, lng: -0.1276 },
  FRA: { city: "Frankfurt", country: "Germany", lat: 50.1109, lng: 8.6821 },
  MUC: { city: "Munich", country: "Germany", lat: 48.1351, lng: 11.582 },
  AMS: { city: "Amsterdam", country: "Netherlands", lat: 52.3676, lng: 4.9041 },
  FCO: { city: "Rome", country: "Italy", lat: 41.9028, lng: 12.4964 },
  MXP: { city: "Milan", country: "Italy", lat: 45.4642, lng: 9.19 },
  BCN: { city: "Barcelona", country: "Spain", lat: 41.3851, lng: 2.1734 },
  MAD: { city: "Madrid", country: "Spain", lat: 40.4168, lng: -3.7038 },
  LIS: { city: "Lisbon", country: "Portugal", lat: 38.7223, lng: -9.1393 },
  DUB: { city: "Dublin", country: "Ireland", lat: 53.3498, lng: -6.2603 },
  ZRH: { city: "Zurich", country: "Switzerland", lat: 47.3769, lng: 8.5417 },
  VIE: { city: "Vienna", country: "Austria", lat: 48.2082, lng: 16.3738 },
  KEF: { city: "Reykjavik", country: "Iceland", lat: 64.1466, lng: -21.9426 },
  ATH: { city: "Athens", country: "Greece", lat: 37.9838, lng: 23.7275 },
  // Asia / Pacific
  HND: { city: "Tokyo", country: "Japan", lat: 35.6762, lng: 139.6503 },
  NRT: { city: "Tokyo", country: "Japan", lat: 35.6762, lng: 139.6503 },
  KIX: { city: "Osaka", country: "Japan", lat: 34.6937, lng: 135.5023 },
  ICN: { city: "Seoul", country: "South Korea", lat: 37.5665, lng: 126.978 },
  HKG: { city: "Hong Kong", country: "China", lat: 22.3193, lng: 114.1694 },
  SIN: { city: "Singapore", country: "Singapore", lat: 1.3521, lng: 103.8198 },
  BKK: { city: "Bangkok", country: "Thailand", lat: 13.7563, lng: 100.5018 },
  TPE: { city: "Taipei", country: "Taiwan", lat: 25.033, lng: 121.5654 },
  DPS: { city: "Bali (Denpasar)", country: "Indonesia", lat: -8.4095, lng: 115.1889 },
  SYD: { city: "Sydney", country: "Australia", lat: -33.8688, lng: 151.2093 },
  // Middle East / Africa / Americas
  DXB: { city: "Dubai", country: "UAE", lat: 25.2048, lng: 55.2708 },
  CUN: { city: "Cancún", country: "Mexico", lat: 21.1619, lng: -86.8515 },
  TQO: { city: "Tulum", country: "Mexico", lat: 20.211, lng: -87.4654 },
  MEX: { city: "Mexico City", country: "Mexico", lat: 19.4326, lng: -99.1332 },
  GIG: { city: "Rio de Janeiro", country: "Brazil", lat: -22.9068, lng: -43.1729 },
  CPT: { city: "Cape Town", country: "South Africa", lat: -33.9249, lng: 18.4241 },
};

const cache = new Map<string, GeoPoint | null>();

/** Resolve an IATA code or free-form place string to coordinates. Table first, then Google
 *  (when keyed), then null. Results are cached for the process. */
export async function geocode(query: string): Promise<GeoPoint | null> {
  const q = (query || "").trim();
  if (!q) return null;
  const key = q.toUpperCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  // 1. Known airport code → precise, offline.
  const ap = AIRPORTS[key];
  if (ap) {
    const pt: GeoPoint = { lat: ap.lat, lng: ap.lng, label: `${ap.city}, ${ap.country}` };
    cache.set(key, pt);
    return pt;
  }

  // 2. Google Geocoding API for off-table places (when keyed).
  if (config.googleMapsKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${config.googleMapsKey}`;
      const res = await fetch(url);
      const json: any = await res.json();
      const r = json?.results?.[0];
      if (r?.geometry?.location) {
        const pt: GeoPoint = {
          lat: Number(r.geometry.location.lat),
          lng: Number(r.geometry.location.lng),
          label: r.formatted_address ?? q,
        };
        cache.set(key, pt);
        return pt;
      }
      log.warn("geocode: no Google result", { query: q, status: json?.status });
    } catch (e) {
      log.warn("geocode: Google request failed", { query: q, err: String(e) });
    }
  }

  cache.set(key, null);
  return null;
}

/** Convenience for a human label even when only an IATA is known. */
export function cityLabel(iata: string): string | undefined {
  const ap = AIRPORTS[(iata || "").toUpperCase()];
  return ap ? `${ap.city}, ${ap.country}` : undefined;
}
