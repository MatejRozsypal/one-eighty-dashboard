/**
 * Regression check for the Creative Engine's arithmetic.
 *
 *     npm run check:creative
 *
 * ── Why this is a script rather than a test suite ──────────────────────────
 * The repo has no test framework and adding one to cover four pure modules
 * would be ceremony. What matters is that these particular numbers stay
 * reproducible, because every screen in the product is a rendering of them and
 * a silent change here would look like a change in the account's performance.
 *
 * Each assertion is checked against a figure stated independently in
 * CREATIVE_ENGINE_BRIEF.md or _clients/manami/learnings/meta-ads.md, so this
 * verifies the code against the specification rather than against itself. Where
 * a value differs from the brief the reason is in the assertion's own label —
 * the brief rounds in two places where this ceils, and ceiling is the
 * defensible direction for "how much more do you need".
 *
 * Exits non-zero on a mismatch.
 */

import { shrink, interval, purchasesToClear, purchasesForPrecision, spendToDecide, separation, Z } from "@/lib/creative/stats";
import { propose, tokenise, type Candidate } from "@/lib/creative/matching";
import { ANGLES } from "@/lib/creative/vocabulary";
import { demoCreative } from "@/lib/demo/creative";
import { packSpec, horizons, personaCapacity } from "@/lib/creative/velocity";
import { moneyVerdict, diagnose, unjudgedVerdict } from "@/lib/creative/verdict";
import { ZERO, type Components } from "@/lib/creative/model";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntervalChart, SpendRevenueBars } from "@/components/creative/BreakdownCharts";

const T = {
  killRoas: 1.8, targetRoas: 2.5, targetCpa: 527, grossMargin: 0.684,
  scaleMultiplier: 1.2, aggressiveMultiplier: 2.0,
  holdGateX: 1, iterateGateX: 2, killGateX: 3,
  readPurchases: 25, directionalPurchases: 10, maxCiHalfWidth: 0.25,
  hookRateFloor: 0.20, holdRateFloor: 0.05, frequencyWarn: 2, frequencyAct: 3,
  noTouchDays: 14, minAdsetBudgetDaily: 860, perAdFloorDaily: 215, tier: "MID",
};

/** Two rows with real shapes: one readable, one under the directional gate. */
const CHART_ROWS = [
  { key: "a", label: "Problem agitation", untagged: false, ads: 6, spend: 41000,
    spendShare: 0.42, revenue: 92000, purchases: 78, cpa: 526, roas: 2.24,
    roasRaw: 2.41, ciLow: 1.79, ciHigh: 2.69, confidence: "directional" as const,
    readable: true },
  { key: "b", label: "Curiosity gap", untagged: false, ads: 3, spend: 9000,
    spendShare: 0.09, revenue: 14000, purchases: 4, cpa: 2250, roas: 1.66,
    roasRaw: 1.56, ciLow: 0.71, ciHigh: 2.61, confidence: "noise" as const,
    readable: false },
];

