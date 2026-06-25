// Dedicated premium feeds — the slots for higher-fidelity, real-time sources Tures can plug in:
// a news API, the X/Twitter firehose, a traffic/incident API. Each is GUARDED: with no key it
// reports itself NOT configured and returns nothing. The web provider (Claude web search) already
// covers these categories intelligently for free; these become the upgrade path when a paid feed is
// wired, without changing anything downstream.
//
// IMPORTANT: until a real integration is added, an UNCONFIGURED feed returns []. We never fabricate
// a tweet, a headline, or a traffic incident — an empty result means "no dedicated feed," not "all
// clear." (When you wire one, replace the fetch body with the real call and keep the guard.)
import type { Signal, SignalContext, SignalProvider } from "../types.ts";
import { config } from "../../config.ts";

/** News API (e.g. NewsAPI / GDELT). Set NEWS_API_KEY to enable. */
export const newsFeed: SignalProvider = {
  name: "News feed",
  category: "news",
  configured: () => !!config.signals.newsApiKey,
  async fetch(_ctx: SignalContext): Promise<Signal[]> {
    if (!config.signals.newsApiKey) return [];
    // TODO: real NewsAPI/GDELT query around ctx.label for the trip window → map to Signals.
    return [];
  },
};

/** X / Twitter — local real-time chatter (incidents, closures, vibe). Set X_BEARER_TOKEN to enable. */
export const xFeed: SignalProvider = {
  name: "X / Twitter",
  category: "news",
  configured: () => !!config.signals.xBearerToken,
  async fetch(_ctx: SignalContext): Promise<Signal[]> {
    if (!config.signals.xBearerToken) return [];
    // TODO: real X recent-search (geo + keywords) → map to Signals. X has no free tier today, so
    // this stays guarded until a token is provided.
    return [];
  },
};

/** Traffic / incident API (e.g. TomTom, HERE). Set TRAFFIC_API_KEY to enable. */
export const trafficFeed: SignalProvider = {
  name: "Traffic / incidents",
  category: "traffic",
  configured: () => !!config.signals.trafficApiKey,
  async fetch(_ctx: SignalContext): Promise<Signal[]> {
    if (!config.signals.trafficApiKey) return [];
    // TODO: real traffic-incident query around ctx.lat/lng → map to Signals.
    return [];
  },
};
