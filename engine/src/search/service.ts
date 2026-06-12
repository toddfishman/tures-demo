// Search orchestration: fan out to the active supplier for flights + stays in parallel,
// normalize, score, and emit execution events as we go. This is what the agent loop (Chunk 2)
// will call as its `search_flights` / `search_stays` tools.
import type { Brief, SearchResult } from "../types.ts";
import { getSupplier } from "../suppliers/index.ts";
import { scoreOffers } from "./score.ts";
import { assembleContext, type TravelerContext } from "../agent/context.ts";
import { emitEvent } from "../events/bus.ts";
import { log } from "../logger.ts";

export async function runSearch(tripId: string, brief: Brief, accountId = "demo", ctx?: TravelerContext): Promise<SearchResult> {
  const supplier = getSupplier();
  const startedAt = performance.now();
  // Personalization: the unified Traveler Context (standing Taste Print + "where you've been" +
  // this-trip avoid) sharpens scoring. Assembled here if the caller didn't already.
  const context = ctx ?? assembleContext(accountId, brief).context;
  const tasteTags = context.tasteTags;
  const avoid = context.avoid;

  const pax = brief.adults + brief.children;
  emitEvent(tripId, "search", `Searching ${supplier.name} for ${brief.origin}→${brief.destination}`, {
    detail: `${pax} traveler(s) · ${brief.cabin} · ${brief.priceSensitivity ?? "balanced"}${brief.budgetUsd ? ` · ≤ $${brief.budgetUsd.toLocaleString()}` : ""}`,
  });

  const [flightsRaw, staysRaw] = await Promise.all([
    supplier.searchFlights(brief).catch((e) => {
      log.error("flight search failed", { err: String(e) });
      emitEvent(tripId, "error", "Flight search failed", { detail: String(e) });
      return [];
    }),
    supplier.searchStays(brief).catch((e) => {
      log.error("stay search failed", { err: String(e) });
      emitEvent(tripId, "error", "Stay search failed", { detail: String(e) });
      return [];
    }),
  ]);

  const flights = scoreOffers(flightsRaw, brief, [], avoid);
  const stays = scoreOffers(staysRaw, brief, tasteTags, avoid);

  const tookMs = Math.round(performance.now() - startedAt);

  const topFlight = flights[0];
  const topStay = stays[0];
  emitEvent(tripId, "score", `Ranked ${flights.length} flights, ${stays.length} stays`, {
    detail: [
      topFlight && `best flight: ${topFlight.title} (${topFlight.score})`,
      topStay && `best stay: ${topStay.title} (${topStay.score})`,
    ]
      .filter(Boolean)
      .join(" · "),
    data: { tookMs },
  });

  return { brief, supplier: supplier.name, flights, stays, tookMs };
}
