import { config } from "../config.ts";
import { log } from "../logger.ts";
import type { HandoffRequest } from "./types.ts";

async function telegramChatId(accountId: string): Promise<string | null> {
  const { Collection } = await import("../db/persist.ts");
  const links = new Collection<{ id: string; accountId: string; channel: string; externalId: string }>("channel_links");
  const tg = links.values().find((l) => l.accountId === accountId && l.channel === "telegram");
  return tg?.externalId ?? null;
}

/** Best-effort notify when Tures needs a human — Telegram when linked. */
export async function notifyHandoff(accountId: string, handoff: HandoffRequest, publicUrl: string): Promise<void> {
  if (!config.telegram.enabled) return;
  const chatId = await telegramChatId(accountId);
  if (!chatId) return;
  const link = `${publicUrl.replace(/\/$/, "")}/handoff.html?id=${encodeURIComponent(handoff.token)}`;
  const text = `Tures needs you for a moment — ${handoff.title}\n\n${handoff.instructions}\n\n→ ${link}`;
  try {
    await fetch(`https://api.telegram.org/bot${config.telegram.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
    });
  } catch (e) {
    log.warn("handoff notify failed", { err: String((e as Error)?.message ?? e) });
  }
}
