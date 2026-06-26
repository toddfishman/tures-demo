// Telegram channel adapter — a thin front door onto the brains Tures already has. An inbound
// message resolves to an account (via the channel link), then runs the SAME /converse → /parse →
// /plan flow keyed by that accountId, so the Telegram Tures is the web Tures: same mem0 memory,
// same Vault, same trips. Replies go back through Telegram's sendMessage.
//
// Guarded: with no TELEGRAM_BOT_TOKEN the webhook 404s. When set, it verifies the secret header so
// only Telegram can post to it. Internal calls are account-scoped with a minted session token
// (the adapter is trusted server-side) — never by trusting a client-supplied account id.
//
// Activation (Todd): create a bot with @BotFather → set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME,
// TELEGRAM_WEBHOOK_SECRET on Render → register the webhook once:
//   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://tures-engine.onrender.com/telegram/webhook&secret_token=<SECRET>"
import type { FastifyInstance } from "fastify";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import { signToken, getUser } from "../auth/index.ts";
import { consumeLinkCode, resolveAccount, unlinkChannel } from "../channels/index.ts";

// Short conversation history per chat (immediate turn context). Long-term memory is mem0, keyed by
// accountId, so it's shared with every other channel — this is just the running thread.
const histories = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();
function history(chatId: string) {
  let h = histories.get(chatId);
  if (!h) { h = []; histories.set(chatId, h); }
  return h;
}

/** Point Telegram at THIS engine's webhook. Idempotent; called on boot so setting the token in
 *  Render is all it takes (no manual setWebhook curl). Uses Render's RENDER_EXTERNAL_URL by default. */
