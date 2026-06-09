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
  /** Which supplier the engine will use given current env. */
  get supplier(): "duffel" | "mock" {
    return parsed.DUFFEL_API_TOKEN ? "duffel" : "mock";
  },
} as const;
