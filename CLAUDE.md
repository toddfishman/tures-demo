# Tures — agent handoff (read this first, don't re-scan)

**You are picking up Tures.** Read this whole file before touching anything. It is the source of truth for a cold-start agent (including a Claude Cowork dispatch). It mirrors Todd's working memory — keep it current if you change something structural.

Tures is Todd's AI travel-concierge product: an **executor**, not a research tool — describe a trip in plain English, Tures books every leg and ends with **confirmation numbers, not links**. Persona: "Andy Rockwell" (frequent luxury traveler, $300K+ HHI, names hotels, friction-allergic). Core principles: LLM parses, deterministic executor books; the Brief is the authorization boundary; pause-and-ask on uncertainty; **no fake success states** (two-source verification); every action audit-logged.

## First actions on entry
1. **`git pull --rebase origin main`** — this repo goes stale; a parallel session also pushes here. Always rebase before you push.
2. Current front-end version is **v8** — work in `v8/`. (`v7/` is the pre-nav-fix snapshot; `v2/`–`v6/` are older.)
3. Don't re-scan the whole tree to "understand the project" — it's described below.

## Where the code is
- **This repo** = `github.com/toddfishman/tures-demo` (the front-end demo + the engine under `engine/`).
- **Front-end**: versioned static demos `v2/`–`v8/`, served on GitHub Pages. **Current = v8: https://toddfishman.github.io/tures-demo/v8** . `v8/index.html` is the live "Bound Edition" cover (a small leather book floating over a rotating full-bleed world — Tulum/Paris/Tokyo/Lapland/NYC; tap to open → two-door chooser "What is Tures?" / "Plan a trip").
- **Funnel order (v8)**: `index.html` (cover) → `01-landing.html` → `02-taste-engine.html` → `03-paste-trip.html` (the conversational brief — the heart) → `04-connections` → `05-execution` → `07-itinerary` → `08-concierge`; plus `pricing.html`, `signup.html`, `welcome.html`, `checkout.html`, `auth/`, `legal/`, `account.html`, `admin.html`.
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
- **Fixed in v8 (2026-06-14)**: `#contents` now auto-opens the chooser (was a dead anchor across ~15 nav + back-links); every funnel page's terminal nav CTA unified to gold "Start free → 03-paste-trip" (value-first); pricing's nav CTA moved off the `signup.html` wall; **the cover auto-reveals** the two-door chooser after a 7s brand beat (a manual tap opens sooner with a quicker ~0.76s turn; the auto-reveal turns slowly ~2.6s; reduced-motion ≈ instant); **stray page-turn on cold landing suppressed** (`pageturn.js` now skips the arrival leaf when there's no in-site `ptDir`). `05-execution` keeps its distinct in-app nav by design. All verified in the local preview.
- **Cover is now "option 1" (2026-06-14, later):** opening the book **page-turns (changes URL) to `write.html`**, where Tures inscribes the pitch on a blank journal and the two paths appear when the ink dries. This **supersedes** the in-place chooser auto-reveal described above (the `.pages` chooser markup is left dormant in `index.html`; the 7s/tap timing now triggers the page-turn instead). **`write.html` IS the landing — a real tracked page, NOT a stray prototype. Do not untrack or delete it.**

### Open items — review backlog (actionable; dispatch can work these top-to-bottom)
**Status (2026-06-15):** items **1–6 are all DONE and pushed.** (5 & 6 — self-host images, SEO/share meta — by dispatch; 2 & 3 by the main session.) **Item 2** = a use-case *reframe* (Per trip = "occasional"; Concierge = "frequent / always-on, unlimited") — **prices left at $99/$99 by design; no price change shipped.** Todd can send numbers anytime for an actual reprice. **Item 3** = truthful guarantee at `checkout.html` (3 trust cells + "Secured by Stripe · 256-bit" badge + a "Charged only when it's confirmed" card); per **no fake success states**, NO testimonial or trips-booked stat is invented — swap in a real one once there is one. Only **item 7** (design calls) remains; it needs Todd.
1. **Unify the remaining "Start free" CTA destinations.** In-page *body* CTAs still hit `signup.html` while the nav now goes to the planner. Route the **plan-first** CTAs to `03-paste-trip.html`: the gold buttons on `07-itinerary.html` & `08-concierge.html`, pricing's *Free* ("Start planning free") and *Per trip* ("Start free → pay at booking") cards, and the "Demo · Start free" links on `05-execution.html` & `06-hiccup-handler.html`. **Leave `Subscribe` (Concierge) → `signup.html`** and the booking step in `checkout.html` — those legitimately need an account. Goal: every "start/plan" CTA = planner; only account-gated actions = signup.
2. **Differentiate the $99/$99 collision** in `pricing.html` — Per trip ($99/booked) vs Concierge ($99/mo) read as the same price. Reprice per-trip or reframe the sub (e.g. annual/value framing) so the gap is obvious. **Confirm any price change with Todd before shipping.**
3. **Trust at checkout** (`checkout.html`) — add a secure-payment/Stripe badge + a one-line reassurance beside the pay button, and one testimonial or "N trips booked" proof point. Highest-anxiety moment; currently only fine print.
4. **Compile Tailwind for production** — replace `cdn.tailwindcss.com` (dev/JIT build, ships the compiler) on every `v8/*.html` with one minified static stylesheet built from the classes actually used. Don't touch `assets/tures.css`; don't introduce Tailwind `/opacity` on the custom tokens. Verify pixel-identical in preview.
5. **Self-host images** — replace hotlinked `images.unsplash.com/...` with optimized, locally-served responsive images (licensing + speed + reliability). **Cover this on every page incl. `write.html` and the cover `index.html`.** Note: a prior partial run already generated webp assets under `v8/assets/img/` (may be untracked locally) — reuse them if present rather than regenerating.
6. **Add share/SEO meta** — `<meta name="description">`, OpenGraph + Twitter-card tags, and a favicon on every `v8` page (**including `write.html`**). The pitch is "share your trip," so link previews matter.
7. **Bigger, needs Todd's input first** (don't just do these): execution-dashboard redesign and the palette pick — design calls, not pure cleanup. **Palette options are now viewable at `v8/palette.html`** — a live swatch switcher (Cream / Porcelain / Greige / Sage / Slate / Midnight) that holds chocolate+brass constant and varies only the surface. Once Todd picks, roll the chosen surface/ink tokens site-wide (they're reconstructions — fine to nudge the hexes).

## Guardrails
- Never flip the real-money switches (`ALLOW_LIVE_BOOKING`, `STRIPE_CHARGE_CARDS`, live Duffel) without explicit instruction from Todd.
- Never ship a fake success state — bookings are two-source verified for a reason.
- Rebase before pushing; this repo has more than one writer.
