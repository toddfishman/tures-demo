// Real billing. Subscriptions go through Stripe Checkout (hosted card entry — no PCI burden on
// us). The per-trip concierge fee is charged with the booking (see booking/service). Gated by
// STRIPE_SECRET_KEY: without it, "subscribe" activates in mock mode so the demo still flows.
import { config } from "../config.ts";
import { getUser, saveUser, findByStripeCustomer } from "../auth/index.ts";
import { connect } from "../vault/index.ts";
import { log } from "../logger.ts";

/** Create (or reuse) a Stripe Customer for the account and a SetupIntent so the browser can
 *  collect + save a card via Stripe Elements. Returns the client secret for confirmCardSetup. */
export async function createSetupIntent(accountId: string): Promise<{ clientSecret: string; customerId: string }> {
  if (!config.stripeKey) throw Object.assign(new Error("stripe_not_configured"), { statusCode: 501 });
  const user = getUser(accountId);
  if (!user) throw Object.assign(new Error("sign_in_required"), { statusCode: 401 });
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(config.stripeKey);
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const c = await stripe.customers.create({ email: user.email, name: user.name });
    customerId = c.id;
    user.stripeCustomerId = customerId;
    saveUser(user);
  }
  const si = await stripe.setupIntents.create({ customer: customerId, payment_method_types: ["card"] });
  return { clientSecret: si.client_secret ?? "", customerId };
}

/** After the browser confirms the SetupIntent, store the resulting Stripe customer + payment
 *  method in the vault (VGS-tokenized) as a real payment connection. */
export async function saveCard(accountId: string, paymentMethodId: string, label: string, cardKey?: string, last4?: string) {
  const user = getUser(accountId);
  const customerId = user?.stripeCustomerId;
  if (!customerId) throw Object.assign(new Error("no_customer"), { statusCode: 400 });
  return connect({ accountId, kind: "payment", label, secret: { customerId, paymentMethodId }, meta: { cardKey, last4, live: true } });
}

export interface CheckoutResult {
  url: string;
  mock: boolean;
}

/** Start a subscription purchase. Returns a URL to redirect the browser to. */
export async function startSubscription(accountId: string, interval: "monthly" | "yearly" = "monthly"): Promise<CheckoutResult> {
  const user = getUser(accountId);
  const base = config.publicBaseUrl;

  const priceId =
    interval === "yearly"
      ? config.stripePriceSubscriptionYearly || config.stripePriceSubscription
      : config.stripePriceSubscription;

  if (!config.stripeKey || !priceId) {
    // Mock: activate immediately so the funnel works end-to-end without Stripe keys.
    if (user) {
      user.plan = "subscribe";
      saveUser(user);
    }
    log.info("billing: mock subscription activated", { accountId });
    return { url: `${base}/vault.html?subscribed=1`, mock: true };
  }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(config.stripeKey);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${base}/vault.html?subscribed=1`,
    cancel_url: `${base}/pricing.html`,
    client_reference_id: accountId,
    customer_email: user?.email,
  });
  return { url: session.url ?? `${base}/vault.html`, mock: false };
}

/** Stripe webhook: confirm a subscription and flip the user's plan. */
export async function handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ handled: boolean }> {
  if (!config.stripeKey || !config.stripeWebhookSecret) return { handled: false };
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(config.stripeKey);
  let event: any;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature ?? "", config.stripeWebhookSecret);
  } catch (e) {
    log.warn("billing: bad webhook signature", { err: String(e) });
    throw Object.assign(new Error("bad_signature"), { statusCode: 400 });
  }
  if (event.type === "checkout.session.completed") {
    const accountId = event.data.object.client_reference_id as string | undefined;
    const customerId = event.data.object.customer as string | undefined;
    const user = accountId ? getUser(accountId) : undefined;
    if (user) {
      user.plan = "subscribe";
      if (customerId) user.stripeCustomerId = customerId;
      saveUser(user);
      log.info("billing: subscription confirmed", { accountId });
    }
  } else if (event.type === "customer.subscription.deleted") {
    // Cancellation (or end of a failed/expired subscription) → back to free.
    const customerId = event.data.object.customer as string | undefined;
    const user = customerId ? findByStripeCustomer(customerId) : undefined;
    if (user) {
      user.plan = "free";
      saveUser(user);
      log.info("billing: subscription ended → free", { accountId: user.id });
    }
  }
  return { handled: true };
}
