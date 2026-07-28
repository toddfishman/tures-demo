// Channel adapters — where a creative actually publishes. Guarded exactly like the booking
// supplier: a real ad is placed ONLY when the hard live switch (MARKETING_LIVE) is on AND that
// channel has a token configured. Otherwise the publish is SIMULATED — it returns a clearly
// sample-labeled external id and spends nothing. This is the "no fake success states" rule applied
// to growth: a simulated publish is never dressed up as a live one.
import type { Channel, Creative } from "./types.ts";
import { config } from "../config.ts";

export interface PublishResult {
  /** The ad's id on the channel — or a SAMPLE- id when simulated. */
  externalId: string;
  simulated: boolean;
}

/** True when publishing to this channel would be simulated (no live switch, or no channel token).
 *  Default-deny: anything not explicitly live-and-configured simulates. */
export function isSimulatedChannel(channel: Channel): boolean {
  if (!config.marketing.live) return true;
  return !config.marketing.channelKeys[channel];
}

function sampleId(channel: Channel, creativeId: string): string {
  return `SAMPLE-${channel}-${creativeId}`;
}

/** Publish (or simulate publishing) a creative. Never charges here — spend is metered by the
 *  optimizer against the campaign cap. A rejected creative can never be published. */
export async function publish(creative: Creative): Promise<PublishResult> {
  if (creative.status === "rejected") {
    throw new Error(`refusing to publish rejected creative ${creative.id} (${creative.brandCheck.violations.join("; ")})`);
  }
  if (isSimulatedChannel(creative.channel)) {
    return { externalId: sampleId(creative.channel, creative.id), simulated: true };
  }
  // Live path — a real channel SDK call would go here (Meta Marketing API, Google Ads, etc.).
  // Intentionally not wired: enabling real spend is a Todd-explicit step, like live Duffel orders.
  throw new Error(`live publishing to ${creative.channel} is not wired yet — keep MARKETING_LIVE=false`);
}
