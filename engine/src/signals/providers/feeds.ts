// Dedicated premium feeds — the slots for higher-fidelity, real-time sources Tures can plug in:
// a news API, the X/Twitter firehose, a traffic/incident API. Each is GUARDED: with no key it
// reports itself NOT configured and returns nothing. The web provider (Claude web search) already
// covers these categories intelligently for free; these become the upgrade path when a paid feed is
// wired, without changing anything downstream.
//
// IMPORTANT: until a real integration is added, an UNCONFIGURED feed returns []. We never fabricate
// a tweet, a headline, or a traffic incident — an empty result means "no dedicated feed," not "all
// clear." (When you wire one, replace the fetch body with the real call and keep the guard.)
import { pollXAlerts } from "../../watch/x.ts";
import { buildXQuery } from "../../watch/keywords.ts";
import { fetchNewsSignals } from "./newsapi.ts";
import type { Signal, SignalContext, SignalProvider } from "../types.ts";
import { config } from "../../config.ts";

/** News API (NewsAPI.org). Set NEWS_API_KEY to enable. */
export const newsFeed: SignalProvider = {
  name: "News feed",
  category: "news",
  configured: () => !!config.signals.newsApiKey,
  async fetch(ctx: SignalContext): Promise<Signal[]> {
    return fetchNewsSignals(ctx);
  },
};

/** X / Twitter — local real-time chatter (incidents, closures). Set X_BEARER_TOKEN to enable. */
export const xFeed: SignalProvider = {
  name: "X / Twitter",
  category: "news",
  configured: () => !!config.signals.xBearerToken,
  async fetch(ctx: SignalContext): Promise<Signal[]> {
    if (!config.signals.xBearerToken) return [];
    const query = await buildXQuery({
      destination: ctx.destination,
      origin: ctx.origin ?? "",
      departDate: ctx.departDate,
      returnDate: ctx.returnDate,
    } as import("../../types.ts").Brief);
    if (!query) return [];
    const { signals } = await pollXAlerts(ctx, query);
    return signals;
  },
};

/** Traffic / incident API — not wired yet; key is reserved for a future TomTom/HERE adapter. */
export const trafficFeed: SignalProvider = {
  name: "Traffic / incidents",
  category: "traffic",
  configured: () => false, // honest: TRAFFIC_API_KEY exists in config but no provider is live yet
  async fetch(_ctx: SignalContext): Promise<Signal[]> {
    return [];
  },
};
