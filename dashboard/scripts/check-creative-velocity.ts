/**
 * Fixture checks for the Velocity capacity model.
 *
 *     npx tsx --tsconfig scripts/tsconfig.json scripts/check-creative-velocity.ts
 *
 * Offline and deterministic. Pins the Ethia worked example the owner signed off
 * on 2026-10-08 (design doc section 9) and the edge rules: missing inputs read
 * n/a, never 0; the window never drops under 7 days; packs at once is at least
 * one. Exits non-zero on a mismatch.
 */

import {
  ETHIA_EXAMPLE,
  briefQuota,
  capacity,
  productionRatio,
  roundNice,
  scenarioLadder,
  spendForTarget,
  tierOf,
} from "@/lib/creative/capacity";

let fails = 0;

function near(label: string, actual: number | null, expected: number, tolerance: number) {
  const ok = actual !== null && Math.abs(actual - expected) <= tolerance;
  if (!ok) fails += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${actual === null ? "null" : actual.toFixed(2)} (expected ${expected} +/- ${tolerance})`);
}

function eq(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`);
}

console.log("=== Ethia, 2026-10-08 ===");
const e = capacity(ETHIA_EXAMPLE);
near("new-creative spend B", e.newCreativeSpend, 10375, 5);
near("verdict cost V", e.verdictCost, 5540, 0.01);
near("verdicts a month", e.verdicts, 1.87, 0.01);
near("daily money d", e.daily, 341.3, 0.5);
near("window days", e.windowDays, 16.2, 0.1);
eq("packs at once", e.packsAtOnce, 1);
near("capacity, new ads a month", e.capacity, 7.5, 0.05);
near("per-ad daily", e.perAdDaily, 85.4, 0.5);
near("per-ad floor", e.perAdFloor, 277, 0.01);
eq("per-ad warning", e.belowPerAdFloor, true);
eq("long window warning", e.longWindow, false);
near("new creative for a 7-day window", e.newCreativeFor7Day, 24059, 5);
near("spend for a 7-day window", e.spendFor7Day, 83250, 50);
eq("winners without a hit rate", e.winners, null);

console.log("\n=== reverse: spend for a target ===");
near("8 new ads a month", spendForTarget(8, ETHIA_EXAMPLE), 38339, 5);
near("round trip at current capacity", spendForTarget(e.capacity, ETHIA_EXAMPLE), 35900, 0.5);

console.log("\n=== hit rate and winners ===");
const h = capacity({ ...ETHIA_EXAMPLE, hitRate: 0.1 });
near("winners a month", h.winners, 0.749, 0.005);
near("months per winner", h.monthsPerWinner, 1.335, 0.01);
eq("zero hit rate: no months per winner", capacity({ ...ETHIA_EXAMPLE, hitRate: 0 }).monthsPerWinner, null);

console.log("\n=== edges ===");
eq("missing CPA: everything downstream null", capacity({ ...ETHIA_EXAMPLE, cpa: null }).capacity, null);
eq("missing spend: capacity null", capacity({ ...ETHIA_EXAMPLE, spend: null }).capacity, null);
eq("zero share: window null, not infinite", capacity({ ...ETHIA_EXAMPLE, share: 0 }).windowDays, null);
eq("zero share: capacity 0 (a measured zero)", capacity({ ...ETHIA_EXAMPLE, share: 0 }).capacity, 0);
const big = capacity({ ...ETHIA_EXAMPLE, spend: 200000 });
eq("window floors at 7", big.windowDays, 7);
eq("packs at once at 200k", big.packsAtOnce, 2);
eq("long window over 30 days", capacity({ ...ETHIA_EXAMPLE, spend: 15000 }).longWindow, true);

console.log("\n=== tier, ladder, quota ===");
eq("tier 1,652 USD", tierOf(1652), "SMALL");
eq("tier 3,000 USD", tierOf(3000), "MID");
eq("tier 15,001 USD", tierOf(15001), "LARGE");
eq("tier unknown", tierOf(null), null);
eq("roundNice 17,950", roundNice(17950), 18000);
eq("roundNice 538", roundNice(538), 540);
const ladder = scenarioLadder(ETHIA_EXAMPLE);
eq("ladder spends", ladder.map((r) => r.spend), [18000, 27000, 35900, 45000, 54000, 72000, 110000]);
eq("ladder marks the input", ladder.filter((r) => r.current).map((r) => r.spend), [35900]);
eq("production ratio", productionRatio(3, 7.5), 0.4);
eq("production ratio without capacity", productionRatio(3, null), null);
eq("brief quota 7.5 minus 5 queued", briefQuota(7.49, 5), 2);
eq("brief quota never negative", briefQuota(3, 9), 0);
eq("brief quota without a queue", briefQuota(7.5, null), null);

console.log(fails === 0 ? "\nall velocity checks passed" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
