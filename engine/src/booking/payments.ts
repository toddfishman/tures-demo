// Payment provider. Mirrors the supplier pattern: a deterministic Mock provider so the whole
// booking flow runs and tests with NO keys, and a guarded Stripe path that is wired at deploy
// time (real charges need a PaymentMethod + customer, which only exist with live credentials).
import type { PaymentRecord } from "./types.ts";
import { config } from "../config.ts";

export interface PaymentProvider {
  readonly provider: "stripe" | "mock";
  readonly live: boolean;
  /** Charge in the traveler's name. idempotencyKey guarantees one charge per booking. */
  charge(amountUsd: number, currency: string, idempotencyKey: string): Promise<PaymentRecord>;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

class MockPayments implements PaymentProvider {
  readonly provider = "mock" as const;
  readonly live = false;
  async charge(amountUsd: number, currency: string, idempotencyKey: string): Promise<PaymentRecord> {
    return {
      provider: "mock",
      intentId: `pi_mock_${hash(idempotencyKey)}`,
      amountUsd,
      currency,
      status: "succeeded",
      live: false,
    };
  }
}

class StripePayments implements PaymentProvider {
  readonly provider = "stripe" as const;
  readonly live = true;
  async charge(): Promise<PaymentRecord> {
    // Real Stripe PaymentIntent confirmation is finished in the deploy pass: it needs a stored
    // PaymentMethod + Customer from the connected-accounts flow (Chunk 4). Guarded so we never
    // half-charge.
    throw new Error("stripe_not_wired: live Stripe charging lands at deploy time (needs PaymentMethod/Customer)");
  }
}

export function getPayments(): PaymentProvider {
  return config.payments === "stripe" ? new StripePayments() : new MockPayments();
}
