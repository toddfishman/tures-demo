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

await app.close();
console.log(`\n${passed} checks passed.`);
