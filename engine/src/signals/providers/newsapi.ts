// NewsAPI.org — headlines around a trip destination. Shared by Trip Watch scans and /signals feeds.
import { config } from "../../config.ts";
import type { Signal, SignalContext } from "../types.ts";

export async function fetchNewsSignals(ctx: SignalContext): Promise<Signal[]> {
  if (!config.signals.newsApiKey) return [];
  const q = encodeURIComponent(`${ctx.label} travel OR airport OR strike OR weather`);
  try {
    const res = await fetch(
      `https://newsapi.org/v2/everything?q=${q}&pageSize=5&sortBy=publishedAt&language=en&apiKey=${config.signals.newsApiKey}`,
      { signal: AbortSignal.timeout(12000) },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { articles?: Array<{ title?: string; description?: string; url?: string }> };
    return (body.articles ?? []).slice(0, 5).map((a, i) => ({
      id: `news:${ctx.label}:${i}:${String(a.title || i).slice(0, 30)}`,
      category: "news" as const,
      severity: /strike|cancel|storm|closure|delay/i.test(String(a.title)) ? "warning" : "watch",
      title: String(a.title || "News").slice(0, 100),
      detail: a.description ? String(a.description).slice(0, 200) : undefined,
      source: "newsapi",
      url: a.url,
      travelImpacting: /strike|cancel|storm|airport|flight/i.test(String(a.title ?? "") + String(a.description ?? "")),
    }));
  } catch {
    return [];
  }
}
