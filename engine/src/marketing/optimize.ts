// Optimize step — "kills the losers, scales the winners, and makes more of whatever's working."
// A pure decision function: given a campaign's active creatives and their metrics, it returns what
// to do to each. The service applies the decisions (status + budget + audit + events).
//
// Two guardrails carry over from the rest of Tures:
//   1. Don't act on thin data. A creative is judged only after it has spent a learning floor;
//      below it, "keep" — the same instinct as the Hiccup Handler watching a short delay instead
//      of rebooking on a guess.
//   2. Never exceed the campaign cap. Budget freed by kills is what funds scales; if winners want
//      more than the freed pool, they split it — total daily spend stays ≤ the cap.
import type { Campaign, Creative } from "./types.ts";

export type OptimizeAction = "keep" | "kill" | "scale";

export interface OptimizeDecision {
  creativeId: string;
  action: OptimizeAction;
  fromUsd: number;
  toUsd: number;
  reason: string;
}

/** A creative earns a verdict only after spending this much (or 2× its daily budget, whichever is
 *  larger) — enough for the modeled/real rates to mean something. */
function learningFloorUsd(c: Creative): number {
  return Math.max(10, c.budgetDailyUsd * 2);
}

const active = (c: Creative) => c.status === "live" || c.status === "scaled";

export function decideOptimizations(campaign: Campaign): OptimizeDecision[] {
  const actives = campaign.creatives.filter(active);
  if (!actives.length) return [];

  // Only creatives past the learning floor are eligible to be judged.
  const judged = actives.filter((c) => c.metrics.spendUsd >= learningFloorUsd(c));
  const converters = judged.filter((c) => c.metrics.cpaUsd != null);
  const cpas = converters.map((c) => c.metrics.cpaUsd!).sort((a, b) => a - b);
  const medianCpa = cpas.length ? cpas[Math.floor(cpas.length / 2)] : null;

  const decisions: OptimizeDecision[] = [];
  let freed = 0; // budget released by kills, available to fund scales

  for (const c of actives) {
    const m = c.metrics;
    // Not enough evidence yet — let it run.
    if (m.spendUsd < learningFloorUsd(c)) {
      decisions.push({ creativeId: c.id, action: "keep", fromUsd: c.budgetDailyUsd, toUsd: c.budgetDailyUsd, reason: `learning — spent $${m.spendUsd} of $${learningFloorUsd(c)}` });
      continue;
    }
    // Spent the floor with zero conversions → loser.
    if (m.cpaUsd == null) {
      freed += c.budgetDailyUsd;
      decisions.push({ creativeId: c.id, action: "kill", fromUsd: c.budgetDailyUsd, toUsd: 0, reason: `no conversions after $${m.spendUsd}` });
      continue;
    }
    // Meaningfully worse than the field → loser.
    if (medianCpa != null && m.cpaUsd >= medianCpa * 1.5 && converters.length > 1) {
      freed += c.budgetDailyUsd;
      decisions.push({ creativeId: c.id, action: "kill", fromUsd: c.budgetDailyUsd, toUsd: 0, reason: `CPA $${m.cpaUsd} vs field median $${medianCpa}` });
      continue;
    }
    // Otherwise keep for now; scaling is decided in a second pass once `freed` is known.
    decisions.push({ creativeId: c.id, action: "keep", fromUsd: c.budgetDailyUsd, toUsd: c.budgetDailyUsd, reason: `CPA $${m.cpaUsd}` });
  }

  // Second pass: fund the winners from the freed pool, best CPA first, never over the cap.
  if (freed > 0 && medianCpa != null) {
    const winners = converters
      .filter((c) => c.metrics.cpaUsd! <= medianCpa * 0.8)
      .sort((a, b) => a.metrics.cpaUsd! - b.metrics.cpaUsd!);
    if (winners.length) {
      const share = Math.floor((freed / winners.length) * 100) / 100;
      for (const w of winners) {
        const d = decisions.find((x) => x.creativeId === w.id)!;
        d.action = "scale";
        d.toUsd = Math.round((w.budgetDailyUsd + share) * 100) / 100;
        d.reason = `winner — CPA $${w.metrics.cpaUsd} vs median $${medianCpa}; +$${share}/day from killed losers`;
      }
    }
  }

  return decisions;
}
