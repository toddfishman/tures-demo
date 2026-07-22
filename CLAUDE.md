# Tures — agent handoff (read this first)

**Tures** is Todd's AI travel concierge: describe a trip, Tures books every leg and returns **confirmation numbers, not links**. Core rules: human confirms before money moves; **no fake success states** (Sample-labeled until live booking); every action audit-logged.

## Talking to Todd

Todd is **not very technical**. Use **short, plain English** — what it means and what to do next. See `.cursor/rules/todd-communication.mdc`.

## First actions on entry

1. **`git pull --rebase origin main`** — parallel sessions push here.
2. **Front-end = `v12/`** — https://toddfishman.github.io/tures-demo/v12 (target: `tures.app`). `v2`–`v11` are archives.
3. **Launch docs:** [`v12/LAUNCH.md`](v12/LAUNCH.md) · [`v12/CHECKLIST.md`](v12/CHECKLIST.md).

## Repo layout

| Path | Role |
|------|------|
| `v12/` | Current front-end (GitHub Pages) |
| `engine/` | Back-end — https://tures-engine.onrender.com |
| `render.yaml` | Render deploy config |

Strategy docs (BRIEF, ARCHITECTURE, etc.) live **outside this repo** — ask Todd to paste if needed.

## Live engine (check `/health`)

Typical prod: `durable:true`, `auth:true`, `agentLoop:true`, `voice:true`, `tripWatch:true`, `stagehand:true`, `chatBrain:sakana-fugu`, `realInventorySearch:true`, **`bookingSimulated:true`**, `paymentProvider:mock`, `billingLive:true` (Stripe test).

**P6 real money** (`ALLOW_LIVE_BOOKING`, `STRIPE_CHARGE_CARDS`, live Duffel orders) — **Todd explicit only**. Never flip without him.

## Product spine

```
converse → parse → plan → hold → confirm → prove
```

- **Chat** (`/converse`) — guided brief, Fugu primary + Anthropic fallback, mem0 personalization
- **Planner** (`/plan`) — Claude agent loop + deterministic fallback, SSE stream
- **Booking** (`/book` → `/confirm`) — human-confirm gate; Duffel search (real); orders simulated until P6
- **Vault** — Stripe card tokens + encrypted PII (VGS optional); scopes server-derived
- **Trip Watch** — pass-through COGS + 20%, adaptive scans
- **Hiccup** — disruption detect + rebook (simulated confirmations when P6 off)
- **Action Executor** — Browserbase/Stagehand for no-API sites (`handoff.html`)

## Who can do what (easy to break — read before touching `/actions`)

**Anonymous visitors get free read-only lookups** so they can try Tures before signing up. Everything that acts on their behalf needs an account.

| | Anonymous | Signed in |
|---|---|---|
| `act:research` (web lookup) | ✅ free, 5/day per IP | ✅ |
| contact · fill_forms · reserve · purchase · browser_* | ❌ `401 sign_in_required` (+ a `reason`) | ✅ (grant still required) |

- Rule lives in **`engine/src/actions/catalog.ts` → `freeForAnonymous()`** — default-deny, all three required: **read-only**, **no browser session**, **`estUsd` ≤ `FREE_ACTION_MAX_USD`** ($0.05).
- Each permission carries an **`estUsd`** (research $0.02, browser actions $0.25–0.35). That's what makes the cost rule real — keep it honest if provider costs change.
- Daily cap `FREE_ACTION_DAILY_LIMIT` (5) bounds *total* anonymous spend; per-run cost is capped separately. Over it → `429 free_limit_reached`.
- `/actions/run` is in the ops open list so anonymous requests **reach the handler**, which then decides. Don't "simplify" by removing the handler checks.

**`trustProxy: 1` in `engine/src/server.ts` is load-bearing.** Render fronts us with exactly one proxy. Without it `req.ip` is the *proxy's* address, so every per-IP limit (global rate limit, login throttle, free-run quota) becomes one bucket shared by the whole internet. Trusting exactly one hop also stops a forged `X-Forwarded-For` from resetting a quota. **Never read `x-forwarded-for` directly — use `req.ip`.**

**Failure messages must match the cause** (`v12/assets/assist-ui.js` → `failureFor()`): 401 → create-account prompt, 429 free-limit → create-account, 403 → permission, 5xx → "broke on my end", *no response* → "can't reach Tures". Don't collapse these back into one generic message — that was a real bug ("Could not reach Tures" shown when the engine had answered instantly).

## Payments (designed, not all live)

| What | Rail |
|------|------|
| Flights/hotels | Stripe charges traveler card → Duffel order (order API not wired yet) |
| Tures $99/trip fee | Stripe, server-derived (`PER_TRIP_FEE_USD`) |
| Concierge sub | Stripe Checkout (`/billing/checkout`) |
| Passport/loyalty | VGS or local AES — **not** cards |

## Dev commands

From `engine/` (use direct paths — `&` in iCloud path breaks npm shims):

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/tsx/dist/cli.mjs test/smoke.ts
```

## What's left before public beta

**Todd (Render/dashboard):** `GOOGLE_MAPS_API_KEY`, optional `ENGINE_API_KEY`, `X_BEARER_TOKEN`, `NEWS_API_KEY`, custom domain `tures.app` → GitHub Pages v12.

**Code polish (no real money):** E2E signed-in vault→book on prod, integration verification script, FX normalization for non-USD fares.

**Post-launch / P6:** Live Duffel orders, real card charges, VGS production, legal (SOT, terms, refunds).

## Key files

| Topic | Path |
|-------|------|
| Booking orchestration | `engine/src/booking/service.ts` |
| Duffel search | `engine/src/suppliers/duffel.ts` |
| Chat + brief handoff | `engine/src/routes/converse.ts` |
| Plan UX | `v12/plan.html`, `v12/assets/engine.js` |
| Launch checklist | `v12/LAUNCH.md` |
