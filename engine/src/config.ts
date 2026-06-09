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
  STRIPE_PRICE_SUBSCRIPTION: z.string().optional(),
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
  // Hard safety switch: real-money bookings (live supplier/payment) are refused unless this
  // is explicitly "true". Default false so dev/test can never charge a real card.
  ALLOW_LIVE_BOOKING: z.enum(["true", "false"]).default("false"),
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
  stripeKey: parsed.STRIPE_SECRET_KEY,
  vaultKey: parsed.VAULT_KEY,
  rateLimitMax: parsed.RATE_LIMIT_MAX,
  dataDir: parsed.DATA_DIR,
  authSecret: parsed.AUTH_SECRET,
  stripePriceSubscription: parsed.STRIPE_PRICE_SUBSCRIPTION,
  stripeWebhookSecret: parsed.STRIPE_WEBHOOK_SECRET,
  stripePricePerTrip: parsed.STRIPE_PRICE_PER_TRIP,
  stripePublishableKey: parsed.STRIPE_PUBLISHABLE_KEY,
  publicBaseUrl: parsed.PUBLIC_BASE_URL ?? "https://toddfishman.github.io/tures-demo/v5",
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
  /** Which provider charges cards for bookings. Stays mock until STRIPE_CHARGE_CARDS=true AND a
   *  real saved-card flow exists — so enabling subscriptions never breaks bookings. */
  get payments(): "stripe" | "mock" {
    return parsed.STRIPE_SECRET_KEY && parsed.STRIPE_CHARGE_CARDS === "true" ? "stripe" : "mock";
  },
  /** Which supplier the engine will use given current env. */
  get supplier(): "duffel" | "mock" {
    return parsed.DUFFEL_API_TOKEN ? "duffel" : "mock";
  },
} as const;
