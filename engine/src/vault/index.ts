// The vault — connect, list, revoke, and grant checks for connected services. Secrets are
// encrypted at rest (crypto.ts) and only decrypted by trusted internal callers (the payment
// provider). In-memory store; swaps to Prisma at Chunk 6 behind this same API.
import { encrypt, decrypt } from "./crypto.ts";
import { DEFAULT_SCOPES, redact } from "./types.ts";
import type { Connection, ConnectionKind, RedactedConnection } from "./types.ts";
import { log } from "../logger.ts";

const byId = new Map<string, Connection>();
let counter = 0;

export interface ConnectInput {
  accountId?: string;
  kind: ConnectionKind;
  label: string;
  scopes?: string[];
  /** The credential to encrypt (Stripe customer+payment_method, OAuth token, etc.). */
  secret: Record<string, unknown>;
  /** Non-secret display metadata. */
  meta?: Record<string, unknown>;
}

export function connect(input: ConnectInput): RedactedConnection {
  const accountId = input.accountId ?? "demo";
  const conn: Connection = {
    id: `conn_${Date.now().toString(36)}_${counter++}`,
    accountId,
    kind: input.kind,
    label: input.label,
    scopes: input.scopes ?? DEFAULT_SCOPES[input.kind],
    status: "connected",
    meta: input.meta ?? {},
    secretCipher: encrypt(JSON.stringify(input.secret)),
    createdAt: new Date().toISOString(),
  };
  byId.set(conn.id, conn);
  log.info("vault: connected service", { accountId, kind: conn.kind, scopes: conn.scopes });
  return redact(conn);
}

export function list(accountId = "demo"): RedactedConnection[] {
  return [...byId.values()].filter((c) => c.accountId === accountId).map(redact);
}

export function revoke(id: string): RedactedConnection | null {
  const conn = byId.get(id);
  if (!conn) return null;
  conn.status = "revoked";
  conn.revokedAt = new Date().toISOString();
  log.info("vault: revoked", { id, kind: conn.kind });
  return redact(conn);
}

/** Active connection of a kind for an account, or undefined. Revocation is immediate. */
export function activeConnection(accountId: string, kind: ConnectionKind): Connection | undefined {
  return [...byId.values()].find(
    (c) => c.accountId === accountId && c.kind === kind && c.status === "connected",
  );
}

/** Does the account hold a live grant for this scope? The authorization check the engine uses. */
export function hasScope(accountId: string, scope: string): boolean {
  return [...byId.values()].some(
    (c) => c.accountId === accountId && c.status === "connected" && c.scopes.includes(scope),
  );
}

/** Decrypt a connection's credential. INTERNAL — only the payment provider should call this. */
export function reveal(conn: Connection): Record<string, unknown> {
  return JSON.parse(decrypt(conn.secretCipher));
}
