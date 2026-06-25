// The provider registry. FAST providers are cheap/keyless and safe to run synchronously on an
// on-demand /signals call; DEEP providers (the Claude web scout) cost a model call + latency and
// run in the background watcher or when a caller explicitly asks to go deep.
import type { SignalProvider } from "./types.ts";
import { weatherProvider } from "./providers/weather.ts";
import { airQualityProvider } from "./providers/airquality.ts";
import { webProvider } from "./providers/web.ts";
import { newsFeed, xFeed, trafficFeed } from "./providers/feeds.ts";

export const FAST_PROVIDERS: SignalProvider[] = [weatherProvider, airQualityProvider, newsFeed, xFeed, trafficFeed];
export const DEEP_PROVIDERS: SignalProvider[] = [webProvider];
export const ALL_PROVIDERS: SignalProvider[] = [...FAST_PROVIDERS, ...DEEP_PROVIDERS];

/** What's wired and whether each can run right now — the honest status surface (health + /signals). */
export function providerStatus() {
  return ALL_PROVIDERS.map((p) => ({ name: p.name, category: p.category, configured: p.configured() }));
}
