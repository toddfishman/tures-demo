# Deploying the Tures Engine

The engine runs anywhere that runs a Node container. These notes cover **Fly.io** (the chosen
host). Render is the same idea: point it at this directory's `Dockerfile`.

## One-time

```bash
cd engine
fly launch --no-deploy        # or edit fly.toml's `app` name to one you own
```

## Secrets (this is the only manual step that needs your accounts)

Everything runs with **no secrets** on the mock supplier + mock payments. Add secrets to go
live, one at a time — each unlocks the next capability:

```bash
# Real flight search (Duffel TEST token — books in test mode, no real money)
fly secrets set DUFFEL_API_TOKEN=duffel_test_xxx

# Real agent loop (Claude tool-use planning instead of the deterministic planner)
fly secrets set ANTHROPIC_API_KEY=sk-ant-xxx

# Payments (Stripe). Charges a PaymentMethod stored in the vault via POST /connections
# (kind:"payment", secret:{customerId, paymentMethodId} from your Stripe SetupIntent flow).
fly secrets set STRIPE_SECRET_KEY=sk_test_xxx

# Vault encryption key (32 bytes). Without it the vault uses an ephemeral key and connected
# credentials are lost on restart — set this in any real deploy.
fly secrets set VAULT_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

### The real-money safety switch

`ALLOW_LIVE_BOOKING` defaults to `false`. While false, the policy gate **refuses any booking
through a live (non-test) supplier** — so a production Duffel token can't accidentally charge a
card. Flip it only when you genuinely want real bookings:

```bash
fly secrets set ALLOW_LIVE_BOOKING=true
```

## Deploy

```bash
fly deploy
fly open /health      # confirm it's up; shows which capabilities are live
```

`/health` reports exactly what's active given the secrets present:

```json
{ "supplier": "duffel", "capabilities": { "agentLoop": true, "paymentProvider": "stripe",
  "liveBookingAllowed": false } }
```

## Wiring the demo to the live engine (Chunk 6)

Once deployed, point the demo's execution stream at it: in `v5/05-execution.html`, replace the
hardcoded `QUEUE` drip with `new EventSource("https://<your-app>.fly.dev/stream/" + tripId)`, and
have `v5/03-paste-trip.html` POST the composed brief to `/plan` (then `/book`). CORS is already
allowed for the GitHub Pages origin in `fly.toml`.
