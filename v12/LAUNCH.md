# Tures — launch checklist

**Target:** public beta at `tures.app` / GitHub Pages `v12/`  
**Engine:** `https://tures-engine.onrender.com`  
**Last updated:** 2026-07-08

This is the **launch** doc. Feature slices live in [`CHECKLIST.md`](CHECKLIST.md). Work top-to-bottom within each tier; P0 blockers before polish.

---

## How to read this

| Tier | Meaning |
|------|---------|
| **P0** | Launch blockers — ship stops without these |
| **P1** | Core product — the executor loop must feel complete |
| **P2** | Agent & memory — where Tures becomes *knowing*, not just chatting |
| **P3** | Integrations — each external system, keyed and verified |
| **P4** | Front-end & trust — honest UX, auth, persistence visible to users |
| **P5** | Proactive layer — watch, signals, hiccup, channels |
| **P6** | Real money — **Todd explicit only** |

---

## P0 — Launch blockers (infra & safety)

### Engine deploy (Render)

- [x] **`DATA_DIR` + disk** in render.yaml (needs Render redeploy to activate)
- [ ] **`AUTH_SECRET`** set (sessions survive deploy; not ephemeral)
- [ ] **`VAULT_KEY`** set (encrypted credentials survive deploy)
- [ ] **`MEM0_API_KEY`** set (personalization on in prod)
- [ ] **`ANTHROPIC_API_KEY`** set (planner + Anthropic chat fallback)
- [ ] **`DEEPGRAM_API_KEY`** set (voice)
- [ ] Re-deploy after `render.yaml` env changes; verify `/health.durable === true`
- [ ] `/health` documents `bookingSimulated: true` until P6

### Security & auth

