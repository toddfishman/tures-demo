// Tures Engine — gateway bootstrap. Fastify HTTP + SSE. Run with `npm run dev`.
import dns from "node:dns";
// Prefer IPv4 for outbound DNS. Fly machines can have a flaky IPv6 path to external APIs,
// which surfaces as "Premature close" mid-response from api.anthropic.com. IPv4-first avoids it.
dns.setDefaultResultOrder("ipv4first");
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
import { tripsRoutes } from "./routes/trips.ts";
import { connectionRoutes } from "./routes/connections.ts";
import { profileRoutes } from "./routes/profile.ts";
import { prefsRoutes } from "./routes/prefs.ts";
import { tasteRoutes } from "./routes/taste.ts";
import { walletRoutes } from "./routes/wallet.ts";
import { disruptionRoutes } from "./routes/disruptions.ts";
import { travelerRoutes } from "./routes/travelers.ts";
import { placeRoutes } from "./routes/places.ts";
import { waitlistRoutes } from "./routes/waitlist.ts";
import { voiceRoutes } from "./routes/voice.ts";
import { converseRoutes } from "./routes/converse.ts";
import { streamRoutes } from "./routes/stream.ts";
import { discoverRoutes } from "./routes/discover.ts";
import { signalRoutes } from "./routes/signals.ts";
import { assistRoutes } from "./routes/assist.ts";
import { actionsRoutes } from "./routes/actions.ts";
import { channelRoutes } from "./routes/channels.ts";
import { telegramRoutes, registerTelegramWebhook } from "./routes/telegram.ts";
import { startSignalWatcher } from "./signals/watcher.ts";
import { startTripWatchScheduler } from "./watch/scheduler.ts";
import { watchRoutes } from "./routes/watch.ts";
import { mem0Routes } from "./routes/mem0.ts";

export async function build() {
  // trustProxy: 1 — Render puts exactly one proxy in front of us. Without this, req.ip is the
  // PROXY's address, so every "per IP" limit (the global rate limit, the login throttle, the free
  // action quota) collapses into one bucket shared by the whole internet. Trusting exactly one hop
  // also means a client-supplied X-Forwarded-For can't be used to fake an address and reset a quota.
  const app = Fastify({ logger: false, trustProxy: 1 });

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
  await app.register(tripsRoutes);
  await app.register(connectionRoutes);
  await app.register(profileRoutes);
  await app.register(prefsRoutes);
  await app.register(tasteRoutes);
  await app.register(walletRoutes);
  await app.register(disruptionRoutes);
  await app.register(travelerRoutes);
  await app.register(placeRoutes);
  await app.register(waitlistRoutes);
  await app.register(voiceRoutes);
  await app.register(converseRoutes);
  await app.register(streamRoutes);
  await app.register(discoverRoutes);
  await app.register(signalRoutes);
  await app.register(watchRoutes);
  await app.register(mem0Routes);
  await app.register(assistRoutes);
  await app.register(actionsRoutes);
  await app.register(channelRoutes);
  await app.register(telegramRoutes);

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
      // Start adaptive Trip Watch (pass-through + risk-scored scans). Legacy deep watcher stays
      // off unless SIGNAL_WATCH_INTERVAL_MIN>0 AND trip watch is disabled.
      startTripWatchScheduler();
      if (!config.watch.enabled) startSignalWatcher();
      // Point Telegram at this engine's webhook (no-op unless a bot token is set).
      void registerTelegramWebhook();
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
