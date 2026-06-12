// Duffel adapter (v1 supplier). Talks to the Duffel REST API over fetch — no SDK dependency,
// so the request/response shapes are explicit and auditable. Used automatically when
// DUFFEL_API_TOKEN is set; otherwise the engine uses the mock supplier.
//
// Scope note (Chunk 1): flights are real Duffel offers. Duffel Stays requires geographic
// coordinates, and IATA→coordinates geocoding is a Chunk-1 follow-up — until then stays are
// delegated to the mock supplier and clearly tagged supplier:"mock" on each offer.
import type { SupplierAdapter } from "./adapter.ts";
import type { Brief, Offer } from "../types.ts";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import { MockSupplier } from "./mock.ts";

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
    return offers.slice(0, 8).map((o, i) => {
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
      return {
        id: o.id ?? `duffel-fl-${i}`,
        kind: "flight",
        supplier: this.name,
        title: `${carrier} ${brief.origin}→${brief.destination}`,
        priceUsd: amount, // FX normalization to USD is a Chunk-3 item; currency tracked below.
        currency: o.total_currency ?? "USD",
        raw: { offerId: o.id, owner: o.owner?.name, cabin: brief.cabin, expiresAt: o.expires_at },
        summary: [
          `${carrier} · ${brief.cabin}`,
          maxStops === 0 ? "nonstop" : `${maxStops} stop${maxStops > 1 ? "s" : ""}`,
          `${o.total_currency ?? ""} ${amount.toLocaleString()}`.trim(),
        ],
      } satisfies Offer;
    });
  }

  async searchStays(brief: Brief): Promise<Offer[]> {
    // Duffel Stays needs geo-coordinates; until IATA→coords geocoding lands, use mock stays.
    log.warn("duffel: stays delegated to mock (geocoding is a Chunk-1 follow-up)", {
      destination: brief.destination,
    });
    return this.stayFallback.searchStays(brief);
  }
}
