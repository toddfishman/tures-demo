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
      vault: true, // Chunk 4 — connected services + scoped grants
      wallet: true, // Chunk 4.5 — multi-card selection by reward value
      travelerProfile: true, // Chunk 4.5 — passport/KTN/memberships
      hiccupHandler: true, // Chunk 5 — disruption detection + autonomous rebooking
      accounts: true, // email+password logins with sessions
      billingLive: !!config.stripeKey && !!config.stripePriceSubscription, // real Stripe subscriptions
    },
    durable: !!config.dataDir, // persists accounts/vault/bookings across restarts
    piiVault: config.vgs.enabled ? "vgs" : "local-aes", // where passport/KTN/etc. are stored
    auth: !!config.apiKey, // Chunk 6 — true when an API key is required
  }));
}
