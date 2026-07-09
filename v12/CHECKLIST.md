# Tures v12 — product checklist

**Engine:** `https://tures-engine.onrender.com` · **Front-end:** `v12/`  
**Last updated:** 2026-07-08

Use this for **feature slices**. For **launch readiness** (agent, memory, integrations, P0 blockers), see **[`LAUNCH.md`](LAUNCH.md)**.

---

## Shipped (recent)

- [x] Parallax cover + phone demo (`index.html`)
- [x] Start-to-finish replay (`journey.html`)
- [x] Telegram + text onboarding (`telegram.html`, `setup.html`)
- [x] Coral/black chat bubbles, dark mode
- [x] Male Deepgram voice (Orion)
- [x] Voice inline in plan thread (no separate modal)
- [x] Structured flight/hotel plan cards
- [x] Travel-bg ghost fix (single video layer, no black dips)
- [x] Vault hydrate + My Trips from `/bookings` (Slice 2)
- [x] SSE live watch on trips + hiccup (`trip-stream.js`)

---

## Slice 1 — Identity & quick fixes *(done 2026-07-06)*

- [x] Product checklist (`CHECKLIST.md`)
- [x] **Auth UI** — `login.html` sign in + create account
- [x] Nav **Sign in** → `login.html` (not waitlist)
- [x] Fix `setup.html` `signUp(name, email, password)` call
- [x] Fix `journey.html` nav highlight (`data-page="demo"`)
- [x] `mem0` / `userId` uses `account.id` when signed in (`funnel.js`)

---

## Slice 2 — Vault & trips persist *(done 2026-07-06)*

- [x] Vault **hydrate** on load — `profile.get` + `connections.list` (`account-sync.js`)
- [x] Onboard sync — read engine state into forms
- [x] **My Trips** from `/bookings` — live section + Sample examples (`trips-live.js`)
- [x] Engine **persistence** — `DATA_DIR` + Render disk in `render.yaml` *(deploy to activate)*
- [x] Held trip → vault → book E2E — book + link to `trips.html#trip-{id}`

---

## Slice 3 — Channels & proactive *(done 2026-07-06)*

- [x] Telegram **link E2E** — `channels-ui.js` on vault + onboard (`channels.list` status)
- [x] Plan **Text Tures** → Telegram deep link (no `sms:` fallback when engine configured)
- [x] Signals **watcher** — `SIGNAL_WATCH_INTERVAL_MIN` in `render.yaml` (default `0`; set `30` to enable on deploy)
- [x] SSE `/stream` on trips + hiccup live monitor (`trip-stream.js`)
- [x] Hiccup: watcher → disruption proposals (engine escalation + front-end assess UI)

---

## Slice 4 — Personalization & polish

- [x] **mem0** in plan cards — hotel “Why this one” from `plan.memories` *(launch slice)*
- [ ] **mem0** in discover slates (“like you loved at…”)
- [ ] Google Places key on Render; empty discover UX
- [ ] `proactive.html` → real thread or redirect to plan
- [ ] Stripe billing when `billingLive`
- [x] CORS: add `tures.app` to engine (`render.yaml`)
- [ ] Nav orphans / compile Tailwind / update `CLAUDE.md` → v12

---

## Slice 5 — Adaptive Trip Watch *(pass-through Option A)*

- [x] **Engine:** TripWatch store, risk scorer, adaptive scheduler
- [x] **Always-on alerts** — weather thresholds + optional X poll (when `X_BEARER_TOKEN` set)
- [x] **Morning brief** + risk-scored scan budget (0–3 scans/day)
- [x] **Pass-through metering** — COGS + margin %, hard cap per trip
- [x] **Book opt-in** — `tripWatch` on `/book`; plan.html UI with cap selector
- [x] **My Trips** — watch status + spend on trip detail
- [x] **Over-cap approve** — `POST /watch/:id/approve-cap` + My Trips button
- [x] **Concierge included watch** — auto-enable on book for subscribers ($25 cap)
- [x] **Pricing copy** — pass-through Trip Watch band + FAQ
- [ ] X Filtered Stream (push) — current: recent-search poll every 2h

