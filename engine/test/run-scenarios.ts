#!/usr/bin/env node
/**
 * Tures scenario runner — tiered intelligence tests (mock supplier, no real bookings).
 *
 *   npm run test:scenarios              # deterministic + replay ($0)
 *   npm run test:scenarios -- --tag=transfer
 *   npm run test:scenarios -- --llm       # live Sakana/Claude converse (costs $)
 *   npm run test:record-goldens         # refresh replay fixtures from live LLM
 */
import { build } from "../src/server.ts";
import { parseBrief } from "../src/agent/parse.ts";
import { config } from "../src/config.ts";
import { listSessionTranscript } from "../src/conversation-log.ts";
import { loadGolden } from "./lib/replay.ts";
import { SCENARIOS } from "./scenarios/catalog.ts";
import type { Scenario, ScenarioResult, ScenarioTier } from "./scenarios/types.ts";

const args = process.argv.slice(2);
const tierFilter = args.find((a) => a.startsWith("--tier="))?.split("=")[1] as ScenarioTier | undefined;
const tagFilter = args.find((a) => a.startsWith("--tag="))?.split("=")[1];
const includeLlm = args.includes("--llm") || args.includes("--all");

function hasLlmKeys(): boolean {
  return !!(config.anthropicKey || config.sakana.enabled);
}

function includesAll(hay: string, needles: string[]): boolean {
  const h = hay.toLowerCase();
  return needles.every((n) => h.includes(n.toLowerCase()));
}

function excludesAll(hay: string, needles: string[]): boolean {
  const h = hay.toLowerCase();
  return needles.every((n) => !h.includes(n.toLowerCase()));
}

async function runDeterministicParse(sc: Scenario, errors: string[]): Promise<void> {
  const ex = sc.parse!;
  const result = await parseBrief(ex.text, { heuristic: true });
  const b = result.brief;
  for (const [k, v] of Object.entries(ex.brief)) {
    const got = (b as any)[k];
    if (k === "lodgingArea" && typeof v === "string" && typeof got === "string") {
      if (!got.toLowerCase().includes(v.toLowerCase())) errors.push(`brief.${k}: expected to include "${v}", got "${got}"`);
    } else if (got !== v) {
      errors.push(`brief.${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(got)}`);
    }
  }
  for (const sub of ex.assumptions ?? []) {
    const joined = result.assumptions.join(" ").toLowerCase();
    if (!joined.includes(sub.toLowerCase())) errors.push(`assumptions missing "${sub}"`);
  }
}

async function runDiscover(app: Awaited<ReturnType<typeof build>>, sc: Scenario, errors: string[]): Promise<void> {
  const ex = sc.discover!;
  const res = await app.inject({ method: "POST", url: "/discover", payload: ex.brief });
  if (res.statusCode !== 200) {
    errors.push(`discover HTTP ${res.statusCode}`);
    return;
  }
  const d = res.json();
  if (ex.diningCount != null && d.dining.length !== ex.diningCount) {
    errors.push(`dining count: expected ${ex.diningCount}, got ${d.dining.length}`);
  }
  if (ex.activitiesCount != null && d.activities.length !== ex.activitiesCount) {
    errors.push(`activities count: expected ${ex.activitiesCount}, got ${d.activities.length}`);
  }
  if (ex.staysCount != null && d.stays.length !== ex.staysCount) {
    errors.push(`stays count: expected ${ex.staysCount}, got ${d.stays.length}`);
  }
  const miles = d.transport?.[0]?.raw?.roadMiles as number | undefined;
  if (ex.transportMinMiles != null && (miles == null || miles < ex.transportMinMiles)) {
    errors.push(`transport miles: expected >= ${ex.transportMinMiles}, got ${miles}`);
  }
  if (ex.transportMaxMiles != null && (miles == null || miles > ex.transportMaxMiles)) {
    errors.push(`transport miles: expected <= ${ex.transportMaxMiles}, got ${miles}`);
  }
  if (ex.routeIncludes) {
    const label = JSON.stringify(d.transport?.[0]?.summary ?? "");
    if (!label.toLowerCase().includes(ex.routeIncludes.toLowerCase())) {
      errors.push(`route label missing "${ex.routeIncludes}"`);
    }
  }
}

