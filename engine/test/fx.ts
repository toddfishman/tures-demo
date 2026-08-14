// Tests for FX normalization (suppliers/fx.ts) and the budget gate it protects.
//
// Pins a real bug: Duffel fares came back in their native currency (total_currency was ignored),
// so a 900 GBP fare was summed as "$900" and slid under a $1,000 budget it actually exceeds.
//
// Run: node node_modules/tsx/dist/cli.mjs test/fx.ts
import assert from "node:assert/strict";
import { toUsd } from "../src/suppliers/fx.ts";
import { checkPolicy } from "../src/booking/policy.ts";
import { MockSupplier } from "../src/suppliers/mock.ts";
import type { Brief, Offer } from "../src/types.ts";

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("\nFX normalization\n");

// 1. USD passes through untouched.
{
  assert.equal(toUsd(1234.56, "USD"), 1234.56);
  assert.equal(toUsd(100, undefined), 100); // missing currency is treated as USD, as before
  ok("USD (and missing currency) pass through");
}

// 2. A non-USD fare converts — and rounds to cents.
{
  const usd = toUsd(900, "GBP");
  assert.ok(usd !== null && usd > 1000 && usd < 1300, `900 GBP should be well over $1,000 (got ${usd})`);
  assert.equal(toUsd(10000, "JPY"), 67);
  assert.equal(Math.round((toUsd(0.333, "EUR") ?? 0) * 100), (toUsd(0.333, "EUR") ?? 0) * 100, "rounded to cents");
  ok("non-USD fares convert to real USD");
}

// 3. Unknown currency is null — the caller must drop/flag the offer, never treat it as USD.
{
  assert.equal(toUsd(500, "XYZ"), null);
  assert.equal(toUsd(NaN, "USD"), null);
  ok("unknown currency / bad amount → null, never a fake number");
}

// 4. The original bug, end to end at the policy gate: a 900 GBP flight against a $1,000 budget.
//    Unconverted it read as $900 and passed; converted it exceeds the ceiling and must violate.
{
  const brief = {
    origin: "JFK",
    destination: "LHR",
    departDate: "2026-09-10",
    adults: 1,
    children: 0,
    cabin: "economy",
    budgetUsd: 1000,
    bookingMode: "confirm_each",
  } as unknown as Brief;
  const flight: Offer = {
    id: "off_gbp",
    kind: "flight",
    supplier: "duffel",
    title: "BA JFK→LHR",
    priceUsd: toUsd(900, "GBP")!,
    currency: "GBP",
    raw: { nativeAmount: 900 },
    summary: [],
  };
  const violations = checkPolicy({
    accountId: "test",
    brief,
    flight,
    totalUsd: flight.priceUsd,
    supplier: new MockSupplier(),
  });
  assert.ok(
    violations.some((v) => v.includes("exceeds brief budget")),
    `a 900 GBP fare must trip a $1,000 budget once converted (violations: ${JSON.stringify(violations)})`,
  );
  ok("budget gate catches a non-USD fare that natively looked in-budget");
}

console.log(`\n${passed} passed\n`);