- [x] Auth UI (`login.html`) + nav Sign in
- [x] Ownership checks on bookings, disruptions, streams (`actsFor`)
- [x] Vault scopes server-derived (client can't self-grant `payment:charge`)
- [x] Per-trip fee server-derived (`PER_TRIP_FEE_USD`)
- [ ] **`ENGINE_API_KEY`** or rate limits reviewed for public exposure
- [ ] Login throttle verified under load (`routes/auth.ts`)
- [x] CORS includes `tures.app` + GitHub Pages origin *(render.yaml)*

### No fake success

- [x] Simulated bookings tagged **Sample** in UI
- [x] Unconfigured signal providers return empty (never fabricated)
- [x] `/health.capabilities.bookingSimulated` exposed
- [ ] Audit: no page implies real charges without P6 switches

---

## P1 — Core executor loop

The product is **parse → plan → hold → confirm → prove**. The AI agent is the **front door**; the planner and booking state machine are the **spine**.

### Conversational agent (`/converse`)

- [x] Guided checklist gate (`submit_brief` requires 6 slots + brief)
- [x] Taste Print / profile **context** pre-fill (`funnel.context()`)
- [x] Fugu primary + Anthropic fallback + phantom hand-off guard
- [x] Anthropic `web_search` on non-Fugu path
- [x] Voice uses same `/converse` path
- [x] **History compaction** before each turn (`agent/history.ts`)
- [x] Context string capped + structured (not unbounded prose) — `capContext` 1400 chars
- [x] Error UX: cold start / 502 retry (central retry in engine.js — api + voice transcribe/TTS)
- [ ] Eval set: 10 vague openers → all eventually `ready:true` without re-asking known slots

### Planner (`/plan`)

- [x] Claude agent loop when keyed; deterministic fallback
- [x] Traveler context assembly (Taste Print + brief + loyalty)
- [x] mem0 recall folded into planner context
- [x] **`memories` returned to client** for card copy
- [x] SSE `/stream/:tripId` emits search → propose → book events
- [ ] Budget FX normalization for non-USD fares (known gap)
- [ ] Plan regression smoke: Paris / Maui / Tokyo briefs → withinBudget sane

### Booking (`/book` → `/confirm`)

- [x] Human-confirm gate; policy violations block
- [x] Mock + Duffel search adapters
- [x] Two-source verification posture documented
- [x] **mem0 write-back** after successful book (destination + components)
- [ ] Signed-in held trip → vault → book E2E verified on prod
- [ ] Idempotency on confirm retried from UI

### Handoffs (no lobotomy)

- [x] Concierge / voice → `readyBrief` → plan direct (no re-converse)
- [x] Post-plan → radar → discover → book in one thread
- [ ] Telegram: plan yes; **book over Telegram** = post-launch
- [ ] `?from=proactive` greeting on plan (optional polish)

---

## P2 — Memory & context (the moat)

Three layers must stay aligned:

| Layer | Store | Used by |
|-------|--------|---------|
| **Session** | Chat history (compacted) | `/converse` |
| **Account** | Taste Print, prefs, vault, profile | `assembleContext`, onboarding |
| **Long-term** | mem0 (`user_id`) | `/converse`, `/plan`, (future: discover, hiccup) |

### Identity key (single traveler id)

- [x] `funnel.uid()` → `account.id` when signed in, else `guest-*`
- [x] Same id passed to `/converse`, `/plan`, voice
- [ ] On sign-in: **merge guest mem0 → account** (or accept fresh start with banner)
- [x] Engine `resolveAccountId` used as mem0 fallback on `/plan` when body omits userId

### Context distillation

- [x] **Conversation compaction** — max turns, per-message cap, total char budget
- [x] Richer `funnel.context()` (taste, home, loyalty, payment on file)
- [ ] Structured context object (JSON) instead of prose string — later
- [ ] Summarize thread to mem0 on `ready:true` handoff (one-shot trip summary)

### mem0 product surfacing

- [x] Recall in chat (personalized openers)
- [x] Recall in planner
- [x] **Plan cards** show memory-backed “why this one” when available
- [ ] Discover slates rank by memory (“like Mama's Fish House”)
- [x] Post-book: destination + components written to mem0
- [ ] Post-trip outcome + taste learnings to mem0 (beyond book confirm)
- [ ] Hiccup resolutions written to mem0

---

## P3 — Integrations

| Integration | Role | Key env | Status |
|-------------|------|---------|--------|
| **Anthropic** | Planner + chat fallback + web scout | `ANTHROPIC_API_KEY` | Required |
| **Sakana Fugu** | Primary chat (experimental) | `SAKANA_API_KEY` | Live optional |
| **mem0** | Long-term memory | `MEM0_API_KEY` | Required for launch |
| **Deepgram** | STT + Aura TTS (Orion) | `DEEPGRAM_API_KEY` | Required |
| **Duffel** | Real flight/stay search | `DUFFEL_API_TOKEN` | Optional (mock OK) |
| **Google Maps** | Geocode + Places discover | `GOOGLE_MAPS_API_KEY` | Optional |
| **Stripe** | Subscriptions + per-trip fee | `STRIPE_*` | Test mode OK |
| **Telegram** | Cross-channel chat | `TELEGRAM_*` | Bot live; book in-app |
| **VGS** | Production PCI vault | `VGS_*` | Post-launch / honest mock |
| **Render disk** | Persistence | `DATA_DIR` | P0 |

### Per-integration verification

- [ ] **mem0:** seed memory → chat references it → plan card cites it
- [ ] **Deepgram:** plan voice round-trip live
- [ ] **Duffel:** `/health.realInventorySearch` + plan shows real carrier names
- [ ] **Google:** `/discover` returns places; empty state when unkeyed
- [ ] **Telegram:** link code → `/start` → same accountId → converse works
- [ ] **Stripe:** checkout session + webhook (test mode)

---

## P4 — Front-end & trust

- [x] v12 canonical (`index`, `plan`, `vault`, `trips`, `onboard`, `login`)
- [x] Phone mockup proportions (9:19.5)
- [x] Dark mode, coral/black bubbles, male voice
- [x] My Trips from `/bookings` + Sample examples
- [x] Vault hydrate from engine
- [x] **`proactive.html`** → redirect to live `plan.html` (theater at `?theater=1`)
- [x] Discover empty-state UX when Google key off
- [x] Link `LAUNCH.md` from nav **More** (internal)
- [ ] Compile Tailwind (remove CDN) on all v12 pages
- [ ] SEO / OG on every page including `write.html` if still linked
- [ ] Custom domain `tures.app` → v12
- [ ] Update root `CLAUDE.md` → v12 current
- [ ] Pricing / checkout trust copy audit
- [ ] Link `LAUNCH.md` from nav **More** (internal)

---

## P5 — Proactive (watch & fix)

- [x] Trip radar (`/signals`) on plan
- [x] **Adaptive Trip Watch** — alerts always on + risk-scored scans (replaces naive 30m deep poll)
- [x] Pass-through pricing (Option A) — metered COGS + 20% margin, cap per trip
- [x] SSE live watch on trips + hiccup
- [x] Watcher → hiccup proposal pipeline
- [ ] Set `TRIP_WATCH_*` env on Render + redeploy
- [ ] `X_BEARER_TOKEN` for X alert polls (optional)
- [ ] `NEWS_API_KEY` for news scans on elevated risk days
- [ ] Premium feeds keyed (news / X / traffic) or remain honestly off
- [ ] Push / SMS notify channel (Telegram first)

---

## P6 — Real money *(Todd only)*

- [ ] `ALLOW_LIVE_BOOKING=true`
- [ ] `STRIPE_CHARGE_CARDS=true` + SetupIntent save-card flow
- [ ] Live Duffel orders
- [ ] VGS production + copy audit
- [ ] Legal: terms, PCI disclosure, refund policy

---

## Launch verification script (15 min)

1. **Cold visitor:** cover → plan → vague trip → guided questions → plan cards → book → Sample conf  
2. **Sign in:** login → onboard essentials → vault card → plan → trip appears in **My Trips**  
3. **Memory:** (signed in) mention a hotel you loved → new trip → plan card or chat cites it  
4. **Voice:** push-to-talk on plan → same thread → brief handoff  
5. **Radar:** after plan, Trip radar shows **Live** weather/AQI  
6. **Hiccup:** hiccup.html live monitor → start trip → wrench → proposal on stream  
7. **Telegram:** link from vault → bot responds (if token set)  
8. **`/health`:** durable, mem0, chatBrain, bookingSimulated  

---

## Current focus (next up)

**Render:** add `TRIP_WATCH_*` vars from `.env.render` and redeploy (replaces `SIGNAL_WATCH_INTERVAL_MIN=30` approach).

**Optional keys when ready:** `X_BEARER_TOKEN`, `NEWS_API_KEY`.

**Code queue:**
- [ ] X Filtered Stream (true push) instead of recent-search poll
- [ ] Over-cap spend approval UX
- [ ] Compile Tailwind (remove CDN) on v12
