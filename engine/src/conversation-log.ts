// Verbatim conversation audit — append-only transcript log for ops tracing. Unlike mem0 (async,
// may summarize when infer=true), this stores exact turns immediately when DATA_DIR is set.
import { Collection } from "./db/persist.ts";

export interface TranscriptTurn {
  id: string;
  ts: string;
  userId: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  via?: "fugu" | "anthropic";
  ready?: boolean;
}

const turns = new Collection<TranscriptTurn>("conversation_turns");
let turnCounter = 0;

/** Append one verbatim turn. Fire-and-forget safe — never throws to callers. */
export function logTurn(input: {
  userId: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  via?: "fugu" | "anthropic";
  ready?: boolean;
}): TranscriptTurn | null {
  const content = (input.content || "").trim();
  if (!content || !input.userId || !input.sessionId) return null;
  const row: TranscriptTurn = {
    id: `turn_${Date.now().toString(36)}_${turnCounter++}`,
    ts: new Date().toISOString(),
    userId: input.userId,
    sessionId: input.sessionId,
    role: input.role,
    content,
    via: input.via,
    ready: input.ready,
  };
  turns.set(row.id, row);
  return row;
}

/** List transcript turns for a session, oldest first. */
export function listSessionTranscript(sessionId: string, limit = 200): TranscriptTurn[] {
  return turns
    .values()
    .filter((t) => t.sessionId === sessionId)
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .slice(-limit);
}

/** Recent sessions for a user (newest session first). */
export function listUserSessions(userId: string, limit = 20): { sessionId: string; lastTs: string; turns: number }[] {
  const bySession = new Map<string, { lastTs: string; turns: number }>();
  for (const t of turns.values()) {
    if (t.userId !== userId) continue;
    const cur = bySession.get(t.sessionId);
    if (!cur) bySession.set(t.sessionId, { lastTs: t.ts, turns: 1 });
    else {
      cur.turns += 1;
      if (t.ts > cur.lastTs) cur.lastTs = t.ts;
    }
  }
  return [...bySession.entries()]
    .map(([sessionId, v]) => ({ sessionId, ...v }))
    .sort((a, b) => b.lastTs.localeCompare(a.lastTs))
    .slice(0, limit);
}
