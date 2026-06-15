# Tures — agent handoff (read this first, don't re-scan)

**You are picking up Tures.** Read this whole file before touching anything. It is the source of truth for a cold-start agent (including a Claude Cowork dispatch). It mirrors Todd's working memory — keep it current if you change something structural.

Tures is Todd's AI travel-concierge product: an **executor**, not a research tool — describe a trip in plain English, Tures books every leg and ends with **confirmation numbers, not links**. Persona: "Andy Rockwell" (frequent luxury traveler, $300K+ HHI, names hotels, friction-allergic). Core principles: LLM parses, deterministic executor books; the Brief is the authorization boundary; pause-and-ask on uncertainty; **no fake success states** (two-source verification); every action audit-logged.

## First actions on entry
1. **`git pull --rebase origin main`** — this repo goes stale; a parallel session also pushes here. Always rebase before you push.
2. Current front-end version is **v7** — work in `v7/`, not the older root files or `v2/`–`v6/`.
3. Don't re-scan the whole tree to "understand the project" — it's described below.

## Where the code is
- **This repo** = `github.com/toddfishman/tures-demo` (the front-end demo + the engine under `engine/`).
- **Front-end**: versioned static demos `v2/`–`v7/`, served on GitHub Pages. **Current = v7: https://toddfishman.github.io/tures-demo/v7** . `v7/index.html` is the live "Bound Edition" cover (a small leather book floating over a rotating full-bleed world — Tulum/Paris/Tokyo/Lapland/NYC; tap to open → two-door chooser "What is Tures?" / "Plan a trip").
- **Funnel order (v7)**: `index.html` (cover) → `01-landing.html` → `02-taste-engine.html` → `03-paste-trip.html` (the conversational brief — the heart) → `04-connections` → `05-execution` → `07-itinerary` → `08-concierge`; plus `pricing.html`, `signup.html`, `welcome.html`, `checkout.html`, `auth/`, `legal/`, `account.html`, `admin.html`.
- **Back-end**: `engine/` (Node + TypeScript + Fastify, "tures-engine"), **deployed live at https://tures-engine-tf.fly.dev**. The front-end calls it (default engine URL baked into `v7/assets/engine.js`); SSE streams.
- **Strategy docs live OUTSIDE this repo** (in Todd's local project root, not cloned by a dispatch): BRIEF, ARCHITECTURE, DEMO-FLOW, DESIGN-DIRECTION, OPEN-QUESTIONS, POST-MVP. If you need them, ask Todd to paste them — a dispatch won't have them.

## Live engine state (verified 2026-06-13, HEAD 7092aa4)
`/health` reports: supplier=**mock** (no Duffel token → confirmations are simulated, **no real bookings**), agentLoop=**true** (ANTHROPIC_API_KEY set & valid — parse returns `via: agent`), voice=**true** (DEEPGRAM_API_KEY set & valid — Aura TTS verified), liveBooking=**false** (hard safety off), durable=true, Stripe **test** mode, auth off. Enabling real bookings would require a live Duffel token + `STRIPE_CHARGE_CARDS=true` + `ALLOW_LIVE_BOOKING=true` — **all intentionally off; leave them off unless Todd explicitly says otherwise.** Engine milestones 0–6 done (mock+Duffel adapters, Claude agent loop, booking state machine + confirm gate, AES-256-GCM vault, wallet+profile, Hiccup Handler, hardening).

## What's built (v7 + engine)
- **Budget posture**: `priceSensitivity` thrifty/balanced/premium/no_limit + optional `budgetUsd` cap; parsed from prose, scored into a value-vs-taste blend, tunable in the brief (re-plans).
- **Traveler Context** (`engine/src/agent/context.ts`): standing prefs (Taste Print, cabin, avoid) + "where you've been" + loyalty + this-trip brief → fed to both scorer and Claude agent. `/prefs` persists the (non-PII) Taste Print; `/profile` is the encrypted PII store.
- **Route-aware mock carriers** (`mock.ts`): Hawaii→Hawaiian/Alaska, Tokyo→ANA, US domestic→Delta, Europe→Finnair.
- **No signup gate to plan**: "Plan a trip" → straight to `03-paste-trip` (neutral greeting). Anonymous CTA is an honest $0 mock-book preview → "Sign Up & Book" → signup → welcome onboarding → checkout (pending trip carried via `localStorage` key `tures.pendingTrip`).
- **✦ home star** (`assets/menu.js`): a brass `t✦` fixed top-right on every page → home.
- **Demo mode**: `03-paste-trip` greets neutrally for real users; `?demo=1` restores the Andy persona + example. The 4 landing cards each launch their own live demo via `?demo=1&trip=paris|tokyo|newyork|lapland`.
- **Voice** (`assets/voice.js`): Deepgram STT → `/converse` (Claude as Tures) → Deepgram Aura TTS (`/voice/speak`). Push-to-talk; a `start_planning` tool returns `{ready, brief}`, then voice.js fills the composer and calls `window.sendBrief()`. Distinct from the composer's 🎤 dictation mic.
- Design system + WCAG pass: see "Design system" and **Gotchas** below.

## Run / deploy / gotchas
- **The `&` in Todd's local repo path breaks npm bin shims** — run compilers directly, NOT `npm run`: `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/tsx/dist/cli.mjs test/smoke.ts` (27 smoke checks). (A Cowork dispatch on a clean clone path may not hit this — but use the direct form to be safe.)
- **Deploy engine**: from `engine/`, `flyctl deploy --ha=false --app tures-engine-tf` (flyctl logged in as toddfishman@gmail.com). On Todd's Windows box the binary is `& "$HOME\.fly\bin\flyctl.exe" deploy …`.
- **Commit messages** with `/` or nested quotes break PowerShell here-strings → write the message to a temp file and `git commit -F`. End commits with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Design system**: obsidian/leather near-blacks + brass `#c8a24a`/`#e6c873` on warm cream `#ECE3D0`. Cormorant + DM Serif + Inter + JetBrains Mono. Serif nouns, sans verbs, mono codes, **no exclamation marks**. Custom color tokens do **not** support Tailwind `/opacity` syntax — use the pre-defined `-soft`/`-faint`/`-deep` variants instead. Status hues have separate dot/fill vs text-on-cream shades for AA contrast.

## Open / next (not yet done)
- **Palette exploration**: 5 options mocked (Porcelain/Greige/Sage/Slate/Midnight leather, all keep chocolate+brass, vary the surface off cream) — **Todd has not picked one.** Roll site-wide once chosen.
- **Execution dashboard redesign**: a mobile-first single-column, decision-first version was mocked but not built; current `05-execution` is the old dense 2-column.
- **Resilience-aware planning** (Hiccup Handler as a *planning* input) — deferred; must be invisible/no-toggle (Todd's friction rule).
- Voice is only on `03-paste-trip`, not the cover/landing yet.
- **Known conversion issues flagged in review (2026-06-14, not yet fixed)**: cover hides all value behind the book-open click; "start" CTAs split between the planner and `signup.html` (should all go to the planner); `index.html#contents` is a dead anchor used in most navs; nav set differs page-to-page; per-trip $99 vs Concierge $99/mo collide; no social proof / trust badge at checkout; Tailwind loaded via CDN (use a compiled build for prod); Unsplash images hotlinked; no OG/meta tags.

## Guardrails
- Never flip the real-money switches (`ALLOW_LIVE_BOOKING`, `STRIPE_CHARGE_CARDS`, live Duffel) without explicit instruction from Todd.
- Never ship a fake success state — bookings are two-source verified for a reason.
- Rebase before pushing; this repo has more than one writer.
