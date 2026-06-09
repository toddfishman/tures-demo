// Smoke test — boots the engine in-process (no port) and exercises the Chunk 0/1 surface:
// health, a scored search, the planner, brief validation, and the SSE replay buffer.
// Runs with the mock supplier (no keys). `npm run smoke`.
import assert from "node:assert/strict";
import { build } from "../src/server.ts";
import { bus } from "../src/events/bus.ts";
import { encrypt, decrypt } from "../src/vault/crypto.ts";

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

const app = await build();

// 1. health
{
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.supplier, "mock"); // no DUFFEL_API_TOKEN in test env
  assert.equal(body.capabilities.search, true);
  ok("health reports ok + mock supplier");
}

// 2. search returns scored, sorted offers
const brief = {
  origin: "SFO",
  destination: "HEL",
  departDate: "2026-09-12",
  returnDate: "2026-09-19",
  adults: 2,
  budgetUsd: 6000,
  placeTypes: ["design-hotel", "sauna"],
};
let tripId = "";
{
  const res = await app.inject({ method: "POST", url: "/search", payload: brief });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  tripId = body.tripId;
  assert.ok(body.flights.length > 0, "has flights");
  assert.ok(body.stays.length > 0, "has stays");
  // sorted by score desc
  const scores = body.flights.map((o: any) => o.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), "flights sorted by score");
  // every offer scored with reasons array
  assert.ok(body.flights.every((o: any) => typeof o.score === "number"));
  // taste match surfaced on at least one stay
  assert.ok(
    body.stays.some((o: any) => (o.scoreReasons ?? []).some((r: string) => r.includes("design-hotel") || r.includes("sauna"))),
    "a stay matches placeTypes",
  );
  ok("search returns scored, sorted flights + stays with taste reasons");
}

// 3. event bus captured the search → score events for that trip
{
  const events = bus.replay(tripId);
  assert.ok(events.some((e) => e.kind === "search"), "emitted a search event");
  assert.ok(events.some((e) => e.kind === "score"), "emitted a score event");
  ok("execution events streamed to the bus");
}

// 4. planner proposes a plan within budget
{
  const res = await app.inject({ method: "POST", url: "/plan", payload: brief });
  assert.equal(res.statusCode, 200);
  const plan = res.json();
  assert.ok(plan.flight && plan.stay, "plan has a flight and a stay");
  assert.equal(plan.totalUsd, plan.flight.priceUsd + plan.stay.priceUsd, "total adds up");
  assert.equal(typeof plan.withinBudget, "boolean");
  assert.ok(plan.rationale.length > 0, "has a rationale");
  assert.equal(plan.planner, "deterministic", "no key in test → deterministic planner");
  ok("planner proposes flight + stay with a rationale (deterministic fallback)");
}

