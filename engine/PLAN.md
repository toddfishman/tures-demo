# The Tures Engine — Build Plan

The demo under `/v5` is a faithful mock of the *experience*. This is the plan for the
real thing underneath it: the agentic harness that finds good deals to the right kinds of
places and finishes the purchase.

Decisions locked (2026-06):

- **Code lives here**, in `/engine` (monorepo with the demo front-end).
- **Runtime**: Node + TypeScript, run with `tsx` in dev (no build step), `tsc` for prod.
- **Host**: Fly.io / Render (long-running process — needed for the live event stream and the agent loop).
- **Supplier (v1)**: Duffel — Flights + Stays, one modern API, real test mode, actual ticketing.
- **Payments**: Stripe (already named as the processor across the legal/billing pages).
- **LLM**: Anthropic Claude (Opus for planning, Sonnet for high-volume scoring).

The front-end stays on GitHub Pages and calls this engine over HTTPS. `v5/05-execution.html`
becomes a *real* consumer of the engine's event stream instead of a hardcoded `QUEUE`.

---

## Architecture

```
                         ┌─────────────────────────────────────────────┐
   GitHub Pages          │                 TURES ENGINE (Node)          │
   (static demo)         │                                              │
  ┌───────────────┐      │  ┌────────────┐   ┌──────────────────────┐  │
  │ 05-execution  │◀─SSE─┼──│  Gateway   │   │   Agent Orchestrator │  │
  │ (live stream) │      │  │ HTTP + SSE │──▶│  plan→search→score→  │  │
  │ 03-paste-trip │──────┼─▶│  Fastify   │   │  propose→confirm→book│  │
  │ 04-connections│      │  └─────┬──────┘   └──────────┬───────────┘  │
  └───────────────┘      │        │                     │              │
                         │        │            ┌────────┴─────────┐    │
                         │   ┌────┴─────┐       │ Supplier adapters│    │
                         │   │  Event   │       │  Duffel (v1)     │    │
                         │   │   bus    │       │  Mock (no keys)  │    │
                         │   └──────────┘       │  Amadeus (later) │    │
                         │        │             └────────┬─────────┘    │
                         │   ┌────┴───────────────────────┴────────┐    │
                         │   │  Persistence (Prisma)               │    │
                         │   │  trips · briefs · offers · orders   │    │
                         │   │  events · audit log                 │    │
                         │   │  SQLite (dev) → Postgres (prod)     │    │
                         │   └─────────────────────────────────────┘    │
                         │   ┌─────────────────────────────────────┐    │
                         │   │  Credential vault (encrypted)        │    │
                         │   │  Stripe tokens · Gmail · calendar    │    │
                         │   │  loyalty — scoped per brief          │    │
                         │   └─────────────────────────────────────┘    │
                         └──────────────────────────────────────────────┘
                                  │              │             │
                              Anthropic       Duffel         Stripe
```

### Components

1. **Gateway** (`src/server.ts`, `src/routes/`) — Fastify HTTP API + a Server-Sent-Events
   endpoint for the live execution stream. Schema-validated request/response.
2. **Agent orchestrator** (`src/agent/`) — the loop. A Claude tool-use cycle whose tools are
   the engine's own verbs: `search_flights`, `search_stays`, `score_options`, `hold_offer`,
   `request_confirmation`, `book`, `notify`. Emits an event for every step → that's the stream.
3. **Supplier adapters** (`src/suppliers/`) — `SupplierAdapter` interface; `duffel.ts` is the
   v1 implementation; `mock.ts` returns deterministic data so the whole engine runs with **no
   API keys** (critical for dev, CI, and the demo). New suppliers slot in behind the interface.
4. **Search + scoring** (`src/search/`) — fan out to adapters, normalize to one `Offer` model,
   score against the brief + taste preferences (the "right kinds of places" logic).
5. **Booking + payment** (`src/booking/`) — Stripe PaymentIntent + Duffel order creation,
   idempotency keys, and a **hard human-confirm gate** before any money moves.
6. **Persistence** (`prisma/`) — trips, briefs, offers, orders, events, audit log.
7. **Credential vault** (`src/vault/`) — encrypted-at-rest tokens for connected services,
   scoped per brief, revocable — mirrors the permission gradient described in `faq.html`.

### The brief is the authorization boundary

A **Brief** is both the task spec *and* the scope of authority: budget cap, place types,
dates, party, hard constraints, and a `bookingMode` (`propose_only` | `confirm_each` |
`auto_within_brief`). Every booking action is policy-checked against the active brief before
it can execute. This is the safety spine — money never moves outside the brief.

### Why money is the hard part

Finding deals is read-only and cheap to iterate. *Finishing a purchase* is irreversible,
regulated, and acts in the user's name. So booking gets: idempotency keys, a confirm gate,
a full audit log (the "every action is written to the audit log" promise in `admin.html`),
and a real Pause/Resume that halts the agent mid-loop (the demo's Pause button, made real).

---

## Milestone ladder (the "big chunks")

| # | Chunk | Outcome | Status |
|---|-------|---------|--------|
| 0 | **Foundation** | `/engine` scaffold: Node+TS+Fastify, config, health, event bus, SSE, mock supplier, runs locally, smoke test green | ✅ done |
| 1 | **Deal search (read-only)** | Duffel adapter (flights + stays) in test mode, normalized `Offer` model, scoring v1, `/search` endpoints. No booking. | ✅ core done |
| 2 | **Agent loop** | Claude tool-use orchestrator: brief → search → score → **propose a plan**. Streams real events to SSE. Still no booking. | ✅ done |
| 3 | **Booking + payment** | Booking state machine, **human-confirm gate**, idempotency, audit log, policy/budget enforcement, mock payment + mock supplier `book()` end-to-end. Stripe charge + Duffel order are deploy-time leaves. Deploy scaffolding (Dockerfile/fly.toml/DEPLOY.md) shipped. | ✅ core done |
| 4 | **Connected services & permissions** | Credential vault; scoped grants matching the demo's permission toggles; Gmail/calendar read for confirmations. Finishes the real Stripe charge (PaymentMethod/Customer). | → next |
| 5 | **Hiccup Handler** | Disruption detection + autonomous rebooking within standing instructions. | |
| 6 | **Hardening + prod deploy** | Postgres (persist bookings/audit), auth, rate limits, observability, `fly deploy`. Wire `v5/05-execution` to the live stream + `03-paste-trip` to `/plan`+`/book`. | |

Each chunk is independently runnable and leaves the engine in a working state.

---

## Running it (dev)

```bash
cd engine
npm install
cp .env.example .env      # works with NO keys — falls back to the mock supplier
npm run dev               # Fastify on :8787, tsx watch, no build step
# smoke test:
curl localhost:8787/health
curl -X POST localhost:8787/search -H 'content-type: application/json' \
  -d '{"origin":"SFO","destination":"HEL","departDate":"2026-09-12","returnDate":"2026-09-19","adults":2,"budgetUsd":3000,"placeTypes":["design-hotel","sauna"]}'
```

Add `DUFFEL_API_TOKEN` (test token) to `.env` to hit Duffel's real test API instead of the
mock. The engine auto-detects: token present → Duffel, absent → mock.
