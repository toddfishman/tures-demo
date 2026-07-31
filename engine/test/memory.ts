// Memory 2.0 (Phase 1) — household extract → confirm → party-aware planning.
// Boots the engine in-process (mock, no keys). Run: tsx test/memory.ts
import assert from "node:assert/strict";
import { build } from "../src/server.ts";
import { extractHousehold } from "../src/agent/household-extract.ts";
import { assembleContext } from "../src/agent/context.ts";

let passed = 0;
const ok = (n: string) => { passed++; console.log(`  ✓ ${n}`); };

// ── 1. extractor (pure): the exact scenario ──
{
  const p = extractHousehold("5 days on Maui in June for me, my wife, and our two boys, 10 and 8, from Seattle.");
  const kids = p.filter((x) => x.relationship === "child");
  assert.ok(p.some((x) => x.relationship === "spouse"), "spotted a spouse");
  assert.equal(kids.length, 2, "spotted two children");
  assert.deepEqual(kids.map((k) => k.age).sort((a, b) => (b ?? 0) - (a ?? 0)), [10, 8], "children ages 10 and 8");
  ok("extractor: 'my wife, and our two boys, 10 and 8' → spouse + child(10) + child(8)");
}
{
  const p = extractHousehold("just me and a 6 year old");
  const kids = p.filter((x) => x.relationship === "child");
  assert.equal(kids.length, 1, "one child");
  assert.equal(kids[0]?.age, 6, "age 6");
  ok("extractor: 'a 6 year old' → one child, age 6");
}
{
  const p = extractHousehold("my husband and I want a quiet week, adults only");
  assert.ok(p.some((x) => x.relationship === "spouse"), "spouse");
  assert.equal(p.filter((x) => x.relationship === "child").length, 0, "no children invented");
  ok("extractor: no false-positive children for an adults-only couple");
}

// ── endpoints + planning ──
const app = await build();
const su = (await app.inject({ method: "POST", url: "/auth/signup", payload: { email: `mem_${Date.now()}@b.com`, name: "Parent", password: "password123" } })).json();
const auth = { authorization: "Bearer " + su.token };
const accountId: string = su.user.id;

// ── 2. extract endpoint proposes, stores nothing ──
{
  const res = await app.inject({ method: "POST", url: "/household/extract", headers: auth, payload: { text: "me, my wife, and our two boys 10 and 8" } });
  assert.equal(res.statusCode, 200);
  const { proposals } = res.json();
  assert.equal(proposals.filter((p: any) => p.relationship === "child").length, 2, "proposes two kids");
  const before = (await app.inject({ method: "GET", url: "/household/summary", headers: auth })).json().party;
  assert.equal(before.children, 0, "nothing stored yet — proposal only, no silent save");
  ok("POST /household/extract proposes people but stores nothing (confirm-first)");
}

// ── 3. remember (confirm) → saved, party reflects it ──
{
  const res = await app.inject({
    method: "POST", url: "/household/remember", headers: auth,
    payload: { members: [
      { relationship: "spouse", fullName: "Alex" },
      { relationship: "child", age: 10, fullName: "Sam", dietary: ["nut allergy"] },
      { relationship: "child", age: 8, fullName: "Ben" },
    ] },
  });
  assert.equal(res.statusCode, 200);
  const party = res.json().party;
  assert.equal(party.adults, 2, "self + spouse = 2 adults");
  assert.equal(party.children, 2, "two children");
  assert.deepEqual(party.childAges, [10, 8], "child ages high→low");
  assert.equal(party.travelingAs, "family", "reads as a family");
  assert.ok(party.dietary.includes("nut allergy"), "companion dietary surfaced");
  ok("POST /household/remember saves the confirmed crew; party = family of 4, kids 10 & 8");
}

// ── 4. planning is party-aware (assembleContext prose) ──
{
  const parsed = (await app.inject({ method: "POST", url: "/parse", payload: { text: "Tahoe for a long weekend, oceanfront-ish, mid budget." } })).json();
  const { context } = assembleContext(accountId, parsed.brief);
  assert.ok(/household on file/i.test(context.prose), "prose mentions the household");
  assert.ok(/child|family/i.test(context.prose), "prose flags kids/family for the planner");
  assert.ok(/ages 10, 8/.test(context.prose), "prose carries the kids' ages");
  assert.ok(/nut allergy/i.test(context.prose), "prose carries dietary across the party");
  assert.equal(context.party.travelingAs, "family", "context.party is available to the scorer");
  ok("assembleContext: the planner now reasons on the household (kids, ages, dietary)");
}

// ── 5. redaction: raw child DOB never leaks to the planner view ──
{
  const listed = (await app.inject({ method: "GET", url: "/travelers", headers: auth })).json().travelers;
  const child = listed.find((t: any) => t.meta?.relationship === "child");
  assert.ok(child, "child is listed");
  assert.equal(child.meta.age, 10, "age is exposed for planning");
  assert.equal(child.secretCipher, undefined, "the encrypted secret (exact DOB/PII) is never returned");
  ok("redaction: planner sees age, never the raw secret");
}

console.log(`\n${passed} Memory 2.0 checks passed.`);
