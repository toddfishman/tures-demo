// Conversation history compaction — keeps /converse within token budget without losing
// the recent turn structure. The agent still gets mem0 + context for long-term memory;
// this layer is strictly *session* distillation.

export type ChatTurn = { role: "user" | "assistant"; content: string };

const MAX_TURNS = 12;
const MAX_CHARS_PER_MSG = 900;
const MAX_TOTAL_CHARS = 6500;

/** Trim old turns, cap per-message length, and drop from the front if still too large. */
export function compactConversation(msgs: ChatTurn[]): ChatTurn[] {
  let out = msgs
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_TURNS)
    .map((m) => ({
      role: m.role,
      content: m.content.length > MAX_CHARS_PER_MSG ? m.content.slice(0, MAX_CHARS_PER_MSG) + "…" : m.content,
    }));

  while (out.length > 2) {
    const total = out.reduce((s, m) => s + m.content.length, 0);
    if (total <= MAX_TOTAL_CHARS) break;
    out.shift();
  }
  return out;
}

/** Build a mem0 search query from recent user turns — a single short correction often misses
 *  the destination/context that earlier messages established. */
export function recallQueryFromMessages(msgs: ChatTurn[], fallback = ""): string {
  const users = msgs.filter((m) => m.role === "user").slice(-3).map((m) => m.content.trim()).filter(Boolean);
  if (!users.length) return fallback;
  return users.join(" · ");
}

/** Cap optional context prose injected into the system prompt. */
export function capContext(prose?: string, max = 1400): string | undefined {
  if (!prose) return undefined;
  const t = prose.trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max) + "…" : t;
}
