// mem0 — managed memory layer. Two modes:
//   • Transcript (infer=false) — verbatim user/assistant turns for tracing and exact recall
//   • Facts (infer=true)      — extracted taste/preferences from durable events (bookings, etc.)
// Keyed by user_id + run_id (session). Guarded when MEM0_API_KEY is unset.
import { config } from "./config.ts";
import { log } from "./logger.ts";

const BASE = "https://api.mem0.ai/v1";
const BASE_V3 = "https://api.mem0.ai/v3";

export function mem0Enabled(): boolean {
  return !!config.mem0Key;
}

function headers(): Record<string, string> {
  return { Authorization: `Token ${config.mem0Key}`, "Content-Type": "application/json" };
}

type MemMessage = { role: string; content: string };

async function mem0AddV3(body: Record<string, unknown>): Promise<boolean> {
  try {
    const r = await fetch(`${BASE_V3}/memories/add/`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      log.warn("mem0 v3 add failed", { status: r.status });
      return false;
    }
    return true;
  } catch (e) {
    log.warn("mem0 v3 add error", { err: String(e) });
    return false;
  }
}

/** Store exact conversation turns — no LLM summarization. Scoped by run_id = sessionId. */
export async function rememberTranscript(
  userId: string | undefined,
  sessionId: string | undefined,
  messages: MemMessage[],
  meta: Record<string, unknown> = {},
): Promise<void> {
  if (!config.mem0Key || !userId || !sessionId || !messages?.length) return;
  const ok = await mem0AddV3({
    messages,
    user_id: userId,
    run_id: sessionId,
    infer: false,
    metadata: { kind: "transcript", app: "tures-engine", ...meta },
  });
  if (!ok) {
    // Fallback to v1 with infer=false for older workspaces.
    try {
      await fetch(`${BASE}/memories/`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          messages,
          user_id: userId,
          run_id: sessionId,
          infer: false,
          metadata: { kind: "transcript", app: "tures-engine", ...meta },
        }),
      });
    } catch (e) {
      log.warn("mem0 transcript fallback error", { err: String(e) });
    }
  }
}

/** Extract durable facts (taste, preferences) — default mem0 inference pipeline. */
export async function rememberFacts(
  userId: string | undefined,
  messages: MemMessage[],
  metadata: Record<string, unknown> = {},
): Promise<void> {
  if (!config.mem0Key || !userId || !messages?.length) return;
  const ok = await mem0AddV3({
    messages,
    user_id: userId,
    infer: true,
    metadata: { kind: "fact", app: "tures-engine", ...metadata },
  });
  if (!ok) {
    try {
      await fetch(`${BASE}/memories/`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ messages, user_id: userId, metadata: { kind: "fact", ...metadata } }),
      });
    } catch (e) {
      log.warn("mem0 facts fallback error", { err: String(e) });
    }
  }
}

/** @deprecated Use rememberTranscript or rememberFacts. Defaults to facts (infer=true). */
export async function remember(userId: string | undefined, messages: MemMessage[]): Promise<void> {
  return rememberFacts(userId, messages);
}

/** Retrieve memories most relevant to `query`. Prefers extracted facts; includes verbatim transcript hits. */
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

/** List verbatim transcript memories for a session (when mem0 returns them). */
export async function listTranscriptMemories(userId: string, sessionId: string, limit = 100): Promise<string[]> {
  if (!config.mem0Key || !userId || !sessionId) return [];
  try {
    const url = `${BASE}/memories/?user_id=${encodeURIComponent(userId)}&run_id=${encodeURIComponent(sessionId)}&limit=${limit}`;
    const r = await fetch(url, { headers: headers() });
    if (!r.ok) {
      log.warn("mem0 list transcript failed", { status: r.status });
      return [];
    }
    const data: any = await r.json();
    const items: any[] = Array.isArray(data) ? data : (data.results ?? data.memories ?? []);
    return items
      .map((m) => (m && (m.memory ?? m.text ?? m.data ?? m.content)))
      .filter((s): s is string => typeof s === "string" && s.length > 0);
  } catch (e) {
    log.warn("mem0 list transcript error", { err: String(e) });
    return [];
  }
}

/** List stored memories for a user (for guest → account merge). Facts only. */
export async function listMemories(userId: string, limit = 50): Promise<string[]> {
  if (!config.mem0Key || !userId) return [];
  try {
    const r = await fetch(`${BASE}/memories/?user_id=${encodeURIComponent(userId)}&limit=${limit}`, {
      headers: headers(),
    });
    if (!r.ok) {
      log.warn("mem0 list failed", { status: r.status });
      return [];
    }
    const data: any = await r.json();
    const items: any[] = Array.isArray(data) ? data : (data.results ?? data.memories ?? []);
    return items
      .map((m) => (m && (m.memory ?? m.text ?? m.data)))
      .filter((s): s is string => typeof s === "string" && s.length > 0);
  } catch (e) {
    log.warn("mem0 list error", { err: String(e) });
    return [];
  }
}

/** Copy guest memories into a signed-in account id. Returns count merged. */
export async function mergeMem0(fromUserId: string, toUserId: string): Promise<number> {
  if (!config.mem0Key || !fromUserId || !toUserId || fromUserId === toUserId) return 0;
  const memories = await listMemories(fromUserId);
  if (!memories.length) return 0;
  await rememberFacts(toUserId, [
    {
      role: "user",
      content: "Travel preferences and trip notes from before I signed in: " + memories.join(" · "),
    },
  ]);
  return memories.length;
}