export async function registerTelegramWebhook(): Promise<void> {
  if (!config.telegram.enabled) return;
  const base = (process.env.TELEGRAM_WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
  if (!base) {
    log.warn("telegram: no base URL (set RENDER_EXTERNAL_URL or TELEGRAM_WEBHOOK_URL) — webhook not auto-registered");
    return;
  }
  const url = `${base}/telegram/webhook`;
  try {
    const r = await fetch(`https://api.telegram.org/bot${config.telegram.token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, secret_token: config.telegram.webhookSecret || undefined, allowed_updates: ["message", "edited_message"] }),
    });
    const j: any = await r.json();
    if (j.ok) log.info("telegram: webhook registered", { url });
    else log.warn("telegram: setWebhook failed", { description: j.description });
  } catch (e) {
    log.warn("telegram: setWebhook error", { err: String(e) });
  }
}

async function send(chatId: string, text: string) {
  if (!config.telegram.token) return;
  try {
    await fetch(`https://api.telegram.org/bot${config.telegram.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (e) {
    log.warn("telegram send failed", { err: String(e) });
  }
}

function planSummary(plan: any): string {
  if (!plan) return "";
  const total = plan.totalUsd != null ? ` — about $${Number(plan.totalUsd).toLocaleString()} all in` : "";
  const why = plan.rationale ? `\n${plan.rationale}` : "";
  return `Here's the shape${total}.${why}\n\nOpen the Tures app to confirm and book — nothing is held or charged yet.`;
}

export async function telegramRoutes(app: FastifyInstance) {
  // GET /telegram/status — diagnostic: is the token valid, and is the webhook pointed at us?
  // Uses the server-side token; returns NO secret (bot username + webhook url are public).
  app.get("/telegram/status", async () => {
    if (!config.telegram.enabled) return { enabled: false };
    const out: any = { enabled: true, configuredUsername: config.telegram.username };
    try {
      const me: any = await (await fetch(`https://api.telegram.org/bot${config.telegram.token}/getMe`)).json();
      out.tokenValid = !!me.ok;
      if (me.ok) out.bot = { username: me.result.username, id: me.result.id, name: me.result.first_name };
      const wh: any = await (await fetch(`https://api.telegram.org/bot${config.telegram.token}/getWebhookInfo`)).json();
      if (wh.ok) {
        out.webhook = { url: wh.result.url || null, pending: wh.result.pending_update_count, lastError: wh.result.last_error_message || null };
        out.pointsToUs = typeof wh.result.url === "string" && wh.result.url.includes("/telegram/webhook");
      }
    } catch (e) {
      out.error = String((e as any)?.message ?? e);
    }
    return out;
  });

  app.post("/telegram/webhook", async (req, reply) => {
    if (!config.telegram.enabled) return reply.status(404).send({ error: "telegram_not_configured" });
    // Only Telegram (which knows the secret) may post here.
    if (config.telegram.webhookSecret) {
      const got = req.headers["x-telegram-bot-api-secret-token"];
      if (got !== config.telegram.webhookSecret) return reply.status(401).send({ error: "bad_secret" });
    }

    const update: any = req.body || {};
    const msg = update.message || update.edited_message;
    const chatId = msg?.chat?.id != null ? String(msg.chat.id) : "";
    const text = typeof msg?.text === "string" ? msg.text.trim() : "";
    // Always 200 to Telegram (errors here shouldn't make it retry forever); act async-safely below.
    if (!chatId || !text) return { ok: true };

    try {
      // ── /start [code] — link this chat to an account ──
      if (text.startsWith("/start")) {
        const code = text.split(/\s+/)[1];
        if (code) {
          const acct = consumeLinkCode(code, "telegram", chatId);
          await send(chatId, acct
            ? "You're linked. I'm Tures — the very same concierge you use on the web, memory and all. Tell me a trip, or ask me anything."
            : "That link expired. Open Set up Tures in the app and tap Connect Telegram for a fresh link.");
          return { ok: true };
        }
        const known = resolveAccount("telegram", chatId);
        await send(chatId, known
          ? "Welcome back. What can I do?"
          : "Hi — I'm Tures. To link this chat to your account, open Set up Tures in the app and tap Connect Telegram.");
        return { ok: true };
      }
      if (text === "/unlink") {
        const acct = resolveAccount("telegram", chatId);
        if (acct) unlinkChannel(acct, "telegram");
        await send(chatId, "Unlinked. This chat is no longer connected to your Tures account.");
        return { ok: true };
      }

      // ── normal message — must be linked ──
      const accountId = resolveAccount("telegram", chatId);
      if (!accountId) {
        await send(chatId, "This chat isn't linked yet. Open Set up Tures → Connect Telegram in the app to link it, then I'll pick up right where you left off.");
        return { ok: true };
      }

      // Account-scoped internal calls (trusted server-side token), keyed by accountId for shared memory.
      const user = getUser(accountId);
      const headers = { authorization: "Bearer " + signToken(accountId, user?.email ?? "") };
      const hist = history(chatId);

      const cr = await app.inject({ method: "POST", url: "/converse", headers, payload: { messages: hist.slice(-12), text, userId: accountId } });
      const data: any = cr.json();
      let reply = (data && data.reply) || "I'm here — tell me a trip or ask me anything.";
      hist.push({ role: "user", content: text });
      hist.push({ role: "assistant", content: reply });

      // Brief is ready → plan it and summarize (booking continues in the app for now).
      if (data && data.ready && data.brief) {
        try {
          const pr: any = (await app.inject({ method: "POST", url: "/parse", headers, payload: { text: data.brief } })).json();
          if (pr && pr.brief) {
            const plan: any = (await app.inject({ method: "POST", url: "/plan", headers, payload: { ...pr.brief, userId: accountId } })).json();
            reply += "\n\n" + planSummary(plan);
            hist.push({ role: "assistant", content: planSummary(plan) });
          }
        } catch (e) {
          log.warn("telegram plan step failed", { err: String(e) });
        }
      }

      await send(chatId, reply);
      return { ok: true };
    } catch (e) {
      log.error("telegram webhook failed", { err: String((e as any)?.message ?? e) });
      try { await send(chatId, "Something hiccuped on my end — try that once more in a moment."); } catch (_) {}
      return { ok: true };
    }
  });
}
