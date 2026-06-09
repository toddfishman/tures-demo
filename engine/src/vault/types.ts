// Connected services & the permission gradient. These four kinds mirror the demo's connection
// toggles (04-connections.html): a payment method, travel-only inbox access, calendar, loyalty.
// Each grant is scoped, encrypted, and revocable — "permissions are a gradient, not a switch."

export type ConnectionKind = "payment" | "email" | "calendar" | "loyalty";

/** Default scopes granted when a service of each kind is connected. */
export const DEFAULT_SCOPES: Record<ConnectionKind, string[]> = {
  payment: ["payment:charge"],
  email: ["email:read:travel"], // travel senders only — never marketing/personal mail
  calendar: ["calendar:read", "calendar:write"],
  loyalty: ["loyalty:read"],
};

export interface Connection {
  id: string;
  accountId: string;
  kind: ConnectionKind;
  label: string; // human display, e.g. "AmEx ··1004"
  scopes: string[];
  status: "connected" | "revoked";
  /** Non-secret display metadata (card last4, email address, program name). Safe to return. */
  meta: Record<string, unknown>;
  /** Encrypted credential blob — NEVER serialized to clients. */
  secretCipher: string;
  createdAt: string;
  revokedAt?: string;
}

/** Connection minus the secret — what API responses return. */
export type RedactedConnection = Omit<Connection, "secretCipher">;

export function redact(c: Connection): RedactedConnection {
  const { secretCipher, ...rest } = c;
  return rest;
}
