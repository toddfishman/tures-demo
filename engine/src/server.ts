// Tures Engine — gateway bootstrap. Fastify HTTP + SSE. Run with `npm run dev`.
import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.ts";
import { log } from "./logger.ts";
import { healthRoutes } from "./routes/health.ts";
import { searchRoutes } from "./routes/search.ts";
import { planRoutes } from "./routes/plan.ts";
import { bookRoutes } from "./routes/book.ts";
import { streamRoutes } from "./routes/stream.ts";

export async function build() {
  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: config.corsOrigins.length === 1 && config.corsOrigins[0] === "*"
      ? true
      : config.corsOrigins,
  });

  await app.register(healthRoutes);
  await app.register(searchRoutes);
  await app.register(planRoutes);
  await app.register(bookRoutes);
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
