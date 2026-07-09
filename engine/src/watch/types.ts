// Adaptive Trip Watch — always-on alerts + risk-scored scans with pass-through metering (Option A).

export type RiskLevel = "clear" | "watch" | "elevated" | "critical";
export type ScanKind = "brief" | "fast" | "news" | "deep" | "alerts";

export type MeterKind = "open_meteo" | "news_query" | "x_read" | "deep_scout" | "geocode";

export interface WatchMeter {
  openMeteo: number;
  newsQueries: number;
  xReads: number;
  deepScouts: number;
  /** Raw provider COGS (USD). */
  cogsUsd: number;
  /** cogs × (1 + margin/100), capped at capUsd. */
  billableUsd: number;
}

export interface TripWatch {
  bookingId: string;
  tripId: string;
  accountId: string;
  enabled: boolean;
  /** User-approved monthly cap for pass-through watch spend (USD). */
  capUsd: number;
  /** User-approved spend above capUsd (pass-through overage). */
  capExtraUsd?: number;
  /** Set when scans pause at cap — awaiting user approval. */
  pendingCapUsd?: number;
  /** Tures margin on metered COGS (percent). */
  marginPercent: number;
  /** Always-on push-style checks (weather thresholds + X keyword poll). */
  alertsOn: boolean;

  riskScore: number;
  riskLevel: RiskLevel;
  scansToday: number;
  scansBudgetToday: number;
  deepScansToday: number;
  lastScanAt?: string;
  lastBriefAt?: string;
  /** UTC date YYYY-MM-DD of last morning brief. */
  lastBriefDay?: string;
  lastAlertsAt?: string;

  meter: WatchMeter;
  keywords: string[];
  xQuery?: string;
  xSinceId?: string;
  surfacedSignalIds: string[];

  createdAt: string;
  updatedAt: string;
}

export interface WatchPricing {
  cogsUsd: number;
  marginPercent: number;
  marginUsd: number;
  billableUsd: number;
  capUsd: number;
  capExtraUsd: number;
  effectiveCapUsd: number;
  atCap: boolean;
  pendingCapUsd?: number;
  remainingUsd: number;
}
