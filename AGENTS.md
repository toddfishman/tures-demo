# Tures — agent guide

Start here when working on concierge agents, prompts, or evals. Product owner context: [`CLAUDE.md`](CLAUDE.md). Todd-facing comms: [`.cursor/rules/todd-communication.mdc`](.cursor/rules/todd-communication.mdc).

## Product spine

```
converse → parse → plan → hold → confirm → prove
```

| Step | What it does | Agent? |
| --- | --- | --- |
| Chat | Gather trip essentials | Yes — `/converse` |
| Parse | Prose → structured Brief | Yes — `/parse` |
| Plan | Search + propose flight/stay | Yes — `/plan` |
| Book | Policy + human confirm | **No LLM** — deterministic |
| Confirm | Charge + order (simulated until P6) | **No LLM** |

## Agent map

| Agent | Playbook | Job contract | Code |
| --- | --- | --- | --- |
| Chat concierge | [`engine/playbooks/converse.md`](engine/playbooks/converse.md) | [`jobs/converse.md`](engine/playbooks/jobs/converse.md) | `engine/src/routes/converse.ts` |
| Brief parser | [`engine/playbooks/parse.md`](engine/playbooks/parse.md) | — | `engine/src/agent/parse.ts` |
| Planner | [`engine/playbooks/plan.md`](engine/playbooks/plan.md) | [`jobs/plan.md`](engine/playbooks/jobs/plan.md) | `engine/src/agent/llm.ts` |
| General assist | [`engine/playbooks/assist.md`](engine/playbooks/assist.md) | — | `engine/src/routes/assist.ts` |
| Browser executor | [`engine/playbooks/stagehand.md`](engine/playbooks/stagehand.md) | — | `engine/src/actions/stagehand.ts` |

Prompts load via [`engine/src/agent/playbooks.ts`](engine/src/agent/playbooks.ts). Tool schemas stay in TypeScript.

## Model config

| Env var | Used by |
| --- | --- |
| `SAKANA_*` | Chat (Fugu fallback; Anthropic primary) |
| `AGENT_MODEL` | Parse, plan, converse fallback |
| `ASSIST_MODEL` | `/assist` (falls back to `AGENT_MODEL`) |
| `ACTION_MODEL` | Stagehand browser agent |

## Safety rules (never override without Todd)

- **Human confirms before money moves**
- **`bookingSimulated:true`** until P6 — no fake booked states
- **P6 live money** (`ALLOW_LIVE_BOOKING`, `STRIPE_CHARGE_CARDS`, live Duffel orders) — Todd explicit only
- Every booking step audit-logged

## Evals and proof

From `engine/`:

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/tsx/dist/cli.mjs test/smoke.ts
node node_modules/tsx/dist/cli.mjs test/run-scenarios.ts          # free tier
node node_modules/tsx/dist/cli.mjs test/run-scenarios.ts --llm    # live LLM (costs $)
node node_modules/tsx/dist/cli.mjs test/record-goldens.ts          # after converse prompt changes
```

CI: `.github/workflows/engine-test.yml` — typecheck + smoke + golden replay nightly.

## Improving agents (harness loop)

When changing agent behavior, use a bounded loop inspired by [Ryan Lopopolo's harness-engineering](https://github.com/lopopolo/harness-engineering):

1. **Baseline** — run the representative job (e.g. PDX → Cannon Beach chat handoff)
2. **Earliest gap** — find where the trajectory failed (missing tool call, wrong scope, etc.)
3. **Smallest fix** — edit the playbook or code at the owning boundary
4. **Verify** — native checks above + the user journey
5. **Retain or revert** — keep only if proof improves

Reference that repo as read-only context; Tures local truth (this guide, playbooks, tests) governs implementation.

## Front-end integration

- API client: `docs/assets/engine.js`
- Main flow: `docs/plan.html` (chat → parse → plan → book)
- Corner concierge: `docs/assets/concierge.js` (`/converse` or `/assist`)

Live engine: https://tures-engine.onrender.com/health

## Key files

| Topic | Path |
| --- | --- |
| Booking safety spine | `engine/src/booking/service.ts` |
| Chat + Fugu | `engine/src/routes/converse.ts`, `engine/src/agent/fugu.ts` |
| Plan orchestrator | `engine/src/agent/orchestrator.ts` |
| Scenario harness | `engine/test/scenarios/` |
| Launch checklist | `docs/LAUNCH.md` |
