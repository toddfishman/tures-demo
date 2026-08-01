// Channel links — the cross-channel identity backbone. This is what lets the SAME Tures (same
// mem0 memory, same Vault, same brains) reach a traveler on any surface: web, voice, Telegram, SMS.
//
// The model: every channel resolves to ONE accountId. A small table maps (channel, externalId) →
// accountId. When a message arrives on a channel, we resolve the account, then run the existing
// /converse + /assist + /plan flows keyed by that accountId — so memory and trips follow the person,
// not the device.
//
// Linking uses a short-lived one-time CODE: the signed-in web app mints a code, the user opens the
// channel with it (e.g. a Telegram deep link `t.me/Bot?start=<code>`), and the channel adapter
// consumes the code to bind that channel id to the account. Codes live in memory and expire fast.
import { randomBytes } from "node:crypto";
import { Collection } from "../db/persist.ts";
import { log } from "../logger.ts";

export type ChannelKind = "telegram" | "sms" | "whatsapp";

export interface ChannelLink {
  id: string; // `${channel}:${externalId}` — O(1) resolve
  accountId: string;
  channel: ChannelKind;
  externalId: string; // the channel's user/chat id (e.g. Telegram chat id)
  linkedAt: string;
}

const links = new Collection<ChannelLink>("channel_links");

// One-time link codes (short-lived, in-memory — they're consumed within minutes).
const CODE_TTL_MS = 15 * 60 * 1000;
const codes = new Map<string, { accountId: string; exp: number }>();

function keyOf(channel: ChannelKind, externalId: string) {
  return `${channel}:${externalId}`;
}

/** Mint a one-time code the user carries to the channel to prove which account is theirs. */
export function createLinkCode(accountId: string): { code: string; expiresInSec: number } {
  const code = randomBytes(5).toString("hex"); // 10 hex chars — short enough for a deep link
  codes.set(code, { accountId, exp: Date.now() + CODE_TTL_MS });
  return { code, expiresInSec: CODE_TTL_MS / 1000 };
}

/** Bind a channel id to an account, replacing any prior binding for that channel id. */
export function linkChannel(accountId: string, channel: ChannelKind, externalId: string): ChannelLink {
  const link: ChannelLink = { id: keyOf(channel, externalId), accountId, channel, externalId, linkedAt: new Date().toISOString() };
  links.set(link.id, link);
  log.info("channels: linked", { channel, accountId });
  return link;
}

/** Consume a link code to bind a channel id to the code's account. Returns the accountId or null. */
export function consumeLinkCode(code: string, channel: ChannelKind, externalId: string): string | null {
  const e = codes.get(code);
  if (!e || e.exp < Date.now()) {
    codes.delete(code);
    return null;
  }
  codes.delete(code);
  linkChannel(e.accountId, channel, externalId);
  return e.accountId;
}

/** Which account owns this channel id? The first thing an inbound channel message resolves. */
export function resolveAccount(channel: ChannelKind, externalId: string): string | null {
  return links.get(keyOf(channel, externalId))?.accountId ?? null;
}

/** The channels an account has linked (for the app's "connected" UI). */
export function linksForAccount(accountId: string): Array<{ channel: ChannelKind; linkedAt: string }> {
  return links.values()
    .filter((l) => l.accountId === accountId)
    .map((l) => ({ channel: l.channel, linkedAt: l.linkedAt }));
}

/** Unlink a channel from an account (all bindings of that channel for the account). */
export function unlinkChannel(accountId: string, channel: ChannelKind): boolean {
  const mine = links.values().filter((l) => l.accountId === accountId && l.channel === channel);
  mine.forEach((l) => links.delete(l.id));
  return mine.length > 0;
}
