// Duffel adapter (v1 supplier). Talks to the Duffel REST API over fetch — no SDK dependency,
// so the request/response shapes are explicit and auditable. Used automatically when
// DUFFEL_API_TOKEN is set; otherwise the engine uses the mock supplier.
//
// Both flights (/air/offer_requests) and stays (/stays/search) are real Duffel offers. Stays are
// searched around a coordinate from geo/geocode() (airport table + Google); if a destination can't
// be geocoded or the search errors/empties, stays fall back to the mock supplier so the flow holds.
import type { SupplierAdapter } from "./adapter.ts";
import type { Brief, Offer } from "../types.ts";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import { MockSupplier } from "./mock.ts";
import { geocode } from "../geo/index.ts";
import { toUsd } from "./fx.ts";

/** Add N nights to a YYYY-MM-DD date (used when the brief has no explicit return date). */
function addNights(date: string, nights: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + nights);
  return d.toISOString().slice(0, 10);
}

const DUFFEL_VERSION = "v2";

export class DuffelSupplier implements SupplierAdapter {
  readonly name = "duffel";
  readonly isLive = config.duffel.isLive;
  private stayFallback = new MockSupplier();

  private async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${config.duffel.apiUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.duffel.token}`,
        "Duffel-Version": DUFFEL_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ data: body }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Duffel ${path} ${res.status}: ${text.slice(0, 500)}`);
    }
    return res.json();
  }

  async searchFlights(brief: Brief): Promise<Offer[]> {
    const slices: Array<{ origin: string; destination: string; departure_date: string }> = [
      { origin: brief.origin, destination: brief.destination, departure_date: brief.departDate },
    ];
    if (brief.returnDate) {
      slices.push({ origin: brief.destination, destination: brief.origin, departure_date: brief.returnDate });
    }
    const passengers: Array<{ type: "adult" } | { age: number }> = [
      ...Array.from({ length: brief.adults }, () => ({ type: "adult" as const })),
      // Duffel identifies a child passenger by age, not a "child" type.
      ...Array.from({ length: brief.children }, () => ({ age: 8 })),
    ];

    // return_offers=true embeds offers in the response so we avoid a second round-trip.
    const json = await this.post("/air/offer_requests?return_offers=true&supplier_timeout=10000", {
      slices,
      passengers,
      cabin_class: brief.cabin,
    });

    const offers: any[] = json?.data?.offers ?? [];
    return offers
      .flatMap((o, i): Offer[] => {
        const carriers: string[] = (o.slices ?? [])
          .flatMap((s: any) => s.segments ?? [])
          .map((seg: any) => seg.marketing_carrier?.name)
          .filter(Boolean);
        const carrier = carriers[0] ?? o.owner?.name ?? "Carrier";
        const maxStops = Math.max(
          0,
          ...(o.slices ?? []).map((s: any) => Math.max(0, (s.segments?.length ?? 1) - 1)),
        );
        const amount = Number(o.total_amount ?? 0);
        const currency = o.total_currency ?? "USD";
        // The budget gate compares priceUsd against brief.budgetUsd, so it must really be USD.
        // An offer in a currency we can't convert is dropped — better no offer than a mispriced one.
        const usd = toUsd(amount, currency);
        if (usd === null) {
          log.warn("duffel flights: skipping offer in unconvertible currency", { currency, offerId: o.id });
          return [];
        }
        return [{
          id: o.id ?? `duffel-fl-${i}`,
          kind: "flight",
          supplier: this.name,
          title: `${carrier} ${brief.origin}→${brief.destination}`,
          priceUsd: usd,
          currency,
          raw: { offerId: o.id, owner: o.owner?.name, cabin: brief.cabin, expiresAt: o.expires_at, nativeAmount: amount },
          summary: [
            `${carrier} · ${brief.cabin}`,
            maxStops === 0 ? "nonstop" : `${maxStops} stop${maxStops > 1 ? "s" : ""}`,
            currency === "USD"
              ? `USD ${amount.toLocaleString()}`
              : `${currency} ${amount.toLocaleString()} (≈ $${usd.toLocaleString()})`,
          ],
        } satisfies Offer];
      })
      .slice(0, 8);
  }

  async searchStays(brief: Brief): Promise<Offer[]> {
    // Duffel Stays searches around a coordinate. Geocode the destination IATA → lat/lng; if we
    // can't (off-table + no Google key) or the search errors/returns nothing, fall back to mock
    // stays so the flow never breaks.
    const geo = await geocode(brief.destination);
    if (!geo) {
      log.warn("duffel stays: no coordinates for destination — using mock", { destination: brief.destination });
      return this.stayFallback.searchStays(brief);
    }

    const checkIn = brief.departDate;
    const checkOut = brief.returnDate ?? addNights(brief.departDate, 3);
    const nights = Math.max(1, Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86400000));
    const guests: Array<{ type: "adult" } | { type: "child"; age: number }> = [
      ...Array.from({ length: brief.adults }, () => ({ type: "adult" as const })),
      ...Array.from({ length: brief.children }, () => ({ type: "child" as const, age: 8 })),
    ];

    try {
      const json = await this.post("/stays/search", {
        rooms: 1,
        location: { radius: 8, geographic_coordinates: { latitude: geo.lat, longitude: geo.lng } },
        check_in_date: checkIn,
        check_out_date: checkOut,
        guests,
      });
      const results: any[] = json?.data?.results ?? [];
      const offers = results
        .flatMap((r, i): Offer[] => {
          const acc = r.accommodation ?? {};
          const amount = Number(r.cheapest_rate_total_amount ?? 0);
          const currency = r.cheapest_rate_currency ?? "USD";
          // Same rule as flights: priceUsd feeds the budget gate, so unconvertible currencies are
          // dropped rather than passed through as if USD.
          const usd = toUsd(amount, currency);
          if (usd === null) {
            log.warn("duffel stays: skipping result in unconvertible currency", { currency, resultId: r.id });
            return [];
          }
          const photo = Array.isArray(acc.photos) && acc.photos[0]?.url ? acc.photos[0].url : undefined;
          const stars = acc.rating ? `${acc.rating}-star` : null;
          const review = acc.review_score ? `${acc.review_score}/10 guests` : null;
          const priceLine = currency === "USD"
            ? `USD ${amount.toLocaleString()} · ${nights} nights`
            : `${currency} ${amount.toLocaleString()} (≈ $${usd.toLocaleString()}) · ${nights} nights`;
          return [{
            id: r.id ?? `duffel-st-${i}`,
            kind: "stay",
            supplier: this.name,
            title: acc.name ?? `Stay in ${geo.label}`,
            priceUsd: usd,
            currency,
            raw: {
              searchResultId: r.id,
              address: acc.location?.address,
              photo,
              rating: acc.rating,
              reviewScore: acc.review_score,
              nights,
              expiresAt: r.expires_at,
              nativeAmount: amount,
            },
            summary: [stars, review, priceLine].filter(Boolean) as string[],
          } satisfies Offer];
        })
        .slice(0, 8);
      if (offers.length) return offers;
      log.warn("duffel stays: no results — using mock", { destination: brief.destination, label: geo.label });
      return this.stayFallback.searchStays(brief);
    } catch (e) {
      log.warn("duffel stays search failed — using mock", { destination: brief.destination, err: String(e) });
      return this.stayFallback.searchStays(brief);
    }
  }
}
