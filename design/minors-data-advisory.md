# Minors' data — privacy/compliance advisory (Memory 2.0)

**⚠️ Not legal advice.** This is a practical engineering/privacy checklist to reduce risk and inform
design. Before Tures stores real children's data for real bookings, have a qualified privacy lawyer
review the approach for your specific markets.

## Why this matters
Memory 2.0 can store a child's **name + age/DOB + dietary needs** (e.g. "Sam, 8, nut allergy") so
Tures plans family trips. That's personal data about minors — regulated more strictly than adult data.

## The two regimes that matter first
- **COPPA (US, children under 13).** COPPA governs data collected **from** a child by an online
  service directed to children. Tures is a service for **adults**, and the parent enters data **about
  their own kids** — that is materially different from collecting from the child. But storing minors'
  identifiers still deserves care (security, minimization, parental control). Do not market to kids.
- **GDPR-K / UK-GDPR (EU/UK).** Children's data is "sensitive by context." The child's age of digital
  consent varies by country (13–16). Data-minimization and purpose-limitation are hard requirements;
  dietary info can be **health data** (special category) needing extra basis/care.

## Design decisions that de-risk it (do these regardless of jurisdiction)
1. **Minimize: store age-band, not exact DOB, until a booking actually needs it.**
   The planner only needs "there's an 8-year-old" — an approximate age is enough. Keep the **exact
   DOB only when a manifest requires it**, entered/confirmed at booking time, and stored encrypted.
   → *Phase 1 already does the redacted side (planner sees age, never raw DOB). Phase 2 should keep
   exact DOB out of the household record; collect it just-in-time at the manifest step.*
2. **Parent-entered + confirm-first.** Never silently profile a child; the adult account holder
   explicitly adds/confirms each person (already true in Phase 1).
3. **Encrypt + tokenize** minors' identifiers exactly like the adult's (already true — `traveler`
   connections are encrypted).
4. **Easy deletion.** One-tap remove per person, and "wipe household" — honor deletion promptly.
   (Phase 1 has per-person remove; add a bulk wipe.)
5. **Dietary = treat as health-adjacent.** Keep it optional, minimized, and clearly purpose-bound
   ("used to pick restaurants/meals for this trip").
6. **No third-party sharing / no ad use** of minors' data. Only used to plan the family's own trips.
7. **Access control.** Only the owning account can read its household (Phase 1 enforces this via the
   ownership guard; keep it airtight).

## Recommendation for Phase 2
- **Household record stores: relationship, first name (optional), age-band/approx age, dietary
  (optional).** NOT exact DOB.
- **Exact DOB + passport/KTN for a minor are collected at the manifest step**, per trip, confirmed by
  the parent, encrypted, and not retained in the standing household unless the user opts in.
- Add a **"forget this person" / "wipe household"** control and a short in-product line on what's
  stored and why.
- **Gate:** before enabling **real** (live-money) bookings that transmit minors' PII to suppliers,
  get a lawyer's sign-off + a short privacy notice covering children's data.

## Bottom line
Phase 1's posture (parent-entered, confirm-first, encrypted, age-not-DOB to the planner) is already
well-aligned. The main Phase 2 rule: **don't persist exact child DOB in the standing household —
collect it just-in-time at booking.** Then a legal review before real bookings.
