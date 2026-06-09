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
  stripeKey: parsed.STRIPE_SECRET_KEY,
  vaultKey: parsed.VAULT_KEY,
  rateLimitMax: parsed.RATE_LIMIT_MAX,
  /** Read live from the env so tests can toggle auth without a fresh import. */
  get apiKey(): string | undefined {
    return process.env.ENGINE_API_KEY || undefined;
  },
  allowLiveBooking: parsed.ALLOW_LIVE_BOOKING === "true",
  /** Which payment provider will be used. Stripe needs a key AND lands at deploy time. */
  get payments(): "stripe" | "mock" {
    return parsed.STRIPE_SECRET_KEY ? "stripe" : "mock";
  },
  /** Which supplier the engine will use given current env. */
  get supplier(): "duffel" | "mock" {
    return parsed.DUFFEL_API_TOKEN ? "duffel" : "mock";
  },
} as const;
