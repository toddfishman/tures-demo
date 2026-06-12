// The engine's domain model. These shapes are the contract between the gateway, the
// supplier adapters, the scorer, and (Chunk 2) the agent orchestrator.
import { z } from "zod";

/** What the user wants AND the scope of authority the agent is granted. The brief is the
 *  safety boundary: no booking action may exceed it. */
export const BriefSchema = z.object({
  origin: z.string().length(3).describe("IATA origin, e.g. SFO"),
  destination: z.string().length(3).describe("IATA destination, e.g. HEL"),
  departDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  adults: z.number().int().min(1).max(9).default(1),
  children: z.number().int().min(0).max(9).default(0),
  /** How the traveler wants money weighed on THIS trip. Drives the value-vs-taste blend in
   *  scoring. "no_limit" tells the agent to optimize purely for fit/quality. */
  priceSensitivity: z.enum(["thrifty", "balanced", "premium", "no_limit"]).default("balanced"),
  /** Optional hard ceiling, in USD, across the whole trip. The agent may never exceed this.
   *  Independent of priceSensitivity — you can be "to the nines" but still cap at $X. */
  budgetUsd: z.number().positive().optional(),
  /** This-trip mood, distinct from the standing Taste Print: why you're going, the pace you
   *  want this time, and what to keep off the table. Folded into the agent's context. */
  tripSentiment: z
    .object({
      purpose: z.array(z.string()).default([]),
      pace: z.enum(["easy", "balanced", "full"]).default("balanced"),
      avoid: z.array(z.string()).default([]),
    })
    .optional(),
  /** Free-form "right kinds of places" signals — drives stay scoring. */
  placeTypes: z.array(z.string()).default([]),
  cabin: z.enum(["economy", "premium_economy", "business", "first"]).default("economy"),
  /** Governs how far the agent may go on its own. */
  bookingMode: z.enum(["propose_only", "confirm_each", "auto_within_brief"]).default("confirm_each"),
  /** Standing authority for the Hiccup Handler: may it auto-rebook on a disruption, and up to
   *  what fare difference, without asking? Defaults to propose-only. */
  rebooking: z
    .object({
      mode: z.enum(["auto", "propose"]).default("propose"),
      maxUpchargeUsd: z.number().nonnegative().optional(),
    })
    .default({ mode: "propose" }),
});
export type Brief = z.infer<typeof BriefSchema>;

export type OfferKind = "flight" | "stay";

/** Normalized offer — every supplier adapter maps its native response into this. */
export interface Offer {
  id: string;
  kind: OfferKind;
  supplier: string;
  title: string;
  /** Total price for the brief's party, in the currency below. */
  priceUsd: number;
  currency: string;
  /** Adapter-specific detail kept for booking (Duffel offer id, rate token, etc.). */
  raw: Record<string, unknown>;
  /** Human-facing summary lines for the execution stream. */
  summary: string[];
  /** 0..1 fit against the brief, filled in by the scorer. */
  score?: number;
  scoreReasons?: string[];
}

export interface SearchResult {
  brief: Brief;
  supplier: string;
  flights: Offer[];
  stays: Offer[];
  /** Wall-clock the search took, ms. */
  tookMs: number;
}

/** One line in the live execution stream. Mirrors the demo's QUEUE event shape so the
 *  front-end can consume real events with minimal change. */
export interface ExecutionEvent {
  ts: string;
  tripId: string;
  kind: "search" | "score" | "propose" | "confirm" | "book" | "notify" | "error" | "status" | "hiccup";
  label: string;
  detail?: string;
  data?: Record<string, unknown>;
}
