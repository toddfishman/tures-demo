import type { FastifyInstance } from "fastify";
import { metricsSnapshot } from "../ops/metrics.ts";

export async function metricsRoutes(app: FastifyInstance) {
  // GET /metrics — uptime, request counts by status class, error count, avg latency, RSS.
  app.get("/metrics", async () => metricsSnapshot());
}
