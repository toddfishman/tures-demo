// Marketing service — the safety spine, modeled on booking/service.ts. createCampaign researches
// pain points, generates on-brand creatives, and opens the human-confirm gate; approveCampaign is
// the "money moves" step (simulated until MARKETING_LIVE) that allocates budget and publishes;
// runCampaignLoop advances the loop. Every step is appended to the audit log and emitted to the
// live stream, and NOTHING publishes or spends without either a human approval or an explicit
// auto-within-budget mode on a simulated campaign — never on live money.
import type { Campaign, CampaignMode, CampaignObjective, Channel, Creative } from "./types.ts";
import { campaigns, nextCampaignId } from "./store.ts";
import { researchPains } from "./research.ts";
import { generateCreatives } from "./creative.ts";
import { publish, isSimulatedChannel } from "./channels.ts";
import { runOneLoop, activeBudget } from "./loop.ts";
import { config } from "../config.ts";
import { emitEvent } from "../events/bus.ts";
import { log } from "../logger.ts";

function audit(c: Campaign, actor: Campaign["audit"][number]["actor"], action: string, detail?: string) {
  c.audit.push({ ts: new Date().toISOString(), actor, action, detail });
}

let streamCounter = 0;
const nextStreamId = () => `mkstream_${Date.now().toString(36)}_${streamCounter++}`;

export interface CreateCampaignInput {
  accountId?: string;
  product?: string;
  objective?: CampaignObjective;
  audience?: string;
  budgetDailyUsd: number;
  mode?: CampaignMode;
  channel?: Channel;
}

/** A campaign may publish on its own only when it is explicitly auto-within-budget AND fully
 *  simulated. The moment real money is in play (MARKETING_LIVE + a channel key), a human must
 *  approve — the same line the booking spine draws with canAutoBook + isSimulatedBooking. */
function canAutoPublish(c: Campaign): boolean {
  return c.mode === "auto_within_budget" && c.simulated;
}

/** Is this whole campaign simulated? True unless the live switch is on for its channel. */
function campaignSimulated(channel: Channel): boolean {
  return isSimulatedChannel(channel);
}

export async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
  const accountId = input.accountId ?? "demo";
  const product = input.product ?? "Tures";
  const channel = input.channel ?? "meta";
  const now = new Date().toISOString();

  const campaign: Campaign = {
    id: nextCampaignId(),
    accountId,
    product,
    objective: input.objective ?? "signups",
    audience: input.audience ?? "",
    budgetDailyUsd: input.budgetDailyUsd,
    mode: input.mode ?? "propose_only",
    status: "draft",
    research: [],
    creatives: [],
    loops: 0,
    streamId: nextStreamId(),
    audit: [],
    simulated: campaignSimulated(channel),
    createdAt: now,
    updatedAt: now,
  };
  audit(campaign, "agent", "campaign_created", `${product} · ${campaign.objective} · $${input.budgetDailyUsd}/day`);
  campaigns.put(campaign);

  // Research → creatives. Both degrade gracefully with no Anthropic key.
  emitEvent(campaign.streamId, "search", "Researching audience pain points", { data: { campaignId: campaign.id } });
  campaign.research = await researchPains(product, campaign.audience);
  audit(campaign, "agent", "research_done", `${campaign.research.length} pain points`);
  emitEvent(campaign.streamId, "score", `Found ${campaign.research.length} pain points`, { data: { campaignId: campaign.id } });

  campaign.creatives = await generateCreatives(product, channel, campaign.research);
  const passed = campaign.creatives.filter((c) => c.status !== "rejected").length;
  const rejected = campaign.creatives.length - passed;
  audit(campaign, "agent", "creatives_generated", `${passed} on-brand${rejected ? `, ${rejected} rejected by brand check` : ""}`);
  for (const c of campaign.creatives.filter((c) => c.status === "rejected")) {
    audit(campaign, "system", "brand_rejected", `${c.headline} — ${c.brandCheck.violations.join("; ")}`);
  }
  emitEvent(campaign.streamId, "propose", `${passed} on-brand creatives ready`, {
    detail: rejected ? `${rejected} rejected by the brand check` : undefined,
    data: { campaignId: campaign.id, passed, rejected },
  });

  // Auto-publish only when explicitly allowed AND simulated; otherwise open the gate.
  if (canAutoPublish(campaign)) {
    audit(campaign, "system", "auto_publish", "auto_within_budget on a simulated campaign — no money moves");
    campaigns.put(campaign);
    return (await approveCampaign(campaign.id)) ?? campaigns.put(campaign);
  }

  campaign.status = "confirmation_required";
  audit(campaign, "agent", "awaiting_confirmation", "human-confirm gate opened — nothing published yet");
  emitEvent(campaign.streamId, "confirm", "Awaiting your approval to launch", {
    detail: `${passed} creatives · $${campaign.budgetDailyUsd}/day${campaign.simulated ? " · sample launch, no money moves" : ""}`,
    data: { campaignId: campaign.id },
  });
  return campaigns.put(campaign);
}

/** The launch step. Allocates the daily budget across the approved creatives and publishes each
 *  (simulated unless the live switch is on). Idempotent: a running/failed campaign is returned
 *  as-is. */
