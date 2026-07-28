// Operational hardening wired onto the Fastify app: API-key auth, request logging with a
// request id, metrics, and consistent error/404 responses.
import type { FastifyInstance } from "fastify";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import { recordResponse } from "./metrics.ts";
import { verifyToken } from "../auth/index.ts";

let reqSeq = 0;

export function registerOps(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    (req as any)._startNs = process.hrtime.bigint();
    (req as any)._rid = `r${reqSeq++}`;

    const auth = req.headers["authorization"];
    const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
    const queryToken = (req.query as Record<string, string> | undefined)?.token;

    // Session: a valid user JWT (header or ?token=) sets the acting account for the request.
    const session = verifyToken(bearer) ?? verifyToken(queryToken);
    if (session) (req as any).accountId = session.sub;

    // Optional shared API-key gate (ops). Public product + auth endpoints stay open.
    const key = config.apiKey;
    if (!key) return;
    if (req.method === "OPTIONS") return; // never block CORS preflight
    const path = req.url.split("?")[0] ?? "";
    const open = [
      "/health",
      "/waitlist",
      "/auth",
      "/billing/webhook",
      "/telegram/webhook",
      // Static site — no embedded API key; anonymous visitors plan via these routes.
      "/converse",
      "/parse",
      "/plan",
      "/discover",
      "/signals",
      "/assist",
      "/reserve",
      // Action surface reachable anonymously — /actions/run then enforces its own policy
      // (read-only + browser-free + under the free-cost cap, with a daily quota). Everything
      // that acts on someone's behalf still needs an account, decided in the handler.
      "/actions/run",
      "/actions/capabilities",
      "/actions/permissions",
      // Taste Engine: the lens table and the axis vocabulary are STATIC product copy with no
      // personal data, and taste.html renders them for anonymous visitors — if they 401 the page
      // silently falls back to its own copy and drifts from what the planner actually scores.
      // Everything that touches a traveler's OWN print (/taste, /taste/quiz, /taste/lens,
      // /taste/feedback) stays closed.
      "/taste/lenses",
      "/taste/axes",
      "/voice/",
      "/book",
      "/stream/",
      "/watch/capabilities",
      "/actions/capabilities",
      "/actions/permissions",
      "/actions/handoff/",
      // Marketing Agent capabilities are static product copy (objectives/channels/honesty labels),
      // rendered for anonymous visitors. Everything that creates or mutates a campaign stays closed.
      "/marketing/capabilities",
    ];
    if (open.some((p) => path === p || path.startsWith(p))) return;
    if (session) return; // a signed-in user is authorized
    const headerKey = (req.headers["x-api-key"] as string | undefined) ?? bearer;
    if (headerKey !== key && queryToken !== key) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  // Per-request log + metrics.
  app.addHook("onResponse", async (req, reply) => {
    const startNs = (req as any)._startNs as bigint | undefined;
    const durationMs = startNs ? Number(process.hrtime.bigint() - startNs) / 1e6 : 0;
    recordResponse(reply.statusCode, durationMs);
    log.info("request", {
      rid: (req as any)._rid,
      method: req.method,
      url: req.url.split("?")[0],
      status: reply.statusCode,
      ms: Math.round(durationMs * 10) / 10,
    });
  });

  app.setErrorHandler((err: any, req, reply) => {
    const status = err?.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) log.error("unhandled", { rid: (req as any)._rid, err: String(err?.message ?? err) });
    reply.code(status).send({ error: status >= 500 ? "internal_error" : err?.message ?? "error" });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: "not_found", path: req.url.split("?")[0] });
  });
}
