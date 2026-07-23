# Agent playbooks

Versioned system prompts for Tures concierge agents. Tool schemas stay in TypeScript; persona and rules live here so they can change without hunting through route files.

| File | Agent | Route / module |
| --- | --- | --- |
| `converse.md` | Trip chat concierge | `POST /converse` |
| `parse.md` | Brief extractor | `POST /parse` |
| `plan.md` | Inventory planner | `POST /plan` |
| `assist.md` | General help | `POST /assist` |
| `stagehand.md` | Browser executor | Action executor / Stagehand |

Job contracts (accepted outcome + proof) live in `jobs/`.

## Changing a prompt

1. Edit the `.md` file.
2. Run `npm run test:record-goldens` in `engine/` if you changed `converse.md` (golden replay fixtures).
3. Run `npm run smoke` and `npm run test:scenarios`.

Loaded at runtime by `engine/src/agent/playbooks.ts` (cached on first read).
