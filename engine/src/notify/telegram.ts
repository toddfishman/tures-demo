// Outbound Telegram — shared send helper for handoffs and proactive trip alerts.
import { config } from "../config.ts";
import { log } from "../logger.ts";
import { Collection } from "../db/persist.ts";

async function telegramChatId(accountId: string): Promise<string | null> {
  const links = new Collection<{ id: string; accountId: string; channel: string; externalId: string }>("channel_links");
  const tg = links.values().find((l) => l.accountId === accountId && l.channel === "telegram");
  return tg?.externalId ?? null;
}

/** Best-effort Telegram message when the account has linked Telegram. */
export async function sendTelegramToAccount(accountId: string, text: string): Promise<boolean> {
  if (!config.telegram.enabled || !config.telegram.token) return false;
  if (!accountId || accountId === "demo") return false;
  const chatId = await telegramChatId(accountId);
  if (!chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegram.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
    });
    if (!res.ok) {
      log.warn("telegram send failed", { status: res.status, accountId: accountId.slice(0, 12) });
      return false;
    }
    return true;
  } catch (e) {
    log.warn("telegram send error", { err: String((e as Error)?.message ?? e) });
    return false;
  }
}
