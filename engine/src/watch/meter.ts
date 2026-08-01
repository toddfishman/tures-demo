// COGS table + pass-through billing (Option A: metered cost + margin, hard cap).
import type { TripWatch, MeterKind, WatchMeter, WatchPricing } from "./types.ts";

/** USD cost per unit — update when provider pricing changes. */
export const COGS_USD: Record<MeterKind, number> = {
  open_meteo: 0,
  geocode: 0,
  news_query: 0.001,
  x_read: 0.005,
  deep_scout: 0.1,
};

export function emptyMeter(): WatchMeter {
  return { openMeteo: 0, newsQueries: 0, xReads: 0, deepScouts: 0, cogsUsd: 0, billableUsd: 0 };
}

export function recordUsage(w: TripWatch, kind: MeterKind, units = 1): void {
  const cost = COGS_USD[kind] * units;
  if (kind === "open_meteo") w.meter.openMeteo += units;
  else if (kind === "news_query") w.meter.newsQueries += units;
  else if (kind === "x_read") w.meter.xReads += units;
  else if (kind === "deep_scout") w.meter.deepScouts += units;
  w.meter.cogsUsd = roundUsd(w.meter.cogsUsd + cost);
  recalcBillable(w);
}

function roundUsd(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function effectiveCap(w: TripWatch): number {
  return w.capUsd + (w.capExtraUsd ?? 0);
}

export function recalcBillable(w: TripWatch): void {
  const margin = w.marginPercent / 100;
  const raw = w.meter.cogsUsd * (1 + margin);
  w.meter.billableUsd = roundUsd(Math.min(raw, effectiveCap(w)));
}

export function atCap(w: TripWatch): boolean {
  recalcBillable(w);
  const cap = effectiveCap(w);
  const margin = w.marginPercent / 100;
  const raw = w.meter.cogsUsd * (1 + margin);
  return raw >= cap - 0.0001;
}

export function pricing(w: TripWatch): WatchPricing {
  recalcBillable(w);
  const marginUsd = roundUsd(w.meter.cogsUsd * (w.marginPercent / 100));
  return {
    cogsUsd: w.meter.cogsUsd,
    marginPercent: w.marginPercent,
    marginUsd,
    billableUsd: w.meter.billableUsd,
    capUsd: w.capUsd,
    capExtraUsd: w.capExtraUsd ?? 0,
    effectiveCapUsd: effectiveCap(w),
    atCap: atCap(w),
    pendingCapUsd: w.pendingCapUsd,
    remainingUsd: roundUsd(Math.max(0, effectiveCap(w) - w.meter.billableUsd)),
  };
}
