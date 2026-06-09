import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createUser, findByEmail, verifyPassword, signToken, getUser, publicUser } from "../auth/index.ts";

const Signup = z.object({ email: z.string().email(), name: z.string().optional(), password: z.string().min(8) });
const Login = z.object({ email: z.string().email(), password: z.string() });

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/signup — create an account, return a session token + the user.
  app.post("/auth/signup", async (req, reply) => {
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
