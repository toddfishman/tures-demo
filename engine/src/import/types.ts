import type { Brief, OfferKind } from "../types.ts";

export type ImportConfidence = "high" | "medium" | "low";

/** One structured leg extracted from pasted text or uploads (Concierge Mode). */
export interface ImportLeg {
  kind: OfferKind;
  title: string;
  supplier: string;
  detail?: string;
  confirmation?: string;
  confidence: ImportConfidence;
  sourceHint?: string;
  /** Human-readable schedule line (depart time, check-in, reservation time). */
  schedule?: string;
  amountUsd?: number;
}

export interface ImportParseResult {
  brief: Brief;
  legs: ImportLeg[];
  assumptions: string[];
  via: "agent" | "heuristic";
  /** Count of legs with confidence low or missing confirmation on watch-critical kinds. */
  gaps: number;
}