---

## Slice 6 — Real money *(Todd explicit only)*

- [ ] Live Duffel + `ALLOW_LIVE_BOOKING`
- [ ] `STRIPE_CHARGE_CARDS`
- [ ] VGS production vault (honest copy)

---

## Slice 7 — Action Executor *(wired 2026-07-08)*

- [x] Architecture doc `engine/docs/ACTION-EXECUTOR.md`
- [x] Permission catalog + grant store (`/actions/grants`)
- [x] Run state machine + handoff routes (`/actions/run`, `/actions/handoff/:token`)
- [x] Browserbase session adapter (`BROWSERBASE_*` env)
- [x] **Stagehand v3 agent** — `engine/src/actions/stagehand.ts` (resume after handoff)
- [x] Human handoff page `v12/handoff.html` (+ `?demo=1` preview)
- [x] Telegram notify on handoff (when bot + channel linked)
- [ ] Vault credential injection into browser sessions
- [x] **Assist UI** — grant + run from proposed actions in concierge chat
- [ ] Session replay in My Trips audit trail

---

## Works today (live engine)

| Path | Real API? | Real money? |
|------|-----------|-------------|
| Plan chat → converse → plan → book | Yes | No (simulated confirmations) |
| Voice on plan | Yes | — |
| Corner concierge → plan handoff | Yes | — |
| Trip radar `/signals` | Yes (weather/air; web if deep) | — |
| Hiccup live strip | Yes | No |
| Trip SSE watch | Yes (`/stream` on trips + hiccup) | — |
| Vault save / book held | Yes | No |
| Waitlist | Yes | — |
| My Trips page | Yes when signed in (`/bookings`) + Sample examples | No |
| Concierge page | No (scripted) | — |
| Telegram link | Yes when signed in (`linkCode` + status in vault/onboard) | Plans only over TG |

---

## Sample / mock (honest labels)

- All confirmation UIs tagged **Sample** after book
- `index.html` phone tabs, `journey.html`, `runDemo()` on plan
- `trips.html` static trips
- Demo card tokens (`tok_demo_*`)
- Flight times on plan cards (client-side cosmetic)

---

## Guarded off (env)

| Knob | Purpose |
|------|---------|
| `ALLOW_LIVE_BOOKING` | Real supplier bookings |
| `STRIPE_CHARGE_CARDS` | Charge cards |
| `GOOGLE_MAPS_API_KEY` | Discover / Places |
| `SIGNAL_WATCH_INTERVAL_MIN` | Background trip watcher |
| `DATA_DIR` | Durable accounts/vault/bookings |
| `TELEGRAM_*` | Bot (token set ✓; link needs auth UI) |

---

## Demo script (what to say)

| Moment | Script |
|--------|--------|
| Plan + book | “Real AI and planner; confirmations are Sample — no card charged.” |
| Trip radar | “**Live** weather and air — not Sample.” |
| My Trips | “Your trips load from the engine when signed in; examples below are Sample.” |
| Telegram | “Sign in, Connect — same memory follows you on Telegram.” |
| Vault | “Saves push to engine; full reload sync is Slice 2.” |

---

## Page map

| Page | Engine? | Notes |
|------|---------|-------|
| `plan.html` | **Full** | Core product |
| `vault.html` | Write | Hydrate = Slice 2 |
| `onboard.html` | Write | |
| `setup.html` | Write + auth | Slice 1 fix |
| `login.html` | Auth | Slice 1 ✓ |
| `signup.html` | Waitlist | |
| `trips.html` | None | Slice 2 |
| `journey.html` | None | Replay |
| `hiccup.html` | Partial | Live strip bottom |
