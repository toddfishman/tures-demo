import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createUser, findByEmail, verifyPassword, signToken, getUser, publicUser } from "../auth/index.ts";

const Signup = z.object({ email: z.string().email(), name: z.string().optional(), password: z.string().min(8) });
const Login = z.object({ email: z.string().email(), password: z.string() });

// ── Brute-force / abuse throttle ─────────────────────────────────────────────────────────────
// The global per-IP rate limit (600/min) is far too loose to slow credential stuffing or signup
// spam. This adds a tight sliding window keyed by IP+identifier: too many recent attempts → 429.
// In-memory (per instance) — good enough for the demo; a shared store is the multi-instance upgrade.
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 12; // generous enough for real users; well below a brute-force rate
const attempts = new Map<string, number[]>();
function throttled(key: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  attempts.set(key, recent);
  return recent.length > MAX_ATTEMPTS;
}
function clientIp(req: any): string {
  return (req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) || req.ip || "unknown";
}

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/signup — create an account, return a session token + the user.
  app.post("/auth/signup", async (req, reply) => {
    if (throttled(`signup:${clientIp(req)}`)) return reply.status(429).send({ error: "too_many_attempts" });
    const p = Signup.safeParse(req.body);
    if (!p.success) return reply.status(400).send({ error: "invalid_request", issues: p.error.issues });
    if (findByEmail(p.data.email)) return reply.status(409).send({ error: "email_taken" });
    const u = createUser(p.data.email, p.data.name ?? "Traveler", p.data.password);
    return { token: signToken(u.id, u.email), user: publicUser(u) };
  });

  // POST /auth/login — verify credentials, return a session token.
  app.post("/auth/login", async (req, reply) => {
    const p = Login.safeParse(req.body);
    if (!p.success) return reply.status(400).send({ error: "invalid_request" });
    // Throttle by IP+email so an attacker can't grind one account or spray many.
    if (throttled(`login:${clientIp(req)}:${p.data.email.toLowerCase()}`)) {
      return reply.status(429).send({ error: "too_many_attempts" });
    }
    const u = findByEmail(p.data.email);
    if (!u || !verifyPassword(p.data.password, u.passwordHash)) {
      return reply.status(401).send({ error: "invalid_credentials" });
    }
    return { token: signToken(u.id, u.email), user: publicUser(u) };
  });

  // GET /auth/me — the signed-in user (from the Bearer session set by the ops hook).
  app.get("/auth/me", async (req: any, reply) => {
    if (!req.accountId) return reply.status(401).send({ error: "not_signed_in" });
    const u = getUser(req.accountId);
    if (!u) return reply.status(401).send({ error: "not_signed_in" });
    return { user: publicUser(u) };
  });
}
