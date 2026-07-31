# Memory 2.0 — structured Household / Traveler memory

**Status:** design (approved direction, not yet built)
**Author:** launch-audit session, 2026-07-31
**One line:** Tures should remember *who you are* (your household + constraints), not just *how you like to travel* (Taste Engine). Books inside your taste **and** knows your people.

---

## 1. Why

Today the brief parses `adults`/`children` per trip and throws them away. `profile/prefs.ts`
stores taste/cabin/dietary — **no people**. So every trip re-asks who's coming, and "two boys,
10 and 8" only survives as mem0's fuzzy, non-deterministic guess. This is the ~60% of the
concierge promise that doesn't exist yet, and it's the stickiest, most defensible layer:
a structured household is exactly what a search box can't hold.

**Two memory layers, only one exists:**
- **Taste Print = STYLE** (pace, register, aesthetic) — exists (`engine/src/taste/`). Auto-learned.
- **Household = FACTS** (who travels, ages, home base, constraints) — **this doc.** Confirmed, not guessed.

## 2. Target experience

> **You:** "5 days on Maui in June for me, my wife, and our two boys, 10 and 8."
> **Tures:** "Got it — a family trip. Want me to remember **Sam (10) & Ben (8)** so I don't ask every time?" → yes
>
> *Months later:*
> **You:** "Tahoe over spring break."
> **Tures:** "You + Sam & Ben again? I'll look for a 2-bed with a kitchen, skip adults-only resorts,
> keep it near beginner runs — and price around your district's 3/14–3/21 break."

## 3. Decisions taken (defaults; revisit with Todd)

- **Capture = confirm identifying facts, auto-learn soft prefs.** People/ages/DOB are only stored
  after the user confirms ("Remember Sam (10) & Ben (8)?"). Non-identifying style preferences keep
  flowing through the existing Taste Engine (already auto-learns from bookings/swaps). Never
  silently store a named person. Matches the Vault + Taste "it's your data" posture.
- **MVP = party-aware planning + remember/confirm.** Nail the scenario end to end. Booking passenger-
  manifest pre-fill is Phase 2.
