// Agent orchestrator — STUB for Chunk 2.
//
// This is where the Claude tool-use loop will live. The tools it calls are the engine's own
// verbs, already built or stubbed: runSearch (Chunk 1 ✓), scoreOffers (✓), holdOffer,
// requestConfirmation, book (Chunk 3), notify. The loop:
//
//   1. Receive a Brief (the task + the authorization scope).
//   2. search_flights / search_stays  → runSearch()
//   3. score_options                  → already folded into runSearch()
//   4. propose a plan (best flight + best stay within budget) → emit "propose" event
//   5. if bookingMode !== propose_only: request_confirmation (Chunk 3 gate)
//   6. book within the brief, idempotently, writing every step to the audit log (Chunk 3)
//
// For now: a deterministic, non-LLM planner so the pipeline is exercisable end-to-end before
// the model is wired in. Same return shape the LLM version will produce.
import type { Brief, Offer } from "../types.ts";
import { runSearch } from "../search/service.ts";
import { emitEvent } from "../events/bus.ts";

export interface ProposedPlan {
  tripId: string;
  flight?: Offer;
  stay?: Offer;
  totalUsd: number;
  withinBudget: boolean;
  rationale: string;
}

export async function proposePlan(tripId: string, brief: Brief): Promise<ProposedPlan> {
  const { flights, stays } = await runSearch(tripId, brief);

  // Pick the top-scored option in each category that still fits the budget when combined.
  const flight = flights[0];
  const stay = stays.find((s) => !brief.budgetUsd || (flight?.priceUsd ?? 0) + s.priceUsd <= brief.budgetUsd)
    ?? stays[0];

  const totalUsd = (flight?.priceUsd ?? 0) + (stay?.priceUsd ?? 0);
  const withinBudget = !brief.budgetUsd || totalUsd <= brief.budgetUsd;

  const rationale = [
    flight && `${flight.title} (${flight.scoreReasons?.join(", ") || "best available"})`,
    stay && `${stay.title} (${stay.scoreReasons?.join(", ") || "best available"})`,
    brief.budgetUsd && `$${totalUsd.toLocaleString()} of $${brief.budgetUsd.toLocaleString()} budget`,
  ]
    .filter(Boolean)
    .join(" · ");

  emitEvent(tripId, "propose", "Proposed plan", {
    detail: rationale,
    data: { totalUsd, withinBudget, flightId: flight?.id, stayId: stay?.id },
  });

  return { tripId, flight, stay, totalUsd, withinBudget, rationale };
}
