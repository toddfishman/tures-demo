// /channels — the signed-in app links/unlinks other surfaces (Telegram, etc.) to the account.
// Linking another channel is what makes Tures' memory follow you across devices.
import type { FastifyInstance } from "fastify";
import { config } from "../config.ts";
import { resolveAccountId } from "../auth/index.ts";
import { createLinkCode, linksForAccount, unlinkChannel, type ChannelKind } from "../channels/index.ts";

export async function channelRoutes(app: FastifyInstance) {
  // POST /channels/link-code — mint a one-time code for THIS signed-in account. For Telegram we also
  // hand back the ready-to-open deep link (when the bot is configured). Must be a real account.
  app.post("/channels/link-code", async (req, reply) => {
    const accountId = resolveAccountId(req);
    if (accountId === "demo") return reply.status(401).send({ error: "sign_in_required" });
    const { code, expiresInSec } = createLinkCode(accountId);
    const telegramDeepLink = config.telegram.username ? `https://t.me/${config.telegram.username}?start=${code}` : null;
    return { code, expiresInSec, telegramEnabled: config.telegram.enabled, telegramDeepLink };
  });

  // GET /channels — the account's linked channels (for the "connected" UI).
  app.get("/channels", async (req) => ({ channels: linksForAccount(resolveAccountId(req)) }));

  // POST /channels/:channel/unlink — drop a channel binding.
  app.post<{ Params: { channel: string } }>("/channels/:channel/unlink", async (req, reply) => {
    const accountId = resolveAccountId(req);
    if (accountId === "demo") return reply.status(401).send({ error: "sign_in_required" });
    const ok = unlinkChannel(accountId, req.params.channel as ChannelKind);
    return { ok };
  });
}
