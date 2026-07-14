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
