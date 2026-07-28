// One pass of the growth loop: measure → optimize → refill. Kept separate from service.ts so it
// can be called by the scheduler (background tick) and by the manual /marketing/:id/run endpoint
// with identical behavior. Pure-ish: it mutates the passed campaign's creatives and returns a
// summary; the caller persists + audits + emits.
import type { Campaign, Creative } from "./types.ts";
import { readMetricsTick } from "./metrics.ts";
import { decideOptimizations, type OptimizeDecision } from "./optimize.ts";
import { generateCreatives } from "./creative.ts";
import { publish } from "./channels.ts";

export interface LoopSummary {
  measured: number;
  decisions: OptimizeDecision[];
  refilled: Creative[];
}

const active = (c: Creative) => c.status === "live" || c.status === "scaled";
const MIN_REFILL_USD = 5;

/** Sum of daily budget across creatives currently spending. */
export function activeBudget(campaign: Campaign): number {
  return Math.round(campaign.creatives.filter(active).reduce((s, c) => s + c.budgetDailyUsd, 0) * 100) / 100;
}

export async function runOneLoop(campaign: Campaign): Promise<LoopSummary> {
  // 1. Measure — accrue a tick of performance onto every live creative.
  let measured = 0;
  for (const c of campaign.creatives) {
    if (!active(c)) continue;
    c.metrics = readMetricsTick(c);
    c.updatedAt = new Date().toISOString();
    measured++;
  }

  // 2. Optimize — kill losers, scale winners, always within the campaign cap.
  const decisions = decideOptimizations(campaign);
  for (const d of decisions) {
    const c = campaign.creatives.find((x) => x.id === d.creativeId);
    if (!c) continue;
    if (d.action === "kill") {
      c.status = "killed";
      c.budgetDailyUsd = 0;
    } else if (d.action === "scale") {
      c.status = "scaled";
      c.budgetDailyUsd = d.toUsd;
    }
    c.updatedAt = new Date().toISOString();
  }

  // 3. Refill — "make more of whatever's working." If the cap has room after kills/scales and we
  //    have a winner to learn from, generate a fresh variant around the best angle and put the
  //    leftover budget behind it. At most one new creative per loop to keep spend + LLM bounded.
  const refilled: Creative[] = [];
  const leftover = Math.round((campaign.budgetDailyUsd - activeBudget(campaign)) * 100) / 100;
  const winner = campaign.creatives
    .filter((c) => c.status === "scaled" && c.metrics.cpaUsd != null)
    .sort((a, b) => (a.metrics.cpaUsd! - b.metrics.cpaUsd!))[0];
  if (leftover >= MIN_REFILL_USD && winner) {
    const pain = campaign.research.find((p) => p.id === winner.painPointId);
    if (pain) {
      const [fresh] = await generateCreatives(campaign.product, winner.channel, [pain]);
      if (fresh && fresh.status !== "rejected") {
        fresh.budgetDailyUsd = leftover;
        const res = await publish(fresh);
        fresh.status = "live";
        fresh.simulated = res.simulated;
        fresh.metrics = { ...fresh.metrics, simulated: res.simulated };
        campaign.creatives.push(fresh);
        refilled.push(fresh);
      }
    }
  }

  campaign.loops++;
  return { measured, decisions, refilled };
}
