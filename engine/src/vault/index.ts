// The vault — connect, list, revoke, and grant checks for connected services. Secrets are
// encrypted at rest (crypto.ts) and only decrypted by trusted internal callers (the payment
// provider). In-memory store; swaps to Prisma at Chunk 6 behind this same API.
import { secretStore } from "./secretstore.ts";
import { DEFAULT_SCOPES, redact } from "./types.ts";
import type { Connection, ConnectionKind, RedactedConnection } from "./types.ts";
import { Collection } from "../db/persist.ts";
import { log } from "../logger.ts";

// Durable when DATA_DIR is set. Only ciphertext (secretCipher) is persisted — never plaintext PII.
const byId = new Collection<Connection>("connections");
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

export async function connect(input: ConnectInput): Promise<RedactedConnection> {
  const accountId = input.accountId ?? "demo";
  // Tokenize/encrypt the secret through the configured store (VGS or local AES) before it lands
  // in our storage — only the token/ciphertext is ever persisted.
  const secretCipher = await secretStore().store(JSON.stringify(input.secret));
  const conn: Connection = {
    id: `conn_${Date.now().toString(36)}_${counter++}`,
    accountId,
    kind: input.kind,
    label: input.label,
    scopes: input.scopes ?? DEFAULT_SCOPES[input.kind],
    status: "connected",
    meta: input.meta ?? {},
    secretCipher,
    createdAt: new Date().toISOString(),
  };
  byId.set(conn.id, conn);
  log.info("vault: connected service", { accountId, kind: conn.kind, scopes: conn.scopes, store: secretStore().mode });
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
  byId.set(conn.id, conn); // persist the revocation
  log.info("vault: revoked", { id, kind: conn.kind });
  return redact(conn);
}

/** Active connection of a kind for an account, or undefined. Revocation is immediate. */
export function activeConnection(accountId: string, kind: ConnectionKind): Connection | undefined {
  return [...byId.values()].find(
    (c) => c.accountId === accountId && c.kind === kind && c.status === "connected",
  );
}

/** All active connections of a kind for an account (e.g. every card in the wallet). */
export function connectionsByKind(accountId: string, kind: ConnectionKind): Connection[] {
  return [...byId.values()].filter(
    (c) => c.accountId === accountId && c.kind === kind && c.status === "connected",
  );
}

/** Look up a single connection by id (internal — used to charge a specific chosen card). */
export function connectionById(id: string): Connection | undefined {
  return byId.get(id);
}

/** Does the account hold a live grant for this scope? The authorization check the engine uses. */
export function hasScope(accountId: string, scope: string): boolean {
  return [...byId.values()].some(
    (c) => c.accountId === accountId && c.status === "connected" && c.scopes.includes(scope),
  );
}

/** Resolve a connection's credential (detokenize/decrypt). INTERNAL — booking/payment use only. */
export async function reveal(conn: Connection): Promise<Record<string, unknown>> {
  return JSON.parse(await secretStore().reveal(conn.secretCipher));
}
