// Adaptive Trip Watch scheduler — replaces naive deep polling when TRIP_WATCH_ENABLED.
import { config } from "../config.ts";
import { log } from "../logger.ts";
import { processWatchTick } from "./service.ts";

let timer: ReturnType<typeof setInterval> | null = null;

export function startTripWatchScheduler(): void {
  if (!config.watch.enabled) {
    log.info("trip watch scheduler disabled (set TRIP_WATCH_ENABLED=true to enable)");
    return;
  }
  if (timer) return;
  const min = config.watch.tickMin;
  timer = setInterval(() => void processWatchTick(), min * 60_000);
  if (typeof (timer as any).unref === "function") (timer as any).unref();
  log.info("trip watch scheduler on", { everyMin: min, marginPercent: config.watch.marginPercent });
  // First tick shortly after boot so dev doesn't wait a full interval.
  setTimeout(() => void processWatchTick(), 5000);
}

export function stopTripWatchScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