- **Storage = encrypted Vault, redacted to planner.** Names/DOB (esp. minors') are PII → live in the
  encrypted `traveler_profile`, not plain `prefs`. Planner sees only a redacted party summary.

## 4. Data model

Household roster per account. Full records encrypted (Vault); a redacted derived view feeds planning.

```ts
// New: profile/household.ts (PII → encrypted alongside traveler_profile)
interface HouseholdMember {
  id: string;
  relationship: "self" | "spouse" | "partner" | "child" | "parent" | "companion" | "pet";
  firstName?: string;          // PII — encrypted, never shown to planner
  lastName?: string;           // PII
  dob?: string;                // PII — planner sees derived age only
  dietary?: string[];          // e.g. ["nut allergy", "vegetarian"]
  ktn?: string;                // optional, for manifest (Phase 2)
  loyalty?: { program: string; number: string }[]; // optional (Phase 2)
  notes?: string;
  confirmed: boolean;          // true only after the user said yes
  source: "chat" | "onboarding" | "vault" | "booking"; // how learned
  createdAt: string; updatedAt: string;
}

interface Household {
  members: HouseholdMember[];
  homeAirport?: string;        // may already live in vault "travel basics" — reconcile
  datesToAvoid?: { label: string; start: string; end: string; recurring?: boolean }[]; // e.g. school calendar
  defaultPartyIds?: string[];  // who usually travels — powers "same crew?"
}
```

**Redacted view the planner sees (no raw names):**
```ts
interface PartySummary {
  adults: number; children: number;
  childAges: number[];          // [10, 8]
  hasPets: boolean;
  dietary: string[];            // union across the party
  travelingAs: "solo" | "couple" | "family" | "group";
}
```

## 5. Capture flow (extract → confirm → store)

1. In `routes/converse.ts`, after each user turn, run a **household extractor** (new
   `agent/household-extract.ts`, or extend `agent/parse.ts`) that spots people/ages/pets/dietary/
   home-airport/dates-to-avoid. Cheap + deterministic where possible; LLM-assisted for names/ages.
2. For **identifying** facts, do NOT store. Emit a **confirm proposal** in the converse response
   (a chip/quick-reply): *"Remember Sam (10) & Ben (8)?"* → `[Yes] [Not now] [Edit]`.
3. On yes → write confirmed `HouseholdMember`s to the encrypted store.
4. mem0 may *surface a candidate* to this loop, but the structured store is the source of truth.

## 6. Apply flow (the payoff)

- `agent/context.ts → assembleContext` gains a `PartySummary` and a prose line:
  *"Traveling as a family: 2 adults + 2 children (ages 10, 8); one nut allergy."*
- Scorer/planner uses it: kid-friendly filter, skip adults-only, room config (2-bed / connecting for
  a family of 4), timing around `datesToAvoid`, per-traveler dietary. Low-confidence → soft weight,
  never a hard exclude (mirror the Taste Engine's "neutral when unsure" rule).
- **"Same crew?" prompt:** at plan time, if the brief omits travelers and `defaultPartyIds` exists,
  Tures asks *"You + Sam & Ben again?"* instead of re-asking cold.
- Reconcile with the brief: the brief's per-trip `travelers`/`adults`/`children` still win for THIS
  trip; the household is the default and the place new people get offered for saving.

## 7. Phase 2+ (not MVP)

- **Booking manifest pre-fill:** at book time, auto-fill every traveler's name/DOB/KTN from the
  household (`booking/service.ts` passenger step) → one-tap checkout; per-traveler loyalty crediting.
- **School-calendar dates-to-avoid** with district lookup.
- **Enterprise roster:** the same model = a company traveler list → duty of care ("who's traveling,
  are they safe"), per-traveler policy, expense allocation. The #1 enterprise wedge, nearly free.

## 8. UX surfaces

- **Onboarding** (`docs/onboard.html`): new optional *"Your people"* accordion step.
- **Vault** (`docs/vault.html`): a *"Who travels with you"* section — add/edit/revoke each person,
  same tokenized/revocable treatment as passport.
- **Plan chat** (`docs/plan.html` + `docs/assets/*`): the confirm chips + "same crew?" prompt.

## 9. Files to touch (build map)

| Area | File |
|------|------|
| Household store (PII, encrypted) | `engine/src/profile/household.ts` (new) + wire into `profile/index.ts` |
| Redacted party summary | `engine/src/profile/index.ts` (extend `getTravelerProfileRedacted`) |
| Fold into planning | `engine/src/agent/context.ts` (`assembleContext` → `PartySummary` + prose) |
| Extract + confirm loop | `engine/src/routes/converse.ts` + `engine/src/agent/household-extract.ts` (new) |
| Types | `engine/src/types.ts` (Brief already has `adults`/`children`) |
| Routes | `engine/src/routes/household.ts` (new — CRUD, session-scoped like prefs/travelers) |
| Front-end | `docs/onboard.html`, `docs/vault.html`, `docs/plan.html` + assets |
| Tests | extend `engine/test/smoke.ts` (capture→confirm→apply) |

## 10. Open questions

- **Minors' data (legal).** Storing children's names/DOB → COPPA/GDPR-K considerations. Entered by the
  adult account holder about their own dependents, but flag for legal review before launch. Consider
  storing **age band** instead of exact DOB when the manifest doesn't need it.
- **Home airport** may already exist in the Vault "travel basics" — reconcile, don't duplicate.
- **Pets** — how far to model (service animal vs. pet-friendly filter) — start with a boolean.
- **Multiple households / trip-specific crews** (kids from two homes, friends' trips) — v1 assumes one
  household + per-trip override via the brief; revisit if users need named groups.
