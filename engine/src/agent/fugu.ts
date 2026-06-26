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
  /** Raw assistant message — for diagnosing tool-call shape across providers (gated debug only). */
  raw?: any;
}

/** Pull the tool arguments out of an assistant message across the shape variants providers use:
 *  new-style `tool_calls[].function.arguments` (string or already-parsed object) and the legacy
 *  single `function_call.arguments`. Returns null when the tool wasn't called. */
function extractToolInput(msg: any, toolName: string): Record<string, any> | null {
  let args: unknown;
  const call = (msg?.tool_calls ?? []).find((c: any) => c?.function?.name === toolName || c?.name === toolName);
  if (call) args = call.function?.arguments ?? call.arguments;
  else if (msg?.function_call?.name === toolName) args = msg.function_call.arguments;
  if (args == null) return null;
  if (typeof args === "object") return args as Record<string, any>;
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return null;
    }
  }
  return null;
}

/** One non-streaming chat turn through Fugu with a single optional function tool.
 *  `forceTool` pins tool_choice to the function (used to recover a phantom hand-off — when the model
 *  said it was building the trip but didn't actually call the tool). */
export async function fuguChat(
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  tool: ChatTool,
  maxTokens = 320,
  forceTool = false,
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
      tool_choice: forceTool ? { type: "function", function: { name: tool.name } } : "auto",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`sakana ${res.status}: ${body.slice(0, 200)}`);
  }

  const json: any = await res.json();
  const msg = json?.choices?.[0]?.message ?? {};
  // Content can be a plain string or an array of content parts (some OpenAI-compatible providers).
  const text = typeof msg.content === "string"
    ? msg.content.trim()
    : Array.isArray(msg.content)
      ? msg.content.map((p: any) => (typeof p === "string" ? p : p?.text ?? "")).join(" ").trim()
      : "";

  return { text, toolInput: extractToolInput(msg, tool.name), raw: msg };
}
