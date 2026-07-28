// Centralized, validated configuration. Loads .env if present (no dotenv dependency —
// Node 20.12+ ships process.loadEnvFile). Every supplier/secret is optional in dev.
import { z } from "zod";

try {
  // Loads ./.env into process.env if the file exists; no-op otherwise.
  (process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  // .env is optional — the mock supplier needs no keys.
}

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  CORS_ORIGINS: z.string().default("http://localhost:8787"),
  DUFFEL_API_TOKEN: z.string().optional(),
  DUFFEL_API_URL: z.string().url().default("https://api.duffel.com"),
  ANTHROPIC_API_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  // 32-byte key (hex or base64) for encrypting vault credentials at rest. If unset, an
  // ephemeral key is generated per process (fine for dev; secrets won't survive a restart).
  VAULT_KEY: z.string().optional(),
  // When set, all routes except /health require Authorization: Bearer <key> (or ?token= for SSE).
  ENGINE_API_KEY: z.string().optional(),
  // Per-IP request ceiling per minute.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  // Directory for durable JSON storage (accounts/vault/bookings). Unset → in-memory only.
  DATA_DIR: z.string().optional(),
  // Secret for signing session tokens (JWT HS256). Unset → ephemeral (sessions drop on restart).
  AUTH_SECRET: z.string().optional(),
  // Stripe billing (Chunk: real money). Price IDs for the subscription + the per-trip fee.
  STRIPE_PUBLISHABLE_KEY: z.string().optional(), // pk_… — safe to expose; used by Stripe.js
  STRIPE_PRICE_SUBSCRIPTION: z.string().optional(), // monthly Concierge price_…
  STRIPE_PRICE_SUBSCRIPTION_YEARLY: z.string().optional(), // yearly Concierge price_… (20% off)
  STRIPE_PRICE_PER_TRIP: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Charge real cards for travel + per-trip fees. Requires a SetupIntent "save a card" flow
  // (not built yet) — until then booking charges stay mock even with a Stripe key set, so the
  // subscription can go live without breaking bookings.
  STRIPE_CHARGE_CARDS: z.enum(["true", "false"]).default("false"),
  // Public base URL of the demo, for Stripe Checkout success/cancel redirects.
  PUBLIC_BASE_URL: z.string().optional(),
  // VGS (Very Good Security) PII vault. When all three are set, sensitive data is tokenized into
  // VGS and only aliases touch our storage. Unset → self-managed AES-256-GCM at rest.
  VGS_VAULT_URL: z.string().optional(), // e.g. https://api.sandbox.verygoodvault.com
  VGS_USERNAME: z.string().optional(),
  VGS_PASSWORD: z.string().optional(),
  // Deepgram speech-to-text (voice input on the brief chat). Unset → /voice/transcribe is off.
  DEEPGRAM_API_KEY: z.string().optional(),
  // Deepgram Aura TTS voice for /voice/speak. Default: Orion (masculine, calm, professional).
  DEEPGRAM_TTS_MODEL: z.string().default("aura-2-orion-en"),
  // mem0 — managed memory layer for personalization (taste, learned preferences, trip-history
  // notes), keyed by user_id. Unset → memory is a no-op and the engine runs identically.
  MEM0_API_KEY: z.string().optional(),
  // Google Maps Platform key (Geocoding API + Places API New). Powers IATA/city→coordinates
  // (used by Duffel Stays) and real restaurant/things-to-do discovery. Unset → a built-in
  // airport table handles geocoding and discovery is skipped/mock.
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  // Hard safety switch: real-money bookings (live supplier/payment) are refused unless this
  // is explicitly "true". Default false so dev/test can never charge a real card.
  ALLOW_LIVE_BOOKING: z.enum(["true", "false"]).default("false"),
  // ── Sakana Fugu — experimental primary brain for Tures' conversational chats ──────────────
  // When SAKANA_API_KEY is set, /converse routes through Fugu first and falls back to Anthropic
  // on any error. OpenAI-compatible /chat/completions — confirmed 2026-06-25 against Sakana's docs:
  // base https://api.sakana.ai/v1, Bearer auth, models "fugu" (standard) / "fugu-ultra-20260615".
  SAKANA_API_KEY: z.string().optional(),
  SAKANA_API_URL: z.string().url().default("https://api.sakana.ai/v1"),
  SAKANA_MODEL: z.string().default("fugu"),
  // ── Telegram channel — the same Tures, reachable on Telegram (cross-channel memory) ──────────
  // Set TELEGRAM_BOT_TOKEN (from @BotFather) to turn the channel on. USERNAME is the bot's @handle
  // (without @) used for t.me deep links. WEBHOOK_SECRET (any random string) is checked on the
  // webhook so only Telegram can post to it. Unset → the channel is off and /telegram/webhook 404s.
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  // Per-trip concierge fee (USD) charged to non-subscribers on a booking. Server-derived from
  // the account's plan — never trusted from the request body.
  PER_TRIP_FEE_USD: z.coerce.number().nonnegative().default(99),
  // ── Situational-awareness "Signals" layer ──────────────────────────────────────────────
  // The watcher that monitors active booked trips and surfaces proactive signals. Minutes
  // between sweeps; 0 disables the background watcher (still available on-demand via /signals).
  SIGNAL_WATCH_INTERVAL_MIN: z.coerce.number().int().nonnegative().default(0),
  // Optional dedicated feeds. Weather + air-quality + travel-advisory are keyless (real, free);
  // the web/news/events provider uses ANTHROPIC_API_KEY. These are for higher-fidelity feeds
  // (traffic, transit status, local news/X) and are GUARDED — a provider with no key returns
  // nothing and reports itself "not configured" (never fabricates a signal).
  NEWS_API_KEY: z.string().optional(),
  X_BEARER_TOKEN: z.string().optional(),
  TRAFFIC_API_KEY: z.string().optional(),
  // ── Adaptive Trip Watch (pass-through metering + risk-scored scans) ───────────────
  TRIP_WATCH_ENABLED: z.enum(["true", "false"]).default("true"),
  TRIP_WATCH_TICK_MIN: z.coerce.number().int().positive().default(60),
  TRIP_WATCH_ALERTS_INTERVAL_MIN: z.coerce.number().int().positive().default(120),
  TRIP_WATCH_BRIEF_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(7),
  TRIP_WATCH_DEFAULT_CAP_USD: z.coerce.number().positive().default(10),
  TRIP_WATCH_SUBSCRIBER_CAP_USD: z.coerce.number().positive().default(25),
  TRIP_WATCH_MARGIN_PERCENT: z.coerce.number().int().min(0).max(100).default(20),
  // ── Action Executor — Browserbase + Stagehand ───────────────────────────────────────
  BROWSERBASE_API_KEY: z.string().optional(),
  BROWSERBASE_PROJECT_ID: z.string().optional(),
  /** Stagehand agent model — provider/model, e.g. anthropic/claude-sonnet-4-6 */
  ACTION_MODEL: z.string().default("anthropic/claude-sonnet-4-6"),
  // What an anonymous visitor may run on us, so "try it before you sign up" actually works.
  // A single run must be read-only, browser-free, and cost at most this much (see catalog
  // freeForAnonymous). Set to 0 to require an account for every action.
  FREE_ACTION_MAX_USD: z.coerce.number().nonnegative().default(0.05),
  // Per-run cost is capped above, but TOTAL anonymous spend is not — so also cap how many free
  // runs one visitor gets per day. Without this, free research is unbounded real money.
  FREE_ACTION_DAILY_LIMIT: z.coerce.number().int().nonnegative().default(5),
  // ── Marketing Agent — the growth loop (research → create → brand-check → publish → measure → optimize) ──
  // The loop logic + scheduler run when enabled, but all publishing/spend is SIMULATED until the
  // hard live switch below is flipped (Todd-explicit only, exactly like ALLOW_LIVE_BOOKING).
  MARKETING_ENABLED: z.enum(["true", "false"]).default("true"),
  // Hard safety switch: real ad publishing + real spend are refused unless this is "true" AND the
  // target channel has a token. Default false so dev/test can never place a real ad or spend a cent.
  MARKETING_LIVE: z.enum(["true", "false"]).default("false"),
  // Largest daily budget one campaign may request, USD. Bounds blast radius even when live.
  MARKETING_DAILY_BUDGET_CAP_USD: z.coerce.number().positive().default(50),
  // Minutes between loop passes for running campaigns.
  MARKETING_TICK_MIN: z.coerce.number().int().positive().default(60),
  // Optional ad-channel tokens. A channel with no token here always SIMULATES (never fabricates a
  // real publish), even with MARKETING_LIVE=true.
  META_ADS_TOKEN: z.string().optional(),
  GOOGLE_ADS_TOKEN: z.string().optional(),
  REDDIT_ADS_TOKEN: z.string().optional(),
  X_ADS_TOKEN: z.string().optional(),
});

