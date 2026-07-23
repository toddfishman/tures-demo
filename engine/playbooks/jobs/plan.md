# Job: Trip planner (`POST /plan`)

Search real inventory and propose one flight + one stay that fits the brief and traveler context.

## Accepted outcome

- `propose_plan` called with flight/stay ids from search results
- Rationale explains why picks fit this traveler
- `withinBudget` reflects hard cap when set
- SSE stream shows search + propose steps

## Proof

- `engine/test/smoke.ts` — plan endpoint returns flight + stay
- `engine/test/scenarios/catalog.ts` — deterministic discover/parse scenarios (planner goldens TBD)
- Deterministic fallback when `ANTHROPIC_API_KEY` unset (top scored offers)

## Authority envelope

| Allowed | Not allowed |
| --- | --- |
| `search_offers`, `propose_plan` | Book, charge, or confirm |
| Honor brief budget cap and cabin prefs | Exceed stated hard budget |

## Models

- Anthropic agent loop (`AGENT_MODEL`, max 6 turns)
- Fallback: deterministic planner in `agent/orchestrator.ts`

## Playbook

`engine/playbooks/plan.md`
