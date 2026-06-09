// Payment provider. Mock runs with no keys; Stripe charges a PaymentMethod stored in the vault
// (Chunk 4). Both require a connected `payment` service for the account — you cannot charge a
// card the user never connected.
import type { PaymentRecord } from "./types.ts";
import { config } from "../config.ts";
import { activeConnection, connectionById, reveal } from "../vault/index.ts";

export interface ChargeContext {
  accountId: string;
  /** Specific card connection to charge (chosen by the wallet selector). Falls back to any
   *  connected payment method if omitted. */
  connectionId?: string;
}

/** Resolve the card connection to charge: the chosen one, or any connected payment method. */
function resolvePaymentConnection(ctx: ChargeContext) {
  const conn = ctx.connectionId ? connectionById(ctx.connectionId) : activeConnection(ctx.accountId, "payment");
  if (!conn || conn.kind !== "payment" || conn.status !== "connected") {
    throw new Error("no_payment_method: connect a payment method before booking");
  }
  return conn;
}

export interface PaymentProvider {
  readonly provider: "stripe" | "mock";
  readonly live: boolean;
  /** Charge in the traveler's name. idempotencyKey guarantees one charge per booking. */
  charge(amountUsd: number, currency: string, idempotencyKey: string, ctx: ChargeContext): Promise<PaymentRecord>;
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
  async charge(amountUsd: number, currency: string, idempotencyKey: string, ctx: ChargeContext): Promise<PaymentRecord> {
    // Even in mock mode, a payment method must be connected — mirrors the real authorization rule.
    resolvePaymentConnection(ctx);
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
  async charge(amountUsd: number, currency: string, idempotencyKey: string, ctx: ChargeContext): Promise<PaymentRecord> {
    const conn = resolvePaymentConnection(ctx);

    // The vault holds the Stripe Customer + PaymentMethod created via the connect flow (SetupIntent).
    const cred = reveal(conn) as { customerId?: string; paymentMethodId?: string };
    if (!cred.customerId || !cred.paymentMethodId) {
      throw new Error("payment_connection_incomplete: missing Stripe customer/payment_method");
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(config.stripeKey!);
    // off_session + confirm: charge the stored method now. Idempotency key prevents double charges.
    const intent = await stripe.paymentIntents.create(
      {
        amount: Math.round(amountUsd * 100),
        currency: currency.toLowerCase(),
        customer: cred.customerId,
        payment_method: cred.paymentMethodId,
        off_session: true,
        confirm: true,
      },
      { idempotencyKey },
    );

    return {
      provider: "stripe",
      intentId: intent.id,
      amountUsd,
      currency,
      status: intent.status === "succeeded" ? "succeeded" : intent.status === "requires_confirmation" ? "requires_confirmation" : "failed",
      live: !config.stripeKey!.startsWith("sk_test_"),
    };
  }
}

export function getPayments(): PaymentProvider {
  return config.payments === "stripe" ? new StripePayments() : new MockPayments();
}
