// Measure step — "reads the results." When live+configured this would pull real numbers from the
// channel; until then it MODELS one tick of performance so the loop has signal to optimize on.
// The model is deterministic (seeded by creative id), so a given creative behaves consistently and
// the optimizer's kill/scale decisions are reproducible in tests. Every figure it returns is
// flagged simulated:true — a modeled number is never presented as real traction.
import type { Creative, CreativeMetrics } from "./types.ts";
import { isSimulatedChannel } from "./channels.ts";

/** Stable 0..1 pseudo-random from a string — no Math.random, so metrics are reproducible. */
function seeded(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const CPM_USD = 10; // modeled cost per thousand impressions

/** Accrue one tick (~one day of budget) of modeled performance onto a creative's metrics.
 *  Better brand fit → higher click + conversion rates → lower CPA, so winners and losers
 *  separate for the optimizer. Returns fresh metrics; the caller assigns them. */
export function readMetricsTick(creative: Creative): CreativeMetrics {
  const prev = creative.metrics;
  const budget = creative.budgetDailyUsd || 0;

  if (!isSimulatedChannel(creative.channel)) {
    // Live path — a real channel read would replace this. Not wired; never fabricate a live number.
    throw new Error(`live metrics for ${creative.channel} are not wired yet`);
  }

  // Intrinsic quality: brand fit plus a stable per-creative propensity so ties still separate.
  const quality = 0.5 * creative.brandCheck.score + 0.5 * seeded(creative.id);
  const ctr = 0.005 + quality * 0.045; // 0.5%–5%
  const cvr = 0.01 + quality * 0.11; // 1%–12%

  const impressions = budget > 0 ? Math.round((budget / CPM_USD) * 1000) : 0;
  const clicks = Math.round(impressions * ctr);
  const conversions = Math.round(clicks * cvr);

  const totImpr = prev.impressions + impressions;
  const totClicks = prev.clicks + clicks;
  const totConv = prev.conversions + conversions;
  const totSpend = Math.round((prev.spendUsd + budget) * 100) / 100;

  return {
    impressions: totImpr,
    clicks: totClicks,
    conversions: totConv,
    spendUsd: totSpend,
    ctr: totImpr ? Math.round((totClicks / totImpr) * 10000) / 10000 : 0,
    cpaUsd: totConv ? Math.round((totSpend / totConv) * 100) / 100 : null,
    simulated: true,
    readAt: new Date().toISOString(),
  };
}
