// Search orchestration: fan out to the active supplier for flights + stays in parallel,
// normalize, score, and emit execution events as we go. This is what the agent loop (Chunk 2)
// will call as its `search_flights` / `search_stays` tools.
import type { Brief, SearchResult } from "../types.ts";
import { getSupplier } from "../suppliers/index.ts";
import { scoreOffers } from "./score.ts";
import { tasteSignal } from "../places/index.ts";
import { emitEvent } from "../events/bus.ts";
import { log } from "../logger.ts";

export async function runSearch(tripId: string, brief: Brief, accountId = "demo"): Promise<SearchResult> {
  const supplier = getSupplier();
  const startedAt = performance.now();
  // Personalization: the account's favorite tags from "where you've been" sharpen stay scoring.
  const tasteTags = tasteSignal(accountId).favoriteTags;

  emitEvent(tripId, "search", `Searching ${supplier.name} for ${brief.origin}→${brief.destination}`, {
    detail: `${brief.adults} traveler(s) · ${brief.cabin}${brief.budgetUsd ? ` · ≤ $${brief.budgetUsd.toLocaleString()}` : ""}`,
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

  const flights = scoreOffers(flightsRaw, brief);
  const stays = scoreOffers(staysRaw, brief, tasteTags);

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
