# tures-engine

The agentic booking engine behind the Tures demo. See [`PLAN.md`](./PLAN.md) for the full
architecture and the chunk-by-chunk roadmap.

**Status:** Chunk 0 (foundation) ✅ · Chunk 1 (deal search) 🔨 core in place · Chunk 2 (agent loop) planner stub in place.

## Run it

```bash
npm install
cp .env.example .env     # optional — runs with NO keys via the mock supplier
npm run dev              # Fastify on http://localhost:8787 (tsx watch, no build step)
```

```bash
npm run smoke            # in-process smoke test, mock supplier, no keys
npm run typecheck        # tsc --noEmit
```

## API (current)

| Method | Route | Does |
|--------|-------|------|
| GET | `/health` | Service + which supplier/capabilities are live |
| POST | `/search` | Validate a brief → scored, ranked flights + stays. Read-only. |
| POST | `/plan` | Search → score → **propose** a flight + stay within budget. Proposes only. |
| GET | `/stream/:tripId` | Server-Sent Events: the live execution stream for a trip. |

Example:

```bash
curl -X POST localhost:8787/plan -H 'content-type: application/json' -d '{
  "origin":"SFO","destination":"HEL",
  "departDate":"2026-09-12","returnDate":"2026-09-19",
  "adults":2,"budgetUsd":6000,
  "placeTypes":["design-hotel","sauna"],
  "cabin":"business"
}'
```

## Going live with Duffel

Put a Duffel **test** token (`duffel_test_…`) in `.env` as `DUFFEL_API_TOKEN`. The engine
auto-switches from the mock supplier to real Duffel flight offers. Booking that moves money
arrives in Chunk 3 behind a human-confirm gate.
