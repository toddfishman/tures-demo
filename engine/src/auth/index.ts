// Real accounts: email + password (scrypt) and stateless session tokens (HS256 JWT). No external
// dependency — built on node:crypto. Users persist via the durable Collection. accountId === user
// id, so the existing per-account vault/booking namespacing ties straight in.
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { Collection } from "../db/persist.ts";
import { config } from "../config.ts";
import { log } from "../logger.ts";

export interface User {
  id: string; // also the accountId
  email: string;
  name: string;
  passwordHash: string; // salt:hash (hex)
  plan: "free" | "per_trip" | "subscribe";
  stripeCustomerId?: string;
  createdAt: string;
}

const users = new Collection<User>("users");
let counter = 0;

// AUTH_SECRET signs sessions. Without it we use an ephemeral key (sessions drop on restart) —
// fine for dev, but set AUTH_SECRET in prod so logins persist across deploys.
const SECRET = config.authSecret || randomBytes(32).toString("hex");
if (!config.authSecret) log.warn("no AUTH_SECRET — sessions are ephemeral (set it in prod)");

// ---- password hashing (scrypt) ----
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

// ---- minimal HS256 JWT ----
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}
export function signToken(userId: string, email: string, days = 30): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const exp = Math.floor((Date.parse(new Date().toISOString()) + days * 86400000) / 1000);
  const payload = b64url(JSON.stringify({ sub: userId, email, exp }));
  const sig = b64url(createHmac("sha256", SECRET).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}
export function verifyToken(token: string | undefined): { sub: string; email: string } | null {
  if (!token || token.split(".").length !== 3) return null;
  const [header, payload, sig] = token.split(".");
  const expected = b64url(createHmac("sha256", SECRET).update(`${header}.${payload}`).digest());
  const a = Buffer.from(sig!);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
    if (claims.exp && claims.exp * 1000 < Date.parse(new Date().toISOString())) return null;
    return { sub: claims.sub, email: claims.email };
  } catch {
    return null;
  }
}

// ---- user store ----
export function findByEmail(email: string): User | undefined {
  const e = email.toLowerCase();
  return users.values().find((u) => u.email === e);
}
export function getUser(id: string): User | undefined {
  return users.get(id);
}
export function findByStripeCustomer(customerId: string): User | undefined {
  return users.values().find((u) => u.stripeCustomerId === customerId);
}
export function createUser(email: string, name: string, password: string): User {
  const u: User = {
    id: `acct_${Date.now().toString(36)}_${counter++}`,
    email: email.toLowerCase(),
    name: name || "Traveler",
    passwordHash: hashPassword(password),
    plan: "free",
    createdAt: new Date().toISOString(),
  };
  users.set(u.id, u);
  log.info("auth: user created", { id: u.id, email: u.email });
  return u;
}
export function saveUser(u: User): User {
  return users.set(u.id, u);
}

/** What the API returns — never the password hash. */
export function publicUser(u: User) {
  return { id: u.id, email: u.email, name: u.name, plan: u.plan, createdAt: u.createdAt };
}

/** Resolve the acting account. The session token is the only authority: a signed-in
 *  request always acts as its own account, and an anonymous request always acts as
 *  "demo". A client-supplied accountId is never honored for a real account — account
 *  ids are guessable, so trusting it would let anyone read or mutate another
 *  account's connections, bookings, and profile. */
export function resolveAccountId(req: any, _explicit?: string): string {
  return req?.accountId || "demo";
}

/** Ownership guard for id-addressed records. A record is reachable only by the account that
 *  owns it (the session, or "demo" for anonymous). Returns true when the acting account may act
 *  on `ownerAccountId`. Use a 404 (not 403) on failure so record ids can't be enumerated. */
export function actsFor(req: any, ownerAccountId: string | undefined): boolean {
  if (!ownerAccountId) return false;
  return ownerAccountId === resolveAccountId(req);
}
