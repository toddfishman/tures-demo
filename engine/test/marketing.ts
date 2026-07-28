// Marketing Agent test — boots the engine in-process (no keys → template brain, simulated
// channels) and exercises the growth loop: brand check word-boundaries, create → human-confirm
// gate → approve → loop (measure/kill/scale), the no-fake-success labeling, the budget cap
// invariant, auto_within_budget, and the ownership guard. `npx tsx test/marketing.ts`.
import assert from "node:assert/strict";
import { build } from "../src/server.ts";
import { brandCheck } from "../src/marketing/brand.ts";

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

const app = await build();

// 1. brand check matches on WORD BOUNDARIES, and fails real promise-breaking claims
{
  // hype word "magic" must NOT trip on "magical"; proof word earns voice score
  const clean = brandCheck("Tures", { headline: "A magical week in Kyoto", body: "Tures books every leg and sends back confirmation numbers.", cta: "Plan a trip" });
  assert.equal(clean.pass, true, "clean copy passes");
  assert.ok(clean.violations.length === 0, "no violations");
  assert.ok(clean.score >= 0.7, "proof word lifts the voice score");

  // fake-success / broken-promise claims are hard fails
  const fake = brandCheck("Tures", { headline: "Guaranteed cheapest flights", body: "We book it automatically, no confirmation needed.", cta: "Click here" });
  assert.equal(fake.pass, false, "fake-success + click-here fails");
  assert.ok(fake.violations.some((v) => /guaranteed/.test(v)), "flags the guarantee");
  assert.ok(fake.violations.some((v) => /click here/.test(v)), "flags the link CTA");
  ok("brand check: word-boundary matching + fails promise-breaking claims");
}

// 2. capabilities are public and honest about simulation
{
  const res = await app.inject({ method: "GET", url: "/marketing/capabilities" });
  assert.equal(res.statusCode, 200);
  const c = res.json();
  assert.equal(c.enabled, true);
  assert.equal(c.live, false, "no live switch in test");
  assert.equal(c.simulated, true);
  assert.ok(/[Ss]imulated/.test(c.note), "note says simulated");
  ok("marketing capabilities public + labeled simulated");
}

// 3. create opens the human-confirm gate — nothing published, no spend
let campaignId = "";
{
  const res = await app.inject({ method: "POST", url: "/marketing", payload: { objective: "signups", audience: "people who plan their own trips", budgetDailyUsd: 30 } });
  assert.equal(res.statusCode, 200);
  const c = res.json();
  campaignId = c.id;
  assert.equal(c.status, "confirmation_required", "gate is open");
  assert.ok(c.research.length > 0, "research produced pain points");
  assert.ok(c.creatives.length > 0, "creatives generated");
  assert.ok(c.creatives.every((cr: any) => cr.status === "proposed" || cr.status === "rejected"), "nothing live before approval");
  assert.ok(c.creatives.every((cr: any) => cr.metrics.impressions === 0), "no metrics before launch");
  assert.equal(c.simulated, true, "campaign is simulated");
  assert.ok(c.audit.some((a: any) => a.action === "awaiting_confirmation"), "audit records the gate");
  ok("create researches + generates on-brand creatives and stops at the confirm gate");
}

// 4. approve launches (simulated) — sample-labeled externalIds, no real spend claimed
{
  const res = await app.inject({ method: "POST", url: `/marketing/${campaignId}/approve` });
  assert.equal(res.statusCode, 200);
  const c = res.json();
  assert.equal(c.status, "running");
  const live = c.creatives.filter((cr: any) => cr.status === "live");
  assert.ok(live.length > 0, "creatives went live");
  assert.ok(live.every((cr: any) => cr.simulated === true), "every launch is simulated");
  assert.ok(live.every((cr: any) => cr.metrics.simulated === true), "metrics flagged simulated");
  const activeBudget = live.reduce((s: number, cr: any) => s + cr.budgetDailyUsd, 0);
  assert.ok(activeBudget <= c.budgetDailyUsd + 0.01, "active budget within the cap");
  assert.ok(c.audit.some((a: any) => a.action === "creative_simulated"), "audit says simulated launch");
  ok("approve launches simulated, sample-labeled, within budget cap");
}

// 5. loop measures, then kills losers / scales winners — always within the cap
{
  let c: any;
  for (let i = 0; i < 4; i++) {
    c = (await app.inject({ method: "POST", url: `/marketing/${campaignId}/run` })).json();
  }
  assert.ok(c.loops >= 4, "ran several loop passes");
  const active = c.creatives.filter((cr: any) => cr.status === "live" || cr.status === "scaled");
  const activeBudget = active.reduce((s: number, cr: any) => s + cr.budgetDailyUsd, 0);
  assert.ok(activeBudget <= c.budgetDailyUsd + 0.01, "still within the daily cap after optimizing");
  const killedOrScaled = c.creatives.some((cr: any) => cr.status === "killed" || cr.status === "scaled");
  assert.ok(killedOrScaled, "optimizer killed a loser or scaled a winner");
  assert.ok(c.creatives.every((cr: any) => cr.metrics.simulated === true), "all metrics stay simulated");
  ok("loop optimizes (kill/scale) while holding the budget cap");
}

// 6. auto_within_budget on a simulated campaign launches without a separate approval
{
  const res = await app.inject({ method: "POST", url: "/marketing", payload: { budgetDailyUsd: 20, mode: "auto_within_budget" } });
  const c = res.json();
  assert.equal(c.status, "running", "auto-published on create (simulated)");
  assert.ok(c.audit.some((a: any) => a.action === "auto_publish"), "audit records the auto decision");
  ok("auto_within_budget launches immediately on a simulated campaign");
}

// 7. budget over the cap is refused
{
  const res = await app.inject({ method: "POST", url: "/marketing", payload: { budgetDailyUsd: 100000 } });
  assert.equal(res.statusCode, 400, "over-cap budget rejected");
  ok("budget over the daily cap is refused");
}

// 8. ownership guard — another account can't see or approve someone's campaign (404, no enumeration)
{
  const A = (await app.inject({ method: "POST", url: "/auth/signup", payload: { email: "grow-a@b.com", password: "password123" } })).json();
  const B = (await app.inject({ method: "POST", url: "/auth/signup", payload: { email: "grow-b@b.com", password: "password123" } })).json();
  const authA = { authorization: "Bearer " + A.token };
  const authB = { authorization: "Bearer " + B.token };
  const c = (await app.inject({ method: "POST", url: "/marketing", headers: authA, payload: { budgetDailyUsd: 10 } })).json();
  assert.equal((await app.inject({ method: "GET", url: `/marketing/${c.id}`, headers: authB })).statusCode, 404, "B can't read A's campaign");
  assert.equal((await app.inject({ method: "POST", url: `/marketing/${c.id}/approve`, headers: authB })).statusCode, 404, "B can't approve A's campaign");
  assert.equal((await app.inject({ method: "GET", url: `/marketing/${c.id}`, headers: authA })).statusCode, 200, "A can read its own");
  ok("ownership guard: a second account can't touch another's campaign (404)");
}

// 9. health surfaces the marketing agent + its simulated state
{
  const h = (await app.inject({ method: "GET", url: "/health" })).json();
  assert.equal(h.capabilities.marketingAgent, true, "capability reported");
  assert.equal(h.capabilities.marketingSimulated, true, "simulated until MARKETING_LIVE");
  assert.equal(h.marketing.live, false);
  ok("health reports the marketing agent + simulated state");
}

await app.close();
console.log(`\n${passed} checks passed.`);
