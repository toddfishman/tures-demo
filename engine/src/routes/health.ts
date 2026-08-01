import type { FastifyInstance } from "fastify";
import { config } from "../config.ts";
import { providerStatus } from "../signals/registry.ts";
import { actionExecutorStatus } from "../actions/service.ts";
import { browserConfigured } from "../actions/browser.ts";
import { stagehandReady } from "../actions/stagehand.ts";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    ok: true,
    service: "tures-engine",
    version: "0.1.0",
    supplier: config.supplier,
    supplierIsLive: config.supplier === "duffel" ? config.duffel.isLive : false,
    capabilities: {
      search: true,
      realInventorySearch: config.supplier === "duffel", // real flights via Duffel when a token is set
      bookingSimulated: !config.allowLiveBooking, // confirmations are labeled samples; no money moves
      agentLoop: !!config.anthropicKey, // Chunk 2 — Claude tool-use loop
      // Conversational chat brain: Sakana Fugu when keyed (experimental primary), else Anthropic.
      // Fugu auto-falls-back to Anthropic on any error, so chat works as long as either is set.
      // Anthropic is the primary chat brain; Fugu (when keyed) is an optional experimental fallback.
      chatBrain: config.anthropicKey ? (config.sakana.enabled ? "anthropic (fugu fallback)" : "anthropic") : (config.sakana.enabled ? "sakana-fugu" : "none"),
      chatFallback: config.sakana.enabled ? (config.anthropicKey ? "anthropic" : "none") : undefined,
      booking: true, // Chunk 3 — gate + mock/simulated execution always available
      paymentProvider: config.payments, // "mock" until a Stripe key is set
      liveBookingAllowed: config.allowLiveBooking, // hard safety switch
      vault: true, // Chunk 4 — connected services + scoped grants
      wallet: true, // Chunk 4.5 — multi-card selection by reward value
      travelerProfile: true, // Chunk 4.5 — passport/KTN/memberships
      hiccupHandler: true, // Chunk 5 — disruption detection + autonomous rebooking
      situationalAwareness: true, // Signals layer — weather/air/events/advisories radar + watcher
      tripWatch: config.watch.enabled, // Adaptive Trip Watch — pass-through + risk-scored scans
      assist: !!config.anthropicKey, // "handle anything" concierge — web research + permissioned actions
      actionExecutor: actionExecutorStatus(), // browserbase | simulated
      browserAutomation: browserConfigured(),
      stagehand: stagehandReady(), // true when Browserbase + Anthropic keyed
      crossChannel: true, // channel-link identity (web/voice/Telegram resolve to one account + memory)
      telegram: config.telegram.enabled, // the same Tures, reachable on Telegram (off until a bot token is set)
      accounts: true, // email+password logins with sessions
      travelers: true, // family/companion travelers on the account
      placesGraph: true, // "where you've been" personalization signal
      voice: !!config.deepgramKey, // Deepgram speech-to-text on the brief chat
      billingLive: !!config.stripeKey && !!config.stripePriceSubscription, // real Stripe subscriptions
    },
    signals: {
      watcherOn: config.signals.watchIntervalMin > 0 && !config.watch.enabled,
      watchIntervalMin: config.signals.watchIntervalMin,
      tripWatch: config.watch.enabled,
      tripWatchTickMin: config.watch.tickMin,
      providers: providerStatus(),
    },
    tripWatch: {
      enabled: config.watch.enabled,
      pricingModel: "pass_through",
      marginPercent: config.watch.marginPercent,
      defaultCapUsd: config.watch.defaultCapUsd,
    },
    durable: !!config.dataDir, // persists accounts/vault/bookings across restarts
    piiVault: config.vgs.enabled ? "vgs" : "local-aes", // where passport/KTN/etc. are stored
    stripePublishableKey: config.stripePublishableKey, // pk_… for Stripe.js card forms (public)
    chargeCards: config.payments === "stripe", // true once real card charging is on
    auth: !!config.apiKey, // Chunk 6 — true when an API key is required
  }));
}
