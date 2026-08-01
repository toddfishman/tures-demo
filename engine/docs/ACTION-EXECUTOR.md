# Action Executor — browser automation + human handoff

**Status:** wired (2026-07-08) — Browserbase + Stagehand v3 execute permissioned actions; human handoff for CAPTCHA/login/OTP.

Tures already **researches** (`/assist` + Anthropic `web_search`) and **books via APIs** (Duffel, Stripe, vault). The Action Executor is the third leg: **do things on sites with no API** — log into an airline, finish a refund form, grab a confirmation — under explicit permission and with a beautiful human step when automation cannot proceed alone.

---

## Stack (live)

| Layer | Choice | Role |
|-------|--------|------|
| **Cloud browsers** | [Browserbase](https://browserbase.com) | Sessions, live view, CAPTCHA assist, replay |
| **Agent framework** | [Stagehand v3](https://stagehand.dev) | Natural-language `agent.execute()` on CDP (no separate Playwright install) |
| **LLM for agent** | Anthropic via `ACTION_MODEL` | Uses existing `ANTHROPIC_API_KEY` |
| **Research (existing)** | Anthropic `web_search` | Read-only facts — **not** browser automation |
| **Credentials** | Vault (`/connections`, `/profile`) | Next: inject into sessions — not in prompts |
| **Notify** | Telegram + handoff page | Reach traveler when human needed |

---

## Permission catalog

Extends `/assist/permissions`:

| Key | Label | Browser? |
|-----|-------|----------|
| `act:research` | Look things up (web search) | No |
| `act:contact` | Contact someone on your behalf | Maybe |
| `act:fill_forms` | Fill/submit paperwork | Yes |
| `act:reserve` | Make a reservation | API or browser |
| `act:purchase` | Spend money to resolve | API or browser |
| `act:browser_login` | Sign in to a site as you (vault creds) | Yes |
| `act:browser_navigate` | Browse/read a logged-in page | Yes |

Grants are **scoped** (domain, trip, expiry) and **revocable** — stored per account in `action_grants`.

---

## Run state machine

```
proposed → granted → running → [completed | failed | needs_human]
                                    ↑              |
                                    └── continue ──┘ (after handoff)
```

**`needs_human`** triggers:
- CAPTCHA / bot check Browserbase cannot auto-solve
- OTP / 2FA / “confirm on your phone”
- Ambiguous UI (“Is this you?”)
- Policy: spend over threshold even with grant

---

## Human handoff flow

```
1. Action hits wall → engine sets run.status = needs_human
2. Creates HandoffRequest { reason, liveViewUrl, instructions, expiresAt }
3. Notifies: SSE on trip stream, Telegram message, in-app card
4. Traveler opens v12/handoff.html?id=…
5. Page shows: what Tures needs · why · “Open session” · “I'm done”
6. Traveler completes CAPTCHA/login in Browserbase live view (or local CDP in dev)
7. POST /actions/handoff/:id/continue → automation resumes
8. Final: confirmation screenshot + audit entry (no fake success)
```

---

## Env knobs

```
BROWSERBASE_API_KEY=
BROWSERBASE_PROJECT_ID=
ACTION_MODEL=anthropic/claude-sonnet-4-6
```

Uses `ANTHROPIC_API_KEY` already on Render for Stagehand. Without Browserbase keys: simulated handoff UX. Without Anthropic: Browserbase sessions only, no agent.

---

## API surface (engine)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/actions/permissions` | Catalog |
| GET | `/actions/grants` | Account grants |
| POST | `/actions/grants` | Grant permission (scoped) |
| POST | `/actions/grants/:id/revoke` | Revoke |
| POST | `/actions/run` | Start run (requires grant) |
| GET | `/actions/runs/:id` | Status + audit |
| GET | `/actions/handoff/:token` | Handoff page data (signed token) |
| POST | `/actions/handoff/:token/continue` | Human finished |
| POST | `/actions/handoff/:token/abort` | Cancel |

---

## Front-end

- **`v12/handoff.html`** — human step UI (mobile-first, calm, no anxiety copy)
- **`engine.js`** — `actions.grant()`, `actions.run()`, `actions.handoff()`
- **Concierge / plan thread** — card when handoff needed with deep link
- **Telegram** — “Tures needs you for 30 seconds → [link]”

---

## Phased build

1. **Done:** permissions + handoff + Browserbase + Stagehand agent + resume after handoff
2. **Next:** Vault credential injection (airline/hotel login from encrypted store)
3. **Then:** Assist UI grant/run from chat; session replay in My Trips

---

## What we are NOT building

- Headless scraping without permission
- Storing passwords in prompts or mem0
- Auto-running purchases on browser without confirm gate
- Claiming CAPTCHA is always solvable — human path must exist