const parsed = Env.parse(process.env);

export const config = {
  port: parsed.PORT,
  corsOrigins: parsed.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  duffel: {
    token: parsed.DUFFEL_API_TOKEN,
    apiUrl: parsed.DUFFEL_API_URL,
    /** Test tokens start with duffel_test_ — surfaced so we can refuse real money in dev. */
    isLive: !!parsed.DUFFEL_API_TOKEN && !parsed.DUFFEL_API_TOKEN.startsWith("duffel_test_"),
  },
  anthropicKey: parsed.ANTHROPIC_API_KEY,
  deepgramKey: parsed.DEEPGRAM_API_KEY,
  deepgramTtsModel: parsed.DEEPGRAM_TTS_MODEL,
  mem0Key: parsed.MEM0_API_KEY,
  googleMapsKey: parsed.GOOGLE_MAPS_API_KEY,
  perTripFeeUsd: parsed.PER_TRIP_FEE_USD,
  signals: {
    watchIntervalMin: parsed.SIGNAL_WATCH_INTERVAL_MIN,
    newsApiKey: parsed.NEWS_API_KEY,
    xBearerToken: parsed.X_BEARER_TOKEN,
    trafficApiKey: parsed.TRAFFIC_API_KEY,
  },
  watch: {
    enabled: parsed.TRIP_WATCH_ENABLED === "true",
    tickMin: parsed.TRIP_WATCH_TICK_MIN,
    alertsIntervalMin: parsed.TRIP_WATCH_ALERTS_INTERVAL_MIN,
    briefHourUtc: parsed.TRIP_WATCH_BRIEF_HOUR_UTC,
    defaultCapUsd: parsed.TRIP_WATCH_DEFAULT_CAP_USD,
    subscriberCapUsd: parsed.TRIP_WATCH_SUBSCRIBER_CAP_USD,
    marginPercent: parsed.TRIP_WATCH_MARGIN_PERCENT,
  },
  stripeKey: parsed.STRIPE_SECRET_KEY,
  vaultKey: parsed.VAULT_KEY,
  rateLimitMax: parsed.RATE_LIMIT_MAX,
  dataDir: parsed.DATA_DIR,
  authSecret: parsed.AUTH_SECRET,
  stripePriceSubscription: parsed.STRIPE_PRICE_SUBSCRIPTION,
  stripePriceSubscriptionYearly: parsed.STRIPE_PRICE_SUBSCRIPTION_YEARLY,
  stripeWebhookSecret: parsed.STRIPE_WEBHOOK_SECRET,
  stripePricePerTrip: parsed.STRIPE_PRICE_PER_TRIP,
  stripePublishableKey: parsed.STRIPE_PUBLISHABLE_KEY,
  publicBaseUrl: parsed.PUBLIC_BASE_URL ?? "https://toddfishman.github.io/tures-demo/v12",
  vgs: {
    url: parsed.VGS_VAULT_URL?.replace(/\/$/, ""),
    username: parsed.VGS_USERNAME,
    password: parsed.VGS_PASSWORD,
    get enabled(): boolean {
      return !!(parsed.VGS_VAULT_URL && parsed.VGS_USERNAME && parsed.VGS_PASSWORD);
    },
  },
  /** Read live from the env so tests can toggle auth without a fresh import. */
  get apiKey(): string | undefined {
    return process.env.ENGINE_API_KEY || undefined;
  },
  allowLiveBooking: parsed.ALLOW_LIVE_BOOKING === "true",
  /** Sakana Fugu — primary chat brain when keyed (OpenAI-compatible). Falls back to Anthropic. */
  sakana: {
    apiKey: parsed.SAKANA_API_KEY,
    apiUrl: parsed.SAKANA_API_URL,
    model: parsed.SAKANA_MODEL,
    get enabled(): boolean {
      return !!parsed.SAKANA_API_KEY;
    },
  },
  /** Telegram channel — same Tures, reachable on Telegram. Off until a bot token is set. */
  telegram: {
    token: parsed.TELEGRAM_BOT_TOKEN,
    username: parsed.TELEGRAM_BOT_USERNAME,
    webhookSecret: parsed.TELEGRAM_WEBHOOK_SECRET,
    get enabled(): boolean {
      return !!parsed.TELEGRAM_BOT_TOKEN;
    },
  },
  /** Which provider charges cards for bookings. Stays mock until STRIPE_CHARGE_CARDS=true AND a
   *  real saved-card flow exists — so enabling subscriptions never breaks bookings. */
  get payments(): "stripe" | "mock" {
    return parsed.STRIPE_SECRET_KEY && parsed.STRIPE_CHARGE_CARDS === "true" ? "stripe" : "mock";
  },
  /** Which supplier the engine will use given current env. */
  get supplier(): "duffel" | "mock" {
    return parsed.DUFFEL_API_TOKEN ? "duffel" : "mock";
  },
  /** Browserbase — cloud browsers for permissioned actions (login, forms, purchases on sites). */
  browserbase: {
    apiKey: parsed.BROWSERBASE_API_KEY,
    projectId: parsed.BROWSERBASE_PROJECT_ID,
    get enabled(): boolean {
      return !!(parsed.BROWSERBASE_API_KEY && parsed.BROWSERBASE_PROJECT_ID);
    },
  },
  /** Stagehand agent model for browser actions (uses ANTHROPIC_API_KEY by default). */
  actionModel: parsed.ACTION_MODEL,
  /** Ceiling on one free (anonymous) action run, USD. */
  freeActionMaxUsd: parsed.FREE_ACTION_MAX_USD,
  /** How many free runs one anonymous visitor gets per day (0 = none). */
  freeActionDailyLimit: parsed.FREE_ACTION_DAILY_LIMIT,
  /** Marketing Agent — the growth loop. `live` is the hard switch; `channelKeys` gate real
   *  publishing per channel (no key → simulated even when live). */
  marketing: {
    enabled: parsed.MARKETING_ENABLED === "true",
    live: parsed.MARKETING_LIVE === "true",
    dailyBudgetCapUsd: parsed.MARKETING_DAILY_BUDGET_CAP_USD,
    tickMin: parsed.MARKETING_TICK_MIN,
    channelKeys: {
      meta: parsed.META_ADS_TOKEN,
      google: parsed.GOOGLE_ADS_TOKEN,
      reddit: parsed.REDDIT_ADS_TOKEN,
      x: parsed.X_ADS_TOKEN,
      email: undefined as string | undefined, // email sends go through the existing notify layer
    } as Record<import("./marketing/types.ts").Channel, string | undefined>,
  },
} as const;
