// Sakana Fugu — experimental primary brain for Tures' conversational chats. Implemented against
// the OpenAI-compatible Chat Completions API (`POST {base}/chat/completions`, Bearer auth, function
// tool-calling), which is the de-facto standard most new LLM providers ship. If Sakana's real API
// differs, override SAKANA_API_URL / SAKANA_MODEL (and, if the auth header or tool shape differ,
// this file is the one place to adjust). Returns a normalized { text, toolInput } so /converse can
// treat Fugu and Anthropic identically.
//
// Never silently fakes a result: any non-OK response or parse failure throws, and the caller
// (/converse) falls back to Anthropic — so a Fugu hiccup degrades the brain, it never breaks chat.
import { config } from "../config.ts";

export interface ChatTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments (same object Anthropic uses as input_schema). */
  parameters: Record<string, unknown>;
}

export interface FuguResult {
  /** Assistant text (may be empty when the model only called the tool). */
  text: string;
  /** Parsed tool arguments when the model called `tool.name`, else null. */
  toolInput: Record<string, any> | null;
}

/** One non-streaming chat turn through Fugu with a single optional function tool. */
export async function fuguChat(
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  tool: ChatTool,
  maxTokens = 320,
): Promise<FuguResult> {
  const url = config.sakana.apiUrl.replace(/\/$/, "") + "/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.sakana.apiKey}`,
    },
    body: JSON.stringify({
      model: config.sakana.model,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, ...messages],
      tools: [{ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }],
      tool_choice: "auto",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`sakana ${res.status}: ${body.slice(0, 200)}`);
  }

  const json: any = await res.json();
  const msg = json?.choices?.[0]?.message ?? {};
  const text = typeof msg.content === "string" ? msg.content.trim() : "";

  let toolInput: Record<string, any> | null = null;
  const call = (msg.tool_calls ?? []).find((c: any) => c?.function?.name === tool.name);
  if (call) {
    try {
      toolInput = JSON.parse(call.function.arguments || "{}");
    } catch {
      toolInput = null; // malformed args → treat as "no clean brief yet"
    }
  }

  return { text, toolInput };
}
