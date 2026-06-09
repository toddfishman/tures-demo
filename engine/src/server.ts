// Tures Engine — gateway bootstrap. Fastify HTTP + SSE. Run with `npm run dev`.
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.ts";
import { log } from "./logger.ts";
import { registerOps } from "./ops/index.ts";
import { healthRoutes } from "./routes/health.ts";
import { metricsRoutes } from "./routes/metrics.ts";
import { authRoutes } from "./routes/auth.ts";
import { billingRoutes } from "./routes/billing.ts";
import { searchRoutes } from "./routes/search.ts";
import { planRoutes } from "./routes/plan.ts";
import { parseRoutes } from "./routes/parse.ts";
import { bookRoutes } from "./routes/book.ts";
import { connectionRoutes } from "./routes/connections.ts";
import { profileRoutes } from "./routes/profile.ts";
import { walletRoutes } from "./routes/wallet.ts";
import { disruptionRoutes } from "./routes/disruptions.ts";
import { travelerRoutes } from "./routes/travelers.ts";
import { placeRoutes } from "./routes/places.ts";
import { waitlistRoutes } from "./routes/waitlist.ts";
import { streamRoutes } from "./routes/stream.ts";

export async function build() {
  const app = Fastify({ logger: false });

  // Wildcard → literal "*" (emits Access-Control-Allow-Origin: *). Otherwise an explicit
  // allowlist that reflects a matching Origin. (origin:true is avoided — it can omit the
  // allow-origin header on some setups, which silently breaks browser CORS.)
  const wildcard = config.corsOrigins.length === 1 && config.corsOrigins[0] === "*";
  await app.register(cors, {
    origin: wildcard ? "*" : config.corsOrigins,
    methods: ["GET", "POST", "OPTIONS"],
  });

  // Per-IP rate limit; /health is exempt so uptime checks never trip it.
  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: "1 minute",
    allowList: (req) => req.url === "/health" || req.url.startsWith("/health?"),
  });

  // Keep the raw JSON body (needed for Stripe webhook signature verification) while still
  // parsing JSON. Also tolerates empty-body POSTs (returns {}).
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    (req as any).rawBody = body;
    try {
      const buf = body as Buffer;
      done(null, buf.length ? JSON.parse(buf.toString()) : {});
    } catch (e) {
      done(e as Error);
    }
  });

  // Auth, request logging, metrics, error/404 handlers.
  registerOps(app);

  await app.register(healthRoutes);
  await app.register(metricsRoutes);
  await app.register(authRoutes);
  await app.register(billingRoutes);
  await app.register(searchRoutes);
  await app.register(planRoutes);
  await app.register(parseRoutes);
  await app.register(bookRoutes);
  await app.register(connectionRoutes);
  await app.register(profileRoutes);
  await app.register(walletRoutes);
  await app.register(disruptionRoutes);
  await app.register(travelerRoutes);
  await app.register(placeRoutes);
  await app.register(waitlistRoutes);
  await app.register(streamRoutes);

  return app;
}

// Only listen when run directly (not when imported by the smoke test).
const isMain = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("server.ts");
if (isMain) {
  const app = await build();
  app
    .listen({ port: config.port, host: "0.0.0.0" })
    .then(() => {
      log.info("tures-engine up", {
        port: config.port,
        supplier: config.supplier,
        live: config.supplier === "duffel" ? config.duffel.isLive : false,
        authProtected: !!config.apiKey,
      });
    })
    .catch((err) => {
      log.error("failed to start", { err: String(err) });
      process.exit(1);
    });

  // Graceful shutdown — let in-flight requests finish on deploy/restart.
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      log.info("shutting down", { sig });
      app.close().then(() => process.exit(0)).catch(() => process.exit(1));
    });
  }
}
