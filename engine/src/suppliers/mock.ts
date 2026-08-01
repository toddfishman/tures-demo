// Deterministic mock supplier. Lets the entire engine — search, scoring, the agent loop,
// the event stream — run with ZERO API keys, in CI, and in the demo. Same Offer shape as
// Duffel, so swapping suppliers changes nothing downstream. Deterministic per brief so
// tests are stable (no Math.random).
import type { SupplierAdapter } from "./adapter.ts";
import type { Brief, Offer } from "../types.ts";

// Small stable hash so prices/options vary by route but repeat for the same brief.
function seed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff; // 0..1
}

// Carriers that actually serve a route — so a Hawaii trip never gets offered Finnair.
const REGION = {
  hawaii: /^(HNL|OGG|KOA|ITO|LIH)$/,
  us: /^(JFK|EWR|LGA|BOS|IAD|DCA|ORD|ATL|MIA|FLL|LAX|SFO|SEA|SAN|LAS|DEN|PHX|DFW|IAH|MSP|DTW|PHL|CLT|SLC|PDX|AUS|BNA|MCO|TPA|HNL|OGG|KOA)$/,
  europe: /^(CDG|ORY|LHR|LGW|FRA|MUC|AMS|HEL|CPH|ARN|OSL|FCO|MXP|BCN|MAD|LIS|DUB|ZRH|VIE|BRU|KEF|IVL)$/,
  asia: /^(HND|NRT|KIX|ITM|ICN|GMP|PEK|PVG|HKG|SIN|BKK|TPE|KUL|DEL|BOM)$/,
} as const;
function regionOf(code: string): keyof typeof REGION | "intl" {
  for (const r of Object.keys(REGION) as (keyof typeof REGION)[]) if (REGION[r].test(code)) return r;
  return "intl";
}
const CARRIERS_BY = {
  hawaii: ["Hawaiian", "Alaska", "United", "Delta", "American", "Southwest"],
  us: ["Delta", "United", "American", "Alaska", "JetBlue", "Southwest"],
  europe: ["Finnair", "Lufthansa", "KLM", "British Airways", "Air France", "SAS"],
  asia: ["ANA", "Japan Airlines", "Korean Air", "Singapore", "Cathay Pacific", "United"],
  intl: ["United", "Delta", "American", "Lufthansa", "Emirates", "Qatar Airways"],
};
function carriersFor(origin: string, destination: string): string[] {
  const ro = regionOf(origin), rd = regionOf(destination);
  if (ro === "hawaii" || rd === "hawaii") return CARRIERS_BY.hawaii;
  if (ro === "us" && rd === "us") return CARRIERS_BY.us;
  if (ro === "asia" || rd === "asia") return CARRIERS_BY.asia;
  if (ro === "europe" || rd === "europe") return CARRIERS_BY.europe;
  return CARRIERS_BY.intl;
}
const STAY_STYLES = [
  "design-hotel",
  "boutique",
  "grand-dame",
  "sauna",
  "waterfront",
  "minimalist",
];

export class MockSupplier implements SupplierAdapter {
  readonly name = "mock";
  readonly isLive = false;

  async searchFlights(brief: Brief): Promise<Offer[]> {
    const base = 380 + Math.round(seed(brief.origin + brief.destination) * 900);
    const cabinMult = { economy: 1, premium_economy: 1.8, business: 3.4, first: 6 }[brief.cabin];
    // Children fly at ~75% of an adult fare.
    const seats = brief.adults + brief.children * 0.75;
    const pax = brief.adults + brief.children;
    return carriersFor(brief.origin, brief.destination).slice(0, 4).map((carrier, i) => {
      const price = Math.round(base * cabinMult * (1 + i * 0.12) * seats);
      const stops = i === 0 ? 0 : i === 3 ? 2 : 1;
      return {
        id: `mock-fl-${brief.origin}${brief.destination}-${i}`,
        kind: "flight",
        supplier: this.name,
        title: `${carrier} ${brief.origin}→${brief.destination}`,
        priceUsd: price,
        currency: "USD",
        raw: { carrier, stops, cabin: brief.cabin },
        summary: [
          `${carrier} · ${brief.cabin}`,
          stops === 0 ? "nonstop" : `${stops} stop${stops > 1 ? "s" : ""}`,
          `$${price.toLocaleString()} for ${pax}`,
        ],
      } satisfies Offer;
    });
  }

  async book(offer: Offer): Promise<{ confirmation: string }> {
    // Deterministic confirmation code derived from the offer id (stable for idempotency tests).
    const code = Math.floor(seed(offer.id + "book") * 0xffffff)
      .toString(36)
      .toUpperCase()
      .padStart(5, "0")
      .slice(0, 5);
    const prefix = offer.kind === "flight" ? "PNR" : "CONF";
    return { confirmation: `${prefix}-${code}` };
  }

  async searchStays(brief: Brief): Promise<Offer[]> {
    const nights = brief.returnDate
      ? Math.max(1, Math.round((Date.parse(brief.returnDate) - Date.parse(brief.departDate)) / 86400000))
      : 3;
    const base = 180 + Math.round(seed(brief.destination + "stay") * 320);
    return STAY_STYLES.slice(0, 5).map((style, i) => {
      const nightly = Math.round(base * (1 + i * 0.22));
      const total = nightly * nights;
      return {
        id: `mock-st-${brief.destination}-${i}`,
        kind: "stay",
        supplier: this.name,
        title: `${style.replace("-", " ")} stay in ${brief.destination}`,
        priceUsd: total,
        currency: "USD",
        raw: { style, nightly, nights },
        summary: [style, `$${nightly}/night`, `${nights} nights · $${total.toLocaleString()}`],
      } satisfies Offer;
    });
  }
}
