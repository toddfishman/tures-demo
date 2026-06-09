import type { FastifyInstance } from "fastify";
import { config } from "../config.ts";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    ok: true,
    service: "tures-engine",
    version: "0.1.0",
    supplier: config.supplier,
    supplierIsLive: config.supplier === "duffel" ? config.duffel.isLive : false,
    capabilities: {
      search: true,
      agentLoop: !!config.anthropicKey, // Chunk 2 — Claude tool-use loop
      booking: true, // Chunk 3 — gate + mock execution always available
      paymentProvider: config.payments, // "mock" until a Stripe key is set
      liveBookingAllowed: config.allowLiveBooking, // hard safety switch
    },
  }));
}
