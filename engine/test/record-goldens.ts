#!/usr/bin/env node
/**
 * Record golden /converse fixtures from live LLM (Sakana Fugu or Anthropic).
 * Run locally or in nightly CI with secrets — then commit test/replay/goldens/*.json.
 *
 *   npm run test:record-goldens
 *   npm run test:record-goldens -- pdx-cb-opener
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../src/server.ts";
import { config } from "../src/config.ts";
import { SCENARIOS } from "./scenarios/catalog.ts";
import type { GoldenFixture } from "./scenarios/types.ts";
import { goldenPath } from "./lib/replay.ts";

const GOLDENS_DIR = join(dirname(fileURLToPath(import.meta.url)), "replay/goldens");
const filterId = process.argv[2];

if (!config.anthropicKey && !config.sakana.enabled) {
  console.error("Need ANTHROPIC_API_KEY or SAKANA_API_KEY to record goldens.");
  process.exit(1);
}

const targets = SCENARIOS.filter((s) => s.goldenId && (s.tier === "llm" || s.tier === "replay"));
const ids = [...new Set(targets.map((s) => s.goldenId!))].filter((id) => !filterId || id === filterId || id.startsWith(filterId));

if (!ids.length) {
  console.error("No golden ids to record.");
  process.exit(1);
}

mkdirSync(GOLDENS_DIR, { recursive: true });
const app = await build();

for (const goldenId of ids) {
  const sc = targets.find((s) => s.goldenId === goldenId && s.turns?.length);
  if (!sc?.turns?.length) continue;

  const fixture: GoldenFixture = { id: goldenId, recordedAt: new Date().toISOString().slice(0, 10), turns: [] };
  const sessionId = `rec_${goldenId}_${Date.now().toString(36)}`;
  const userId = `record-${goldenId}`;
  const messages: { role: "user" | "assistant"; content: string }[] = [];

  console.log(`Recording ${goldenId}…`);
  for (const turn of sc.turns) {
    messages.push({ role: "user", content: turn.user });
    const res = await app.inject({
      method: "POST",
      url: "/converse",
      payload: { messages, userId, sessionId, debug: true },
    });
    if (res.statusCode !== 200) {
      console.error(`  failed HTTP ${res.statusCode}`);
      break;
    }
    const body = res.json();
    fixture.brain = body.via ?? body._debug?.via;
    fixture.turns.push({
      user: turn.user,
      response: {
        reply: body.reply,
        via: body.via,
        ready: body.ready,
        brief: body.brief,
        slots: body.slots,
        sessionId: body.sessionId,
      },
    });
    messages.push({ role: "assistant", content: String(body.reply || "") });
    console.log(`  via:${body.via} ready:${!!body.ready} — ${String(body.reply).slice(0, 80)}…`);
  }

  const out = goldenPath(goldenId);
  writeFileSync(out, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`  → ${out}\n`);
}

await app.close();
console.log("Done. Review and commit test/replay/goldens/*.json");