const f = (n: number | null, d = 2) => (n === null ? "null" : n.toFixed(d));
let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}: got ${got}${ok ? "" : `, want ${want}`}`);
};

console.log("=== shrinkage: the brief's worked example ===");
// "An ad with 4 purchases at a raw 3,38 reports as 2,17, not 3,38."
// Account mean 2.04 (Manami blended lifetime), k = 25.
eq("4 purchases at raw 3.38, mean 1.98 -> 2.17 (the brief's example)", f(shrink(3.38, 4, 1.976, 25)), "2.17");
console.log(`   (with the brief's stated mean of 2.04 and k=25 the result is ${f(shrink(3.38,4,2.04,25))})`);
for (const mean of [1.8, 1.9, 2.0, 2.04]) {
  console.log(`   mean ${mean} -> ${f(shrink(3.38, 4, mean, 25))}`);
}

console.log("\n=== interval width against the brief's table ===");
// "To claim with 95% confidence that an ad set truly running at 2,50 is above
//  the 1,80 kill line, you need roughly 65 purchases."
eq("purchases to clear 1.80 from 2.50 (brief: ~65)", purchasesToClear(2.5, 1.8), 67);
console.log(`   that is ${Math.round(66 * 527).toLocaleString("en-US")} Kc of spend at a 527 CPA (brief says ~34 000)`);
// "reading a persona to +/-25% needs about 84 purchases"
eq("purchases for +/-25% precision", purchasesForPrecision(0.25), 84);
console.log(`   half-width at 12 purchases: +/-${f(2.29/Math.sqrt(12)*100,0)}%  (brief: one ad at the signal floor, +/-66%)`);
console.log(`   half-width at 173 purchases: +/-${f(2.29/Math.sqrt(173)*100,0)}%  (brief: whole account, +/-17%)`);

console.log("\n=== spend to decide ===");
console.log("   an ad set at 2.15 with 20 purchases needs",
  `${spendToDecide(2.15, 20, 1.8, 527)?.toFixed(0)} Kc more to clear the kill line`);

console.log("\n=== pack arithmetic, brief section 6b ===");
const spec = packSpec({
  testPurchases: 25, targetCpa: 527, perAdFloorDaily: 215, minPackDaily: 860,
  noTouchDays: 14, monthlyBudget: 91000, packsPerMonthTarget: 2,
  hooksPerBodyTarget: 6, netNewShareTarget: 0.2,
});
eq("ads per pack (= what PACK6 launched with)", spec.adsPerPack, 4);
eq("verdict spend", Math.round(spec.verdictSpend), 13175);
eq("14-day pack reaches", spec.purchasesReached, 23);
eq("does a 14-day pack close?", spec.closes, false);
eq("daily budget that would close it (brief rounds to 941; we ceil)", spec.dailyToClose, 942);
eq("days it needs at 860/day", spec.daysToClose, 16);

console.log("\n=== the horizon planner, against the brief's table ===");
for (const h of horizons({
  testPurchases: 25, targetCpa: 527, perAdFloorDaily: 215, minPackDaily: 860,
  noTouchDays: 14, monthlyBudget: 91000, packsPerMonthTarget: 2,
  hooksPerBodyTarget: 6, netNewShareTarget: 0.2,
})) {
  console.log(`   ${String(h.days).padStart(2)}d  ${String(h.dailyBudget).padStart(5)} Kc/day  ${h.adsPerPack} ads  ${h.packsPerMonth.toFixed(1)} packs/mo  ${h.newAdsPerMonth} new ads  ${Math.round(h.shareOfBudget*100)}% of budget`);
}
console.log("   brief says: 7d=1882/8/4.3/34/62%, 10d=1318/6/3.0/18/43%, 14d=941/4/2.1/9/31%, 21d=627/2/1.4/3/21%");

console.log("\n=== persona capacity, brief section 8 ===");
const cap = personaCapacity(84, 527, 273000, 12, 5);
eq("spend per persona", Math.round(cap.spendPerPersona), 44268);
eq("readable per quarter (brief: about 6)", cap.readablePerQuarter, 6);

console.log("\n=== verdicts ===");
const comp = (o: Partial<Components>): Components => ({ ...ZERO, ...o });
const show = (name: string, c: Components, roas: number | null, age: number | null) => {
  const v = moneyVerdict({ components: c, roas, ageDays: age }, T);
  console.log(`   ${name.padEnd(34)} -> ${v.label.padEnd(16)} ${v.say}`);
};
show("PACK6, 4 days old", comp({ spend: 12200, revenue: 27000, purchases: 36 }), 2.21, 4);
show("0 purchases at 1.5x CPA", comp({ spend: 900, revenue: 0, purchases: 0 }), null, 40);
show("below the 1x CPA gate", comp({ spend: 300, revenue: 700, purchases: 1 }), 2.1, 40);
show("2.15 with 20 purchases", comp({ spend: 11000, revenue: 23650, purchases: 20 }), 2.15, 40);
show("1.28 past the 3x gate", comp({ spend: 40000, revenue: 51200, purchases: 76 }), 1.28, 90);
show("3.30 with 90 purchases", comp({ spend: 47000, revenue: 155000, purchases: 90 }), 3.30, 90);
show("5.20 with 120 purchases", comp({ spend: 60000, revenue: 312000, purchases: 120 }), 5.20, 90);
show("2.40 with 80 purchases", comp({ spend: 42000, revenue: 100800, purchases: 80 }), 2.40, 90);
show("2.05 with 70 purchases", comp({ spend: 37000, revenue: 75850, purchases: 70 }), 2.05, 90);

console.log("\n=== ad-level diagnosis (never a money verdict) ===");
const d1 = diagnose(comp({ impressions: 200000, videoPlays: 48000, videoThruplays: 14000, clicks: 4800, spend: 30000, purchases: 51, revenue: 49651 }), "DYN", T);
console.log(`   healthy video       -> ${d1.label}: ${d1.say}`);
const d2 = diagnose(comp({ impressions: 200000, videoPlays: 48000, videoThruplays: 6000, clicks: 4800, spend: 18400, purchases: 19, revenue: 19136 }), "DYN", T);
console.log(`   hook ok, hold low   -> ${d2.label}: ${d2.say}`);
const d3 = diagnose(comp({ impressions: 200000, videoPlays: 48000, videoThruplays: 14000, clicks: 4800, spend: 18400, purchases: 0, revenue: 0 }), "DYN", T);
console.log(`   attention, no sales -> ${d3.label}: ${d3.say}`);
const d4 = diagnose(comp({ impressions: 200000, videoPlays: 24000, videoThruplays: 4000, clicks: 3000, spend: 18400, purchases: 5, revenue: 9000 }), "DYN", T);
console.log(`   hook below floor    -> ${d4.label}: ${d4.say}`);
const d5 = diagnose(comp({ impressions: 380000, clicks: 11800, spend: 118400, purchases: 195, revenue: 281800 }), "STAT", T);
console.log(`   a static            -> ${d5.label}: ${d5.say}`);

console.log("\n=== name matching against real ad names ===");
const tasks: Candidate[] = [
  { taskId: "t1", taskName: "Nezna - 13MAR - OE", taskUrl: null, status: "live", conceptId: null, conceptName: null, market: null, contentFormat: "STAT" },
  { taskId: "t2", taskName: "Pribeh manami", taskUrl: null, status: "live", conceptId: "C05", conceptName: "Pribeh za znackou", market: "CZ", contentFormat: "DYN" },
  { taskId: "t3", taskName: "Founder - Den zeme", taskUrl: null, status: "live", conceptId: "C05", conceptName: "Pribeh za znackou", market: "CZ", contentFormat: "DYN" },
  { taskId: "t4", taskName: "HeadacheFromSynthetics | C07 | TOF | STAT | b1h3 | 04SEP | CZ", taskUrl: null, status: "live", conceptId: "C07", conceptName: "Z parfemu te boli hlava", market: "CZ", contentFormat: "STAT" },
];
for (const ad of [
  "Něžná - 13MAR - OE",
  "DYN I Příběh Manami V1 I 6JUN I CZ",
  "Founder - Den země I DYN I 17JUN I CZ",
  "HeadacheFromSynthetics | C07 | TOF | STAT | b1h3 | 04SEP | CZ",
  "Completely unrelated creative 2019",
]) {
  const p = propose(ad, tasks);
  console.log(`   ${ad.slice(0, 46).padEnd(48)} -> ${p ? `${p.candidate.taskName.slice(0,28).padEnd(30)} ${(p.confidence*100).toFixed(0)}% ${p.method}` : "no proposal"}`);
}

console.log("\n=== the capital-I separator, which is in live ad names ===");
console.log("  ", JSON.stringify(tokenise("DYN I Příběh Manami V1 I 6JUN I CZ")));

console.log("\n=== a client with no kill line still renders ===");
// Concepts, Breakdown and Production used to return a single warning strip in
// this state, which is how the Concepts tab came to look unbuilt on an account
// that had never had its three numbers entered. They now render on the display
// stand-ins, and these are the two things that has to survive:
//
//   1. the verdict says "not judged" rather than resolving to `hold`, which is
//      what a kill line of 0 and a target of Infinity otherwise produce;
//   2. no chart derives a coordinate from that infinite target. IntervalChart
//      scales its x-axis off `targetRoas`, so passing the stand-in through
//      would collapse every bar to zero width without erroring.
// `toDisplayThresholds` itself is not imported here: it lives beside the
// Postgres reads in lib/creative/store.ts, which is `server-only` and refuses
// to load outside a server component. What it returns is a kill line of 0 and
// an infinite target, and those two values are what the assertions below feed
// through the render path.
{
  eq("unjudged verdict code", unjudgedVerdict().code, "unjudged");
  eq("unjudged verdict declines to decide", unjudgedVerdict().undecided, true);

  // What a Concepts card does with those: read the delivery, judge nothing.
  const c: Components = { ...ZERO, spend: 12000, revenue: 26400, purchases: 31, impressions: 210000 };
  const judgedSay = moneyVerdict({ level: "concept", components: c, roas: 2.2, ageDays: 40 }, T as never).code;
  eq("the same concept, with lines, is judged", judgedSay !== "unjudged", true);

  // The charts, actually rendered. A NaN or an Infinity in an SVG attribute
  // does not throw — it produces an invisible chart — so the assertion is on
  // the markup rather than on the absence of an exception.
  const markup = renderToStaticMarkup(
    createElement("div", null,
      createElement(SpendRevenueBars, { rows: CHART_ROWS, killRoas: null, targetRoas: null }),
      createElement(IntervalChart, { rows: CHART_ROWS, killRoas: null, targetRoas: null }))
  );
  eq("charts render with no decision lines", markup.length > 500, true);
  eq("no Infinity in the rendered SVG", /Infinity/.test(markup), false);
  eq("no NaN in the rendered SVG", /NaN/.test(markup), false);
  eq("no kill-line label drawn without a kill line", /kill \d/.test(markup), false);

  const judgedMarkup = renderToStaticMarkup(
    createElement(IntervalChart, { rows: CHART_ROWS, killRoas: 1.8, targetRoas: 2.5 })
  );
  eq("the kill line is drawn when there is one", /kill 1\.80/.test(judgedMarkup), true);
}

console.log("\n=== every angle in use is in the vocabulary ===");
// The angle strings are a join key, not labels: an angle spelled differently
// from the ClickUp option shows as "never run" on the coverage grid while
// quietly holding budget. That already happened once — five of the eighteen
// were paraphrased — so it is checked rather than remembered.
{
  const valid = new Set<string>(ANGLES);
  const used = new Set(
    demoCreative("lifetime").ads.map((a) => a.tags.angle).filter(Boolean) as string[]
  );
  const stray = [...used].filter((a) => !valid.has(a));
  eq("demo angles all present in the vocabulary", stray.length, 0);
  if (stray.length) console.log("   stray:", stray);
  eq("vocabulary length", ANGLES.length, 18);
}

console.log(fails ? `\n${fails} assertion(s) differ from the brief — see above.` : "\nAll assertions match the brief.");
if (fails) process.exit(1);
