// The Marketing Agent's domain model — "code in the cloud that makes decisions off your live
// business data on a loop." A Campaign is one growth objective. The agent researches audience
// pain points, generates on-brand Creatives, checks each against Tures' brand guidelines,
// publishes (SIMULATED until live spend is explicitly enabled), reads performance, kills the
// losers, and scales the winners — appending every step to an audit log, exactly like the
// booking spine. Nothing here ever spends real money on its own: the human-confirm gate and the
// hard MARKETING_LIVE switch sit in front of every publish, mirroring the booking safety model.

export type CampaignObjective = "signups" | "awareness" | "bookings" | "retention";

export type CampaignStatus =
  | "draft" // created; nothing generated yet
  | "confirmation_required" // creatives generated + brand-checked, human-confirm gate open
  | "running" // approved; publishing + optimizing on the loop
  | "paused" // owner paused; no spend
  | "failed"; // a step threw; see audit

/** Where a creative can run. Each maps to a channel adapter in channels.ts. Adapters are guarded:
 *  with no channel key configured they SIMULATE (never fabricate a real "published" state). */
export type Channel = "meta" | "google" | "reddit" | "x" | "email";

export type CreativeStatus =
  | "proposed" // generated, awaiting brand check / approval
  | "approved" // passed brand check + human-confirm; eligible to publish
  | "rejected" // failed brand check; never published
  | "live" // published (or simulated-published) and accruing metrics
  | "killed" // a loser the optimizer stopped
  | "scaled"; // a winner the optimizer gave more budget

/** How far the agent may go without asking. Mirrors Brief.bookingMode. */
export type CampaignMode = "propose_only" | "auto_within_budget";

/** One audience pain point the research step surfaced — the "why they'd want Tures" a creative
 *  is built around. Sourced, never invented (research.ts refuses to fabricate). */
export interface PainPoint {
  id: string;
  /** The frustration in the traveler's own words, short. */
  pain: string;
  /** The Tures angle that answers it (e.g. "confirmation numbers, not links"). */
  angle: string;
  /** Where it came from — a source label, and a url when there is a real one. */
  source: string;
  url?: string;
}

/** The deterministic + optional-LLM brand check verdict for a creative. This is the tweet's
 *  "vision model to check it against brand guidelines," done as text: every creative must pass
 *  before it can publish. See brand.ts. */
export interface BrandCheck {
  pass: boolean;
  /** 0..1 how well it fits Tures' voice; ties feed the optimizer's confidence, not the gate. */
  score: number;
  /** Hard rule breaks that fail the check (e.g. a fake-success claim, a "click here" link CTA). */
  violations: string[];
  /** Softer suggestions that don't block. */
  notes: string[];
}

/** Performance for one creative. `simulated` is load-bearing: until a real ad account is wired
 *  AND MARKETING_LIVE is on, these are modeled figures and MUST be labeled so no one mistakes a
 *  sample for real traction (the "no fake success states" rule, applied to growth). */
export interface CreativeMetrics {
  impressions: number;
  clicks: number;
  /** Objective conversions — signups for a signups campaign, etc. */
  conversions: number;
  spendUsd: number;
  /** Derived, cached for the optimizer + UI. */
  ctr: number; // clicks / impressions
  cpaUsd: number | null; // spend / conversions, null when no conversions yet
  simulated: boolean;
  /** Last time metrics were read from the channel (or modeled). */
  readAt: string;
}

export interface Creative {
  id: string;
  channel: Channel;
  /** Which pain point this creative answers. */
  painPointId: string;
  /** The angle in one phrase, for the audit trail + UI. */
  angle: string;
  headline: string;
  body: string;
  cta: string;
  /** A text brief for an image model (Nano-Banana-style). We describe, never fabricate an asset. */
  imageBrief: string;
  brandCheck: BrandCheck;
  status: CreativeStatus;
  /** Per-creative daily budget the agent is willing to spend, USD. Bounded by the campaign cap. */
  budgetDailyUsd: number;
  metrics: CreativeMetrics;
  /** True until a real channel publish happens under a live switch. */
  simulated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  accountId: string;
  /** Which product this campaign grows. Brand voice + angles are keyed off this so the same
   *  engine can run Tures or another brand (see brand.ts brands table). */
  product: string;
  objective: CampaignObjective;
  /** Free-form audience description the research step targets. */
  audience: string;
  /** Total daily budget across all live creatives, USD. The agent may never exceed it. */
  budgetDailyUsd: number;
  mode: CampaignMode;
  status: CampaignStatus;
  research: PainPoint[];
  creatives: Creative[];
  /** How many loop passes have run (research → create → measure → optimize). */
  loops: number;
  /** tripId-style topic for the live event stream so the front-end can subscribe per campaign. */
  streamId: string;
  audit: AuditEntry[];
  /** True while any spend/publish would be simulated (no live switch or no channel key). */
  simulated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  ts: string;
  actor: "agent" | "user" | "system";
  action: string;
  detail?: string;
}