async function runConverseTurns(
  app: Awaited<ReturnType<typeof build>>,
  sc: Scenario,
  errors: string[],
  mode: "live" | "replay",
): Promise<void> {
  const sessionId = `sc_${sc.id}_${Date.now().toString(36)}`;
  const userId = `scenario-${sc.id}`;
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  const golden = mode === "replay" ? loadGolden(sc.goldenId ?? sc.id) : null;

  if (mode === "replay" && !golden) {
    errors.push(`missing golden fixture: ${sc.goldenId ?? sc.id}.json (run npm run test:record-goldens)`);
    return;
  }

  const script = sc.turns ?? [];
  for (let i = 0; i < script.length; i++) {
    const turn = script[i]!;
    const userText = turn.user;
    messages.push({ role: "user", content: userText });

    let body: any;
    if (mode === "replay") {
      const gt = golden!.turns[i];
      if (!gt || gt.user !== userText) {
        errors.push(`golden turn ${i} mismatch (expected user "${userText}")`);
        break;
      }
      body = gt.response;
    } else {
      const res = await app.inject({
        method: "POST",
        url: "/converse",
        payload: { messages, userId, sessionId },
      });
      if (res.statusCode !== 200) {
        errors.push(`converse HTTP ${res.statusCode} on "${userText.slice(0, 40)}…"`);
        break;
      }
      body = res.json();
    }

    const reply = String(body.reply || "");
    messages.push({ role: "assistant", content: reply });

    if (turn.replyIncludes && !includesAll(reply, turn.replyIncludes)) {
      errors.push(`reply missing [${turn.replyIncludes.join(", ")}]: "${reply.slice(0, 120)}…"`);
    }
    if (turn.replyIncludesAny?.length) {
      const hit = turn.replyIncludesAny.some((n) => reply.toLowerCase().includes(n.toLowerCase()));
      if (!hit) errors.push(`reply missing any of [${turn.replyIncludesAny.join(", ")}]: "${reply.slice(0, 120)}…"`);
    }
    if (turn.replyExcludes && !excludesAll(reply, turn.replyExcludes)) {
      errors.push(`reply should exclude [${turn.replyExcludes.join(", ")}]: "${reply.slice(0, 120)}…"`);
    }
    if (turn.expectReady && !body.ready) {
      errors.push(`expected ready:true on "${userText.slice(0, 40)}…"`);
    }
    if (turn.slots && body.slots) {
      for (const [k, v] of Object.entries(turn.slots)) {
        const got = String((body.slots as any)[k] ?? "");
        if (!got.toLowerCase().includes(String(v).toLowerCase())) {
          errors.push(`slots.${k}: expected to include "${v}", got "${got}"`);
        }
      }
    }

    // Journey: after handoff, parse brief prose and run discover
    if (sc.journey?.discover && body.ready && body.brief) {
      const pr = await parseBrief(String(body.brief), { heuristic: true });
      const merged = { ...sc.journey.discover.brief, ...pr.brief, tripScope: pr.brief.tripScope ?? sc.journey.discover.brief.tripScope };
      await runDiscover(app, { ...sc, discover: { ...sc.journey.discover, brief: merged } }, errors);
    }
  }

  if (mode === "live") {
    const audit = listSessionTranscript(sessionId);
    const userTurns = script.length;
    if (audit.filter((t) => t.role === "user").length < userTurns) {
      errors.push(`audit log missing user turns (expected ${userTurns})`);
    }
  }
}

async function runScenario(app: Awaited<ReturnType<typeof build>>, sc: Scenario): Promise<ScenarioResult> {
  const t0 = Date.now();
  const errors: string[] = [];

  if ((sc.tier === "llm" || sc.tier === "journey") && !hasLlmKeys() && !includeLlm) {
    return {
      id: sc.id,
      name: sc.name,
      tier: sc.tier,
      passed: true,
      skipped: true,
      skipReason: "no LLM keys (use --llm)",
      ms: 0,
      errors: [],
    };
  }

  try {
    if (sc.parse) await runDeterministicParse(sc, errors);
    if (sc.discover) await runDiscover(app, sc, errors);
    if (sc.tier === "replay" && sc.turns?.length) {
      await runConverseTurns(app, sc, errors, "replay");
    } else if ((sc.tier === "llm" || sc.tier === "journey") && sc.turns?.length) {
      await runConverseTurns(app, sc, errors, "live");
    }
  } catch (e) {
    errors.push(String(e));
  }

  return {
    id: sc.id,
    name: sc.name,
    tier: sc.tier,
    passed: errors.length === 0,
    ms: Date.now() - t0,
    errors,
  };
}

// ── main ──
let list = SCENARIOS;
if (tierFilter) list = list.filter((s) => s.tier === tierFilter);
if (tagFilter) list = list.filter((s) => s.tags?.includes(tagFilter));
if (!includeLlm) list = list.filter((s) => s.tier !== "llm");

if (includeLlm && !hasLlmKeys()) {
  console.error("\nNeed ANTHROPIC_API_KEY or SAKANA_API_KEY (repository secrets for CI).\n");
  process.exit(1);
}

const app = await build();
console.log(`\nTures scenario runner — ${list.length} scenario(s)${includeLlm ? " (incl. live LLM)" : ""}\n`);

const results: ScenarioResult[] = [];
for (const sc of list) {
  const r = await runScenario(app, sc);
  results.push(r);
  if (r.skipped) console.log(`  ○ ${r.id} (skipped: ${r.skipReason})`);
  else if (r.passed) console.log(`  ✓ ${r.id} [${r.tier}] (${r.ms}ms)`);
  else {
    console.log(`  ✗ ${r.id} [${r.tier}]`);
    for (const e of r.errors) console.log(`      · ${e}`);
  }
}

await app.close();

const ran = results.filter((r) => !r.skipped);
const passed = ran.filter((r) => r.passed).length;
const skipped = results.filter((r) => r.skipped).length;
console.log(`\n${passed}/${ran.length} passed${skipped ? `, ${skipped} skipped` : ""}.\n`);
if (passed < ran.length) process.exit(1);
