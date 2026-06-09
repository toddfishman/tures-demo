// Operational hardening wired onto the Fastify app: API-key auth, request logging with a
// request id, metrics, and consistent error/404 responses.
import type { FastifyInstance } from "fastify";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import { recordResponse } from "./metrics.ts";

let reqSeq = 0;

export function registerOps(app: FastifyInstance) {
  // Auth — only enforced when ENGINE_API_KEY is set. /health stays open for uptime checks;
  // SSE accepts the key via ?token= since EventSource can't send headers.
  app.addHook("onRequest", async (req, reply) => {
    (req as any)._startNs = process.hrtime.bigint();
    (req as any)._rid = `r${reqSeq++}`;

    const key = config.apiKey;
    if (!key) return;
    if (req.method === "OPTIONS") return; // never block CORS preflight
    if (req.url === "/health" || req.url.startsWith("/health?")) return;
    if (req.url === "/waitlist" || req.url.startsWith("/waitlist")) return; // public early-access capture

    const auth = req.headers["authorization"];
    const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
    const headerKey = (req.headers["x-api-key"] as string | undefined) ?? bearer;
    const queryToken = (req.query as Record<string, string> | undefined)?.token;
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
