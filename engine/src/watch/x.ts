// X recent-search alert poll — guarded, metered per tweet read.
import { config } from "../config.ts";
import { log } from "../logger.ts";
import type { Signal, SignalContext } from "../signals/types.ts";

interface XSearchResult {
  tweets: Array<{ id: string; text: string }>;
  sinceId?: string;
}

export function xConfigured(): boolean {
  return !!config.signals.xBearerToken;
}

/** Poll X for disruption chatter matching the trip's query. Returns [] when unkeyed or on error. */
export async function pollXAlerts(ctx: SignalContext, query: string, sinceId?: string): Promise<{ signals: Signal[]; reads: number; sinceId?: string }> {
  if (!config.signals.xBearerToken || !query) return { signals: [], reads: 0, sinceId };

  const params = new URLSearchParams({
    query,
    max_results: "10",
    "tweet.fields": "created_at,lang",
  });
  if (sinceId) params.set("since_id", sinceId);

  try {
    const res = await fetch(`https://api.x.com/2/tweets/search/recent?${params}`, {
      headers: { Authorization: `Bearer ${config.signals.xBearerToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      log.warn("x alert poll failed", { status: res.status });
      return { signals: [], reads: 0, sinceId };
    }
    const body = (await res.json()) as { data?: Array<{ id: string; text: string }>; meta?: { newest_id?: string } };
    const tweets = body.data ?? [];
    const newest = body.meta?.newest_id;
    const signals: Signal[] = tweets.slice(0, 8).map((t) => ({
      id: `x:${t.id}`,
      category: "news",
      severity: /cancel|strike|closed|emergency|severe/i.test(t.text) ? "warning" : "watch",
      title: t.text.slice(0, 80).replace(/\s+/g, " ").trim(),
      detail: t.text.length > 80 ? t.text.slice(0, 240) : undefined,
      source: "x",
      url: `https://x.com/i/web/status/${t.id}`,
      travelImpacting: /flight|airport|train|metro|cancel|strike|storm|closure/i.test(t.text),
    }));
    return { signals, reads: tweets.length, sinceId: newest || sinceId };
  } catch (e) {
    log.warn("x alert poll error", { err: String(e) });
    return { signals: [], reads: 0, sinceId };
  }
}
