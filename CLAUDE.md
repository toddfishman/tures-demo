# Tures — agent handoff (read this first)

**Agents:** start with [`AGENTS.md`](AGENTS.md) for the agent map, playbooks, evals, and safety rules. This file is the product-owner handoff.

**Tures** is Todd's AI travel concierge: describe a trip, Tures books every leg and returns **confirmation numbers, not links**. Core rules: human confirms before money moves; **no fake success states** (Sample-labeled until live booking); every action audit-logged.

## Talking to Todd

Todd is **not very technical**. Use **short, plain English** — what it means and what to do next. See `.cursor/rules/todd-communication.mdc`.

## First actions on entry

1. **`git pull --rebase origin main`** — parallel sessions push here.
2. **Front-end = `docs/`** — published by GitHub Pages **as the site root** at **`tures.app`** (Pages source = branch `main`, folder `/docs`). `v2`–`v11` (and the old `v12`, now renamed to `docs`) are archives; only `docs/` is served. URLs carry no version path — `tures.app/pricing.html` resolves directly.
3. **Launch docs:** [`docs/LAUNCH.md`](docs/LAUNCH.md) · [`docs/CHECKLIST.md`](docs/CHECKLIST.md).

## Repo layout

| Path | Role |
|------|------|
| `docs/` | Current front-end (GitHub Pages) |
| `engine/` | Back-end — https://tures-engine.onrender.com |
| `render.yaml` | Render deploy config |

Strategy docs (BRIEF, ARCHITECTURE, etc.) live **outside this repo** — ask Todd to paste if needed.

## Live engine (check `/health`)

Typical prod: `durable:true`, `auth:true`, `agentLoop:true`, `voice:true`, `tripWatch:true`, `stagehand:true`, `chatBrain:anthropic (fugu fallback)`, `realInventorySearch:true`, **`bookingSimulated:true`**, `paymentProvider:mock`, `billingLive:true` (Stripe test).

**P6 real money** (`ALLOW_LIVE_BOOKING`, `STRIPE_CHARGE_CARDS`, live Duffel orders) — **Todd explicit only**. Never flip without him.

## Product spine

```
converse → parse → plan → hold → confirm → prove
```

- **Chat** (`/converse`) — guided brief, Anthropic primary + Fugu fallback, mem0 personalization
- **Planner** (`/plan`) — Claude agent loop + deterministic fallback, SSE stream
- **Booking** (`/book` → `/confirm`) — human-confirm gate; Duffel search (real); orders simulated until P6
- **Vault** — Stripe card tokens + encrypted PII (VGS optional); scopes server-derived
- **Taste Engine** — six-axis Taste Print (standing) + per-trip lens; scores offers, learns from bookings/swaps
- **Trip Watch** — pass-through COGS + 20%, adaptive scans
- **Hiccup** — triage → options → propose/rebook (simulated confirmations when P6 off)
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

## The Taste Engine (`engine/src/taste/`) — easy to get wrong

Two profiles, one traveler: a **standing Taste Print** (six 0–100 axes) and a **per-trip lens** that bends only the outliers.

- **50 means "no opinion" and is load-bearing.** An axis at 50 contributes nothing to scoring, so a half-built print degrades gracefully. Don't "helpfully" default a missing axis to anything else.
- **Never guess an offer's taste.** `features.ts` returns only axes it found real evidence for, each with a confidence. `fit.ts` reports `coverage`; the scorer weights taste DOWN when coverage is low. An unreadable offer scores a neutral 0.5 — it is not punished, and it is not flattered.
- **Match on word boundaries, never substrings.** The old scorer's `includes("grand")` matched "Rio Grande". There's a regression test for it.
- **Learning comes from the CONTRAST, not the choice** (`learn.ts`). Booking a boutique when every option was a boutique teaches nothing; booking it over three grand hotels teaches a lot. Learning rate decays with evidence so a print converges instead of oscillating.
- **`engine/src/taste/lens.ts` is the single source of truth for lenses.** `taste.html` keeps a fallback copy for offline, adopts the engine's on load, and mirrors the same squash math in its `bend()`. If you change one, change both — a panel that bends differently from the planner shows the traveler something Tures won't do.
- `resolveAccountId` **ignores** any `accountId` in the body — the session decides. Anonymous prints live in localStorage and are adopted into the account on sign-in (`maybeAdoptLocalTaste` in `engine.js`), never overwriting what the account already learned.

## The Hiccup Handler (`engine/src/hiccup/`) — it can move money

`triage → options → authority → (rebook | propose | monitor | ignore)`

- **Triage first, always** (`triage.ts`). Most disruptions deserve `monitor`. A delay under 90 minutes is watched, not acted on. A destination closure is a notice. Escalating everything to a rebook was the v1 bug.
- **The replacement can never be the disrupted leg.** v1's `?? flights[0]` fallback could rebook a cancelled flight onto itself. `options.ts` hard-excludes it; there's a test.
- **Seat first, then money** (`execute.ts`). v1 charged the fare difference and then booked, with no reversal if the book threw. If the seat can't be had, nothing is charged; if the charge then fails, it is reported loudly, never swallowed.
- **Proposals are durable rows** with options, an expiry, and accept/decline endpoints — a "yes" arriving twenty minutes later on a phone still has something to act on. Only options Tures actually offered can be accepted.
- **One event, one response.** Disruptions carry a `sourceId` dedupe key so three signals about one storm make one proposal, not three rebooks.
- **Signals are inferences, not facts.** The watcher escalates `critical` as an *unquantified* schedule change (→ propose) and `warning` as a delay (→ monitor). Never let a guess auto-move someone.
- **Never rebook an imported trip.** `source === "import"` (Concierge Mode) is somebody else's PNR — advise only.

**Failure messages must match the cause** (`docs/assets/assist-ui.js` → `failureFor()`): 401 → create-account prompt, 429 free-limit → create-account, 403 → permission, 5xx → "broke on my end", *no response* → "can't reach Tures". Don't collapse these back into one generic message — that was a real bug ("Could not reach Tures" shown when the engine had answered instantly).

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
node node_modules/tsx/dist/cli.mjs test/taste-hiccup.ts
```

## What's left before public beta

**Todd (Render/dashboard):** `GOOGLE_MAPS_API_KEY`, optional `ENGINE_API_KEY`, `X_BEARER_TOKEN`, `NEWS_API_KEY`. Custom domain `tures.app` → GitHub Pages (source = `main` `/docs`).

**Code polish (no real money):** E2E signed-in vault→book on prod, integration verification script, FX normalization for non-USD fares.

**Post-launch / P6:** Live Duffel orders, real card charges, VGS production, legal (SOT, terms, refunds).

## Key files

| Topic | Path |
|-------|------|
| Booking orchestration | `engine/src/booking/service.ts` |
| Taste Engine | `engine/src/taste/` · `docs/taste.html` |
| Hiccup Handler | `engine/src/hiccup/` · `docs/hiccup.html` |
| Duffel search | `engine/src/suppliers/duffel.ts` |
| Agent guide + playbooks | `AGENTS.md`, `engine/playbooks/` |
| Chat + brief handoff | `engine/src/routes/converse.ts` |
| Plan UX | `docs/plan.html`, `docs/assets/engine.js` |
| Launch checklist | `docs/LAUNCH.md` |
