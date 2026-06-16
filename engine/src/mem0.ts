// mem0 — managed memory layer for personalization (taste, learned preferences, trip-history notes).
// Keyed by user_id. Talks to the mem0 platform REST API directly (no SDK dependency). Fully
// guarded: a no-op that returns identically when MEM0_API_KEY is unset, so the engine runs the
// same with or without it.
import { config } from "./config.ts";
import { log } from "./logger.ts";

const BASE = "https://api.mem0.ai/v1";

export function mem0Enabled(): boolean {
  return !!config.mem0Key;
}

function headers(): Record<string, string> {
  return { Authorization: `Token ${config.mem0Key}`, "Content-Type": "application/json" };
}

/** Retrieve the memories most relevant to `query` for this traveler. Returns plain strings. */
export async function recall(userId: string | undefined, query: string, limit = 6): Promise<string[]> {
  if (!config.mem0Key || !userId || !query) return [];
  try {
    const r = await fetch(`${BASE}/memories/search/`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ query, user_id: userId, limit }),
    });
    if (!r.ok) {
      log.warn("mem0 search failed", { status: r.status });
      return [];
    }
    const data: any = await r.json();
    const items: any[] = Array.isArray(data) ? data : (data.results ?? data.memories ?? []);
    return items
      .map((m) => (m && (m.memory ?? m.text ?? m.data)))
      .filter((s): s is string => typeof s === "string" && s.length > 0);
  } catch (e) {
    log.warn("mem0 search error", { err: String(e) });
    return [];
  }
}

/** Store a conversation turn so mem0 can extract durable memories. Fire-and-forget — don't block. */
export async function remember(
  userId: string | undefined,
  messages: { role: string; content: string }[],
): Promise<void> {
  if (!config.mem0Key || !userId || !messages?.length) return;
  try {
    await fetch(`${BASE}/memories/`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ messages, user_id: userId }),
    });
  } catch (e) {
    log.warn("mem0 add error", { err: String(e) });
  }
}
