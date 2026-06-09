// Smoke test — boots the engine in-process (no port) and exercises the Chunk 0/1 surface:
// health, a scored search, the planner, brief validation, and the SSE replay buffer.
// Runs with the mock supplier (no keys). `npm run smoke`.
import assert from "node:assert/strict";
import { build } from "../src/server.ts";
import { bus } from "../src/events/bus.ts";

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

// 6. booking gate: confirm_each opens the gate and charges NOTHING
let bookingId = "";
{
  const res = await app.inject({ method: "POST", url: "/book", payload: { brief } });
  assert.equal(res.statusCode, 200);
  const b = res.json();
  bookingId = b.id;
  assert.equal(b.status, "confirmation_required", "gate is open");
  assert.equal(b.payment, undefined, "no payment before confirm");
  assert.ok(b.components.length >= 1, "has components staged");
  assert.ok(b.audit.some((a: any) => a.action === "awaiting_confirmation"), "audit records the gate");
  ok("POST /book opens the confirm gate with no charge");
}

// 7. confirm executes: payment + PNRs + booked
{
  const res = await app.inject({ method: "POST", url: `/book/${bookingId}/confirm` });
  assert.equal(res.statusCode, 200);
  const b = res.json();
  assert.equal(b.status, "booked");
  assert.ok(b.payment && b.payment.status === "succeeded", "payment succeeded");
  assert.ok(b.components.every((c: any) => c.status === "confirmed" && c.confirmation), "every component has a confirmation");
  assert.ok(b.audit.some((a: any) => a.action === "payment_charged"), "audit records the charge");
  assert.ok(b.audit.some((a: any) => a.action === "booked"), "audit records booked");
  ok("confirm charges once, books each component, writes the audit trail");
}

// 8. confirm is idempotent — same payment intent, no second charge
{
  const before = (await (await app.inject({ method: "GET", url: `/book/${bookingId}` })).json()).payment.intentId;
  const res = await app.inject({ method: "POST", url: `/book/${bookingId}/confirm` });
  const after = res.json();
  assert.equal(after.status, "booked");
  assert.equal(after.payment.intentId, before, "same intent — not re-charged");
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
  assert.equal(b.payment, undefined, "nothing charged on a blocked booking");
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

await app.close();
console.log(`\n${passed} checks passed.`);
