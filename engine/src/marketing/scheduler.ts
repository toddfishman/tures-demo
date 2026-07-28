// Marketing loop scheduler — advances every running campaign one pass per tick. Mirrors the Trip
// Watch scheduler: off unless MARKETING_ENABLED, unref'd so it never holds the process open, and
// a short first tick after boot so dev sees the loop move without waiting a full interval.
import { config } from "../config.ts";
import { log } from "../logger.ts";
import { campaigns } from "./store.ts";
import { runCampaignLoop } from "./service.ts";

let timer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  const running = campaigns.running();
  for (const c of running) {
    await runCampaignLoop(c.id).catch((e) => log.warn("marketing loop tick failed", { campaignId: c.id, err: String(e) }));
  }
}

export function startMarketingScheduler(): void {
  if (!config.marketing.enabled) {
    log.info("marketing scheduler disabled (set MARKETING_ENABLED=true to enable)");
    return;
  }
  if (timer) return;
  const min = config.marketing.tickMin;
  timer = setInterval(() => void tick(), min * 60_000);
  if (typeof (timer as any).unref === "function") (timer as any).unref();
  log.info("marketing scheduler on", { everyMin: min, live: config.marketing.live });
  setTimeout(() => void tick(), 5000);
}

export function stopMarketingScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
