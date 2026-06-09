// Tures Engine — gateway bootstrap. Fastify HTTP + SSE. Run with `npm run dev`.
import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.ts";
import { log } from "./logger.ts";
import { healthRoutes } from "./routes/health.ts";
import { searchRoutes } from "./routes/search.ts";
import { planRoutes } from "./routes/plan.ts";
import { parseRoutes } from "./routes/parse.ts";
import { bookRoutes } from "./routes/book.ts";
import { connectionRoutes } from "./routes/connections.ts";
import { profileRoutes } from "./routes/profile.ts";
import { walletRoutes } from "./routes/wallet.ts";
import { disruptionRoutes } from "./routes/disruptions.ts";
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

  await app.register(healthRoutes);
  await app.register(searchRoutes);
  await app.register(planRoutes);
  await app.register(parseRoutes);
  await app.register(bookRoutes);
  await app.register(connectionRoutes);
  await app.register(profileRoutes);
  await app.register(walletRoutes);
  await app.register(disruptionRoutes);
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
      });
    })
    .catch((err) => {
      log.error("failed to start", { err: String(err) });
      process.exit(1);
    });
}