// 5. brief validation rejects garbage
{
  const res = await app.inject({ method: "POST", url: "/search", payload: { origin: "nope" } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_brief");
  ok("invalid brief rejected with 400 + issues");
}

// 5a. vault crypto: AES-256-GCM round-trips, ciphertext hides the plaintext, tampering fails
{
  const secret = JSON.stringify({ customerId: "cus_live", paymentMethodId: "pm_live" });
  const blob = encrypt(secret);
  assert.notEqual(blob, secret, "ciphertext differs from plaintext");
  assert.ok(!blob.includes("cus_live"), "plaintext not present in ciphertext");
  assert.equal(decrypt(blob), secret, "round-trips back to the original");
  const tampered = "A" + blob.slice(1);
  assert.throws(() => decrypt(tampered), "GCM auth tag rejects tampering");
  ok("vault crypto: AES-256-GCM round-trip + tamper detection");
}

// 5b. vault: connect two cards (a wallet) — redacted, grants payment:charge
let platConnId = "";
let csrConnId = "";
async function connectCard(label: string, cardKey: string, last4: string) {
  const res = await app.inject({
    method: "POST",
    url: "/connections",
    payload: { kind: "payment", label, secret: { customerId: "cus_x", paymentMethodId: "pm_" + cardKey }, meta: { last4, cardKey } },
  });
  assert.equal(res.statusCode, 200);
  return res.json();
}
{
  const plat = await connectCard("Amex Platinum", "amex_platinum", "1004");
  const csr = await connectCard("Chase Sapphire Reserve", "chase_sapphire_reserve", "7788");
  platConnId = plat.id;
  csrConnId = csr.id;
  assert.equal(plat.secretCipher, undefined, "secret never returned to client");
  assert.ok(plat.scopes.includes("payment:charge"), "payment grant present");
  const listed = (await (await app.inject({ method: "GET", url: "/connections" })).json()).connections;
  assert.ok(listed.every((x: any) => x.secretCipher === undefined), "list is redacted");
  ok("vault connects two cards (redacted) and grants payment:charge");
}

// 5c. wallet: best card differs by charge category (airfare → Platinum 5×, hotel → CSR 3×)
{
  const air = (await app.inject({ method: "GET", url: "/wallet/recommend?category=airfare&amount=5000" })).json();
  const hotel = (await app.inject({ method: "GET", url: "/wallet/recommend?category=hotel&amount=2000" })).json();
  assert.equal(air.name, "Amex Platinum", "Platinum wins airfare");
  assert.equal(hotel.name, "Chase Sapphire Reserve", "CSR wins hotel");
  ok("wallet picks the best card per category (airfare→Platinum, hotel→CSR)");
}

// 5d. traveler profile: save + read back masked, never leaking raw passport/KTN
{
  const save = await app.inject({
    method: "POST",
    url: "/profile",
    payload: { profile: { fullName: "Andy Traveler", passport: { number: "X1234567", country: "US" }, knownTravelerNumber: "TT12345678", memberships: [{ kind: "airline", program: "Finnair Plus", number: "FP998877", status: "Gold" }] } },
  });
  assert.equal(save.statusCode, 200);
  const c = save.json();
  assert.equal(c.secretCipher, undefined, "profile secret not returned");
  assert.ok(!JSON.stringify(c).includes("X1234567"), "raw passport never leaves the vault");
  assert.equal(c.meta.passportMasked, "••••4567", "passport is masked");
  assert.ok(c.meta.ktnOnFile, "KTN recorded");
  ok("traveler profile saves passport/KTN/memberships encrypted + masked");
}

// 6. booking gate: confirm_each opens the gate and charges NOTHING
let bookingId = "";
{
  const res = await app.inject({ method: "POST", url: "/book", payload: { brief } });
  assert.equal(res.statusCode, 200);
  const b = res.json();
  bookingId = b.id;
  assert.equal(b.status, "confirmation_required", "gate is open");
  assert.equal(b.charges.length, 0, "no charges before confirm");
  assert.ok(b.components.length >= 1, "has components staged");
  assert.ok(b.passenger && b.passenger.passportOnFile && b.passenger.ktnApplied, "passenger details attached from profile");
  assert.ok(b.audit.some((a: any) => a.action === "awaiting_confirmation"), "audit records the gate");
  ok("POST /book opens the confirm gate with no charge (passenger attached)");
}

// 7. confirm executes: per-card charges + PNRs + booked, with the wallet choosing per category
{
  const res = await app.inject({ method: "POST", url: `/book/${bookingId}/confirm` });
  assert.equal(res.statusCode, 200);
  const b = res.json();
  assert.equal(b.status, "booked");
  assert.equal(b.charges.length, 2, "one charge per component");
  assert.ok(b.charges.every((p: any) => p.status === "succeeded"), "all charges succeeded");
  const flight = b.components.find((c: any) => c.kind === "flight");
  const stay = b.components.find((c: any) => c.kind === "stay");
  assert.equal(flight.card.name, "Amex Platinum", "flight charged on the best airfare card");
  assert.equal(stay.card.name, "Chase Sapphire Reserve", "stay charged on the best hotel card");
  assert.ok(b.components.every((c: any) => c.status === "confirmed" && c.confirmation), "every component confirmed");
  assert.ok(b.audit.some((a: any) => a.action === "card_selected"), "audit records card selection");
  assert.ok(b.audit.some((a: any) => a.action === "booked"), "audit records booked");
  ok("confirm picks the best card per charge, books each component, writes the audit trail");
}

// 8. confirm is idempotent — same charges, no double charge
{
  const before = (await (await app.inject({ method: "GET", url: `/book/${bookingId}` })).json()).charges.map((p: any) => p.intentId).sort();
  const res = await app.inject({ method: "POST", url: `/book/${bookingId}/confirm` });
  const after = res.json();
  assert.equal(after.status, "booked");
  assert.deepEqual(after.charges.map((p: any) => p.intentId).sort(), before, "same intents — not re-charged");
  ok("re-confirming a booked trip is idempotent (no double charge)");
}

// 9. policy gate: over-budget booking is refused with 409, nothing charged
{
  const tinyBudget = { ...brief, budgetUsd: 100 };
  const res = await app.inject({ method: "POST", url: "/book", payload: { brief: tinyBudget } });
  assert.equal(res.statusCode, 409, "over-budget refused");
  const b = res.json();
  assert.equal(b.status, "failed");
  assert.ok(b.violations.some((v: string) => /budget/.test(v)), "violation cites budget");
  assert.equal(b.charges.length, 0, "nothing charged on a blocked booking");
  ok("over-budget booking blocked at the policy gate (409, no charge)");
}

// 10. auto_within_brief books immediately (no gate) when within budget
{
  const auto = { ...brief, bookingMode: "auto_within_brief" };
  const res = await app.inject({ method: "POST", url: "/book", payload: { brief: auto } });
  assert.equal(res.statusCode, 200);
  const b = res.json();
  assert.equal(b.status, "booked", "auto-booked without a gate");
  assert.ok(b.audit.some((a: any) => a.action === "auto_book"), "audit records the auto-book decision");
  ok("auto_within_brief books immediately within budget");
}

// 11. idempotencyKey: a duplicate POST /book returns the same booking
{
  const key = "idem-test-key-123456";
  const a = (await app.inject({ method: "POST", url: "/book", payload: { brief, idempotencyKey: key } })).json();
  const b = (await app.inject({ method: "POST", url: "/book", payload: { brief, idempotencyKey: key } })).json();
  assert.equal(a.id, b.id, "same idempotency key → same booking");
  ok("duplicate /book with same idempotencyKey is deduped");
}

// 12. revoking all payment methods blocks new bookings at the policy gate
{
  await app.inject({ method: "POST", url: `/connections/${platConnId}/revoke` });
  const rev = await app.inject({ method: "POST", url: `/connections/${csrConnId}/revoke` });
  assert.equal(rev.json().status, "revoked");
  const res = await app.inject({ method: "POST", url: "/book", payload: { brief } });
  assert.equal(res.statusCode, 409, "no payment method → blocked");
  assert.ok(res.json().violations.some((v: string) => /payment method/.test(v)), "violation cites payment method");
  ok("revoking all payment methods immediately blocks new bookings");
}

await app.close();
console.log(`\n${passed} checks passed.`);