export async function approveCampaign(id: string): Promise<Campaign | null> {
  const campaign = campaigns.get(id);
  if (!campaign) return null;
  if (campaign.status === "running" || campaign.status === "failed") return campaign;
  if (campaign.status !== "confirmation_required" && campaign.status !== "draft") return campaign;

  const approved = campaign.creatives.filter((c) => c.status === "proposed");
  if (!approved.length) {
    campaign.status = "failed";
    audit(campaign, "system", "launch_failed", "no on-brand creatives to publish");
    emitEvent(campaign.streamId, "error", "Nothing to launch", { detail: "all creatives were rejected by the brand check", data: { campaignId: campaign.id } });
    return campaigns.put(campaign);
  }

  audit(campaign, "user", "approved", `launch approved — ${approved.length} creatives`);

  // Split the daily cap evenly across the approved creatives.
  const per = Math.floor((campaign.budgetDailyUsd / approved.length) * 100) / 100;
  try {
    for (const c of approved) {
      c.budgetDailyUsd = per;
      c.status = "approved";
      const res = await publish(c);
      c.status = "live";
      c.simulated = res.simulated;
      c.metrics = { ...c.metrics, simulated: res.simulated };
      c.updatedAt = new Date().toISOString();
      const verb = res.simulated ? "Simulated launch" : "Launched";
      audit(campaign, "agent", res.simulated ? "creative_simulated" : "creative_launched", `${c.channel}: ${c.headline} → ${res.externalId} · $${per}/day`);
      emitEvent(campaign.streamId, "book", `${verb}: ${c.headline}`, { detail: res.externalId, data: { campaignId: campaign.id, creativeId: c.id, simulated: res.simulated } });
    }
    campaign.status = "running";
    campaign.simulated = campaign.creatives.some((c) => c.simulated);
    const anySim = campaign.creatives.some((c) => c.status === "live" && c.simulated);
    audit(campaign, "system", "running", anySim ? "live on the loop (simulated spend)" : "live on the loop");
    emitEvent(campaign.streamId, "notify", anySim ? "Campaign running (simulated)" : "Campaign running", {
      detail: `${approved.length} creatives · $${activeBudget(campaign)}/day${anySim ? " · sample spend, no money moved" : ""}`,
      data: { campaignId: campaign.id, simulated: anySim },
    });
  } catch (e) {
    campaign.status = "failed";
    audit(campaign, "system", "launch_failed", String(e));
    emitEvent(campaign.streamId, "error", "Launch failed", { detail: String(e), data: { campaignId: campaign.id } });
    log.error("campaign launch failed", { campaignId: campaign.id, err: String(e) });
  }
  return campaigns.put(campaign);
}

/** Advance the loop once (measure → optimize → refill). Used by the scheduler and the manual run
 *  endpoint. A paused/non-running campaign is a no-op. */
export async function runCampaignLoop(id: string): Promise<Campaign | null> {
  const campaign = campaigns.get(id);
  if (!campaign) return null;
  if (campaign.status !== "running") return campaign;

  try {
    const summary = await runOneLoop(campaign);
    for (const d of summary.decisions) {
      if (d.action === "kill") {
        audit(campaign, "agent", "killed_loser", d.reason);
        emitEvent(campaign.streamId, "status", "Killed a losing creative", { detail: d.reason, data: { campaignId: campaign.id, creativeId: d.creativeId } });
      } else if (d.action === "scale") {
        audit(campaign, "agent", "scaled_winner", `$${d.fromUsd}→$${d.toUsd}/day · ${d.reason}`);
        emitEvent(campaign.streamId, "status", "Scaled a winning creative", { detail: d.reason, data: { campaignId: campaign.id, creativeId: d.creativeId } });
      }
    }
    for (const r of summary.refilled) {
      audit(campaign, "agent", "refill_created", `new variant of a winner: ${r.headline}${r.simulated ? " (simulated)" : ""}`);
      emitEvent(campaign.streamId, "book", `Made more of what's working: ${r.headline}`, { data: { campaignId: campaign.id, creativeId: r.id, simulated: r.simulated } });
    }
    audit(campaign, "system", "loop", `pass ${campaign.loops} · measured ${summary.measured} · $${activeBudget(campaign)}/day active`);
  } catch (e) {
    audit(campaign, "system", "loop_error", String(e));
    emitEvent(campaign.streamId, "error", "Loop error", { detail: String(e), data: { campaignId: campaign.id } });
    log.error("campaign loop failed", { campaignId: campaign.id, err: String(e) });
  }
  return campaigns.put(campaign);
}

export function pauseCampaign(id: string): Campaign | null {
  const campaign = campaigns.get(id);
  if (!campaign) return null;
  if (campaign.status === "running") {
    campaign.status = "paused";
    audit(campaign, "user", "paused", "owner paused — no further spend");
    emitEvent(campaign.streamId, "notify", "Campaign paused", { data: { campaignId: campaign.id } });
  }
  return campaigns.put(campaign);
}

export function resumeCampaign(id: string): Campaign | null {
  const campaign = campaigns.get(id);
  if (!campaign) return null;
  if (campaign.status === "paused") {
    campaign.status = "running";
    audit(campaign, "user", "resumed", "owner resumed the loop");
    emitEvent(campaign.streamId, "notify", "Campaign resumed", { data: { campaignId: campaign.id } });
  }
  return campaigns.put(campaign);
}

/** Status flags for /health + the route's capabilities. */
export function marketingStatus() {
  return {
    enabled: config.marketing.enabled,
    live: config.marketing.live,
    simulated: !config.marketing.live,
    brain: config.anthropicKey ? "anthropic" : "template",
    dailyBudgetCapUsd: config.marketing.dailyBudgetCapUsd,
    tickMin: config.marketing.tickMin,
  };
}
