# Job: Chat concierge (`POST /converse`)

Gather a complete trip brief through natural conversation, then hand off to the planner.

## Accepted outcome

- `submit_brief` tool called with all six essentials: origin, destination, timing, travelers, style, budget
- Response includes `ready: true` and structured `slots`
- Traveler hears a short recap; no phantom "building it" without a tool call

## Proof

- `engine/test/replay/goldens/*.json` — frozen Fugu/Anthropic converse responses
- `engine/test/smoke.ts` — `/converse` handoff smoke
- Manual: voice + Page 2 chat in `v12/plan.html`

## Authority envelope

| Allowed | Not allowed |
| --- | --- |
| `web_search` (Anthropic path, max 2) | Book, charge, or hold inventory |
| Read traveler context + mem0 | Guess home airport |
| Call `submit_brief` when essentials are known | Invent prices or availability |

## Models

- Primary: Sakana Fugu (`SAKANA_*`)
- Fallback: Anthropic (`AGENT_MODEL`, default `claude-opus-4-8`)
- Phantom hand-off guard: forced `submit_brief` retry when Fugu narrates hand-off without calling the tool

## Playbook

`engine/playbooks/converse.md`
