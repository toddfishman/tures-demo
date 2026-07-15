import type { HandoffRequest } from "./types.ts";
import { sendTelegramToAccount } from "../notify/telegram.ts";

/** Best-effort notify when Tures needs a human — Telegram when linked. */
export async function notifyHandoff(accountId: string, handoff: HandoffRequest, publicUrl: string): Promise<void> {
  const link = `${publicUrl.replace(/\/$/, "")}/handoff.html?id=${encodeURIComponent(handoff.token)}`;
  const text = `Tures needs you for a moment — ${handoff.title}\n\n${handoff.instructions}\n\n→ ${link}`;
  await sendTelegramToAccount(accountId, text);
}
