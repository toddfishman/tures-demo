import { connectionsByKind, reveal } from "../vault/index.ts";
import type { Connection } from "../vault/types.ts";

export interface SiteCredentials {
  label: string;
  username: string;
  password: string;
  memberNumber?: string;
  connectionId: string;
}

/** Map a URL hostname to keywords we match against saved program labels / domains. */
function hostKeywords(url?: string): string[] {
  if (!url) return [];
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const base = host.split(".")[0] ?? host;
    return [host, base];
  } catch {
    return [];
  }
}

function secretStr(secret: Record<string, unknown>, key: string): string | undefined {
  const v = secret[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function scoreMatch(keywords: string[], conn: Connection, secret: Record<string, unknown>): number {
  const label = (conn.label + " " + String(secret.program ?? "") + " " + String(secret.domain ?? "")).toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (kw.length >= 3 && label.includes(kw)) score += 2;
    if (secret.domain && String(secret.domain).toLowerCase().includes(kw)) score += 3;
  }
  return score;
}

/** Load encrypted site login for this URL from the Vault — never logged or returned to clients. */
export async function credentialsForSite(accountId: string, targetUrl?: string): Promise<SiteCredentials | null> {
  const keywords = hostKeywords(targetUrl);
  if (!keywords.length) return null;

  const candidates = [
    ...connectionsByKind(accountId, "site_login"),
    ...connectionsByKind(accountId, "loyalty"),
  ];

  let best: { conn: Connection; secret: Record<string, unknown>; score: number } | null = null;

  for (const conn of candidates) {
    const secret = (await reveal(conn)) as Record<string, unknown>;
    const username = secretStr(secret, "username") ?? secretStr(secret, "email");
    const password = secretStr(secret, "password");
    if (!username || !password) continue;

    const score = scoreMatch(keywords, conn, secret);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { conn, secret, score };
  }

  if (!best) return null;

  return {
    label: best.conn.label,
    username: secretStr(best.secret, "username") ?? secretStr(best.secret, "email")!,
    password: secretStr(best.secret, "password")!,
    memberNumber: secretStr(best.secret, "number"),
    connectionId: best.conn.id,
  };
}

/** True when the account has any saved site login (for UI hints). */
export function hasSiteLogins(accountId: string): boolean {
  return connectionsByKind(accountId, "site_login").length > 0;
}
