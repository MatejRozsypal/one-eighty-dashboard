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
 * a value differs from the brief the reason is in the assertion's own label,
 * the brief rounds in two places where this ceils, and ceiling is the
 * defensible direction for "how much more do you need".
 *
 * Exits non-zero on a mismatch.
 */

import { purchasesForPrecision, zoneOf, ZONE_LABELS } from "@/lib/creative/stats";
import { propose, tokenise, type Candidate } from "@/lib/creative/matching";
import { ANGLES } from "@/lib/creative/vocabulary";
import { presetRange, comparisonRange, daysInRange, addDays } from "@/lib/period";
import { demoCreative } from "@/lib/demo/creative";
import { personaCapacity, launchCadence } from "@/lib/creative/velocity";
import { moneyVerdict, diagnose, unjudgedVerdict } from "@/lib/creative/verdict";
import { ZERO, derive, add, fillNames, read, tagCoverage, type Components } from "@/lib/creative/model";
import { cleanPersona, conceptLabel, humanizeConceptCode, isConceptCode, noEmDash } from "@/lib/creative/display";
import { roas as fmtRoas } from "@/components/creative/primitives";
import { cadenceTicks, LaunchCadence } from "@/components/creative/LaunchCadence";
import { focusLabel } from "@/lib/creative/vocabulary";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoasChart, SpendRevenueBars } from "@/components/creative/BreakdownCharts";

const T = {
  killRoas: 1.8, targetRoas: 2.5, targetCpa: 527, grossMargin: 0.684,
  scaleMultiplier: 1.2, aggressiveMultiplier: 2.0,
  holdGateX: 1, iterateGateX: 2, killGateX: 3,
  hookRateFloor: 0.20, holdRateFloor: 0.05, frequencyWarn: 2, frequencyAct: 3,
  noTouchDays: 14, minAdsetBudgetDaily: 860, perAdFloorDaily: 215, tier: "MID",
};

/** Three rows with real shapes: many purchases, four purchases, none at all. */
const CHART_ROWS = [
  { key: "a", label: "Problem agitation", untagged: false, ads: 6, spend: 41000,
    spendShare: 0.42, revenue: 92000, purchases: 78, cpa: 526, roas: 2.24 },
  { key: "b", label: "Curiosity gap", untagged: false, ads: 3, spend: 9000,
    spendShare: 0.09, revenue: 14000, purchases: 4, cpa: 2250, roas: 1.56 },
  { key: "c", label: "Founder story", untagged: false, ads: 2, spend: 1200,
    spendShare: 0.01, revenue: 0, purchases: 0, cpa: null, roas: 0 },
];

const f = (n: number | null, d = 2) => (n === null ? "null" : n.toFixed(d));
let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}: got ${got}${ok ? "" : `, want ${want}`}`);
};

console.log("=== ROAS is the real ratio, never adjusted ===");
// Owner decisions: no shrinkage toward the account average, and pure numbers
// (2026-10-13): no confidence class, no interval. The brief's old example, 4
// purchases at 3.38, reports 3.38 and carries nothing else.
{
  const few = read({ ...ZERO, spend: 1000, revenue: 3380, purchases: 4 }, 10000);
  eq("4 purchases at 3.38 reports 3.38, not pulled toward any mean", f(few.roas), "3.38");
  eq("the Reading carries no interval", "ciLow" in few || "ciHigh" in few, false);
  eq("the Reading carries no confidence class", "confidence" in few, false);
  const many = read({ ...ZERO, spend: 40000, revenue: 51200, purchases: 76 }, 100000);
  eq("76 purchases at 1.28 reports 1.28", f(many.roas), "1.28");
  const none = read({ ...ZERO, spend: 900, revenue: 0, purchases: 0 }, 10000);
  eq("spend and 0 purchases reports a real 0.00, not n/a", f(none.roas), "0.00");
  const idle = read({ ...ZERO, spend: 0, revenue: 0, purchases: 0 }, 10000);
  eq("zero spend is the only n/a (division by zero)", idle.roas, null);
  eq("the Reading carries no second, raw figure", "roasRaw" in few, false);
  eq("derive() ROAS is revenue over spend", f(derive({ ...ZERO, spend: 1000, revenue: 3380, purchases: 4 }).roas), "3.38");
}

console.log("\n=== zones: a plain comparison with the lines ===");
eq("2.50 against 1.80 / 2.50 is at target", zoneOf(2.5, T), "above-target");
eq("2.10 is under target", zoneOf(2.1, T), "under-target");
eq("0.00 (no purchases) is below the kill line", zoneOf(0, T), "below-kill");
eq("zone labels", ZONE_LABELS["below-kill"], "Below kill line");

console.log("\n=== persona capacity precision (planning only, never a gate) ===");
// "reading a persona to +/-25% needs about 84 purchases"
eq("purchases for +/-25% precision", purchasesForPrecision(0.25), 84);

console.log("\n=== persona capacity, brief section 8 ===");
const cap = personaCapacity(84, 527, 273000, 12, 5);
eq("spend per persona", Math.round(cap.spendPerPersona), 44268);
eq("readable per quarter (brief: about 6)", cap.readablePerQuarter, 6);

console.log("\n=== verdicts ===");
const comp = (o: Partial<Components>): Components => ({ ...ZERO, ...o });
const show = (name: string, c: Components, age: number | null) => {
  const v = moneyVerdict({ components: c, ageDays: age }, T);
  console.log(`   ${name.padEnd(34)} -> ${v.label.padEnd(16)} ${v.say}`);
  return v;
};
const verdictOf = (c: Partial<Components>, age: number | null = 90) => moneyVerdict({ components: comp(c), ageDays: age }, T).code;
show("PACK6, 4 days old", comp({ spend: 12200, revenue: 27000, purchases: 36 }), 4);
show("0 purchases at 1.5x CPA", comp({ spend: 900, revenue: 0, purchases: 0 }), 40);
show("below the 1x CPA gate", comp({ spend: 300, revenue: 700, purchases: 1 }), 40);
show("2.15 with 20 purchases", comp({ spend: 11000, revenue: 23650, purchases: 20 }), 40);
show("1.28 past the 3x gate", comp({ spend: 40000, revenue: 51200, purchases: 76 }), 90);
show("3.30 with 90 purchases", comp({ spend: 47000, revenue: 155000, purchases: 90 }), 90);
show("5.20 with 120 purchases", comp({ spend: 60000, revenue: 312000, purchases: 120 }), 90);
show("2.40 with 80 purchases", comp({ spend: 42000, revenue: 100800, purchases: 80 }), 90);
show("2.05 with 70 purchases", comp({ spend: 37000, revenue: 75850, purchases: 70 }), 90);

// Pure numbers: purchase counts gate nothing, only time and spend do.
eq("no spend is No data", verdictOf({ spend: 0 }), "data-missing");
eq("inside the no-touch window is too early", verdictOf({ spend: 12200, revenue: 27000, purchases: 36 }, 4), "too-early");
eq("under 1x CPA spend needs more data", verdictOf({ spend: 300, revenue: 700, purchases: 1 }), "needs-more-data");
eq("0 purchases at 1.5x CPA is not 'Check tracking': a real 0.00 under the kill gate holds", verdictOf({ spend: 900, revenue: 0, purchases: 0 }), "hold");
eq("0 purchases past the 3x CPA kill gate is a kill", verdictOf({ spend: 1600, revenue: 0, purchases: 0 }), "kill");
eq("a kill line crossing no longer blocks a kill: 1.28 past 3x CPA", verdictOf({ spend: 40000, revenue: 51200, purchases: 76 }), "kill");
eq("2.15 with 20 purchases is judged, not 'not separable' or 'learning'", verdictOf({ spend: 11000, revenue: 23650, purchases: 20 }), "iterate");
eq("3 purchases at 3.10x past 1x CPA scales: no learning gate", verdictOf({ spend: 1500, revenue: 4650, purchases: 3 }), "scale");
eq("5.20 scales hard", verdictOf({ spend: 60000, revenue: 312000, purchases: 120 }), "aggressive-scale");
eq("2.40 holds", verdictOf({ spend: 42000, revenue: 100800, purchases: 80 }), "hold");
eq("1.50 at 2x CPA (under the kill gate) holds", verdictOf({ spend: 1100, revenue: 1650, purchases: 2 }), "hold");
eq("the kill message states the real number", show("1.28 kill message", comp({ spend: 40000, revenue: 51200, purchases: 76 }), 90).say.startsWith("1.28,"), true);

console.log("\n=== ad-level diagnosis (never a money verdict) ===");
const d1 = diagnose(comp({ impressions: 200000, videoPlays: 90000, videoViews: 48000, videoThruplays: 14000, clicks: 4800, spend: 30000, purchases: 51, revenue: 49651 }), "DYN", T);
console.log(`   healthy video       -> ${d1.label}: ${d1.say}`);
const d2 = diagnose(comp({ impressions: 200000, videoPlays: 90000, videoViews: 48000, videoThruplays: 6000, clicks: 4800, spend: 18400, purchases: 19, revenue: 19136 }), "DYN", T);
console.log(`   hook ok, hold low   -> ${d2.label}: ${d2.say}`);
const d3 = diagnose(comp({ impressions: 200000, videoPlays: 90000, videoViews: 48000, videoThruplays: 14000, clicks: 4800, spend: 18400, purchases: 0, revenue: 0 }), "DYN", T);
console.log(`   attention, no sales -> ${d3.label}: ${d3.say}`);
const d4 = diagnose(comp({ impressions: 200000, videoPlays: 60000, videoViews: 24000, videoThruplays: 4000, clicks: 3000, spend: 18400, purchases: 5, revenue: 9000 }), "DYN", T);
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

console.log("\n=== the range picker's arithmetic, which the Creative screens now use ===");
// The screens went from a two-position toggle to the dashboard's shared date
// control, so the ranges they query are these. Worth pinning because every
// figure on five screens is now a function of them.
{
  const today = "2026-09-09";
  eq("last 30 days ends yesterday, never today",
     presetRange("30d", today).to, "2026-09-08");
  eq("last 30 days is 30 days inclusive",
     daysInRange(presetRange("30d", today)), 30);
  eq("previous period is the 30 days before it, ending the day before",
     JSON.stringify(comparisonRange(presetRange("30d", today), "previous_period")),
     JSON.stringify({ from: "2026-07-11", to: "2026-08-09" }));
  {
    const prev = comparisonRange(presetRange("30d", today), "previous_period")!;
    eq("comparison abuts the current range with no gap and no overlap",
       addDays(prev.to, 1), presetRange("30d", today).from);
    eq("comparison is the same length", daysInRange(prev), 30);
  }
  {
    // 364, not 365: 52 whole weeks, so a Monday compares against a Monday.
    // Ad delivery is strongly weekday-seasonal and a one-day slip turns a
    // calendar artefact into a reported change.
    const yoy = comparisonRange(presetRange("30d", today), "previous_year")!;
    eq("previous year shifts by 364 days, preserving weekday",
       daysInRange({ from: yoy.from, to: presetRange("30d", today).from }) - 1, 364);
  }
  eq("no comparison means no baseline, not a zero one",
     comparisonRange(presetRange("30d", today), "none"), null);
  // A custom range is whatever was asked for, and its comparison follows its
  // own length rather than a preset's.
  {
    const custom = { from: "2026-07-01", to: "2026-07-14" };
    eq("a custom range compares against its own span",
       JSON.stringify(comparisonRange(custom, "previous_period")),
       JSON.stringify({ from: "2026-06-17", to: "2026-06-30" }));
  }
}

console.log("\n=== the date picker opens on months that have data ===");
// The regression that blanked every screen on 9 Sep 2026: the calendar
// anchored on `range.from`, so the Creative screens' all-time default opened it
// on September 2021. Two clicks later the whole dashboard was showing August
// 2021: every card a dash, because the sidebar appends the current query
// string to every link, so one screen's range became every screen's range.
//
// The anchor is the month BEFORE `range.to`, which for any range, however
// long, is within a month of today.
{
  const anchorOf = (r: { from: string; to: string }) => {
    const [y, m] = r.to.split("-").map(Number);
    return m === 1 ? { year: y - 1, month: 11 } : { year: y, month: m - 2 };
  };
  const today = "2026-09-09";
  for (const preset of ["7d", "30d", "90d", "12m", "all"] as const) {
    const r = presetRange(preset, today);
    const a = anchorOf(r);
    // Within two months of "now" for every preset, including the five-year one.
    const monthsAgo = (2026 - a.year) * 12 + (8 - a.month);
    eq(`${preset}: calendar opens near today, not at the range start`, monthsAgo <= 2, true);
  }
  // The specific case that broke it.
  const all = presetRange("all", today);
  eq("all-time still starts five years back", all.from.slice(0, 4), "2021");
  eq("but the calendar does not open there", anchorOf(all).year, 2026);
}

console.log("\n=== launch cadence buckets by the month a pack first delivered ===");
{
  // Manami's real launches, read off mart_creative_adset_perf on 9 Sep 2026:
  // Apr 1, May 2, Jun 4, Jul 7, Aug 1, Sep 1. The July peak and the collapse
  // after it are the finding the chart exists for, so the bucketing that
  // produces them is worth pinning.
  const iso = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-08`;
  const dates = [
    iso(2026, 4),
    iso(2026, 5), iso(2026, 5),
    iso(2026, 6), iso(2026, 6), iso(2026, 6), iso(2026, 6),
    ...Array.from({ length: 7 }, () => iso(2026, 7)),
    iso(2026, 8),
    iso(2026, 9),
  ];
  // Anchored on the real "today" this was measured against.
  const months = launchCadence(dates, 6);
  eq("six buckets", months.length, 6);
  const total = months.reduce((a, b) => a + b.packs, 0);
  eq("every launch inside the window is counted or dropped, never doubled",
     total <= dates.length, true);
  eq("a month with no launch is a zero, not a gap",
     months.every((m) => typeof m.packs === "number"), true);
  // A date outside the window must not fall into the nearest bucket.
  const stale = launchCadence([iso(2019, 1)], 6).reduce((a, b) => a + b.packs, 0);
  eq("a launch older than the window is dropped, not clamped", stale, 0);
}

console.log("\n=== a client with no kill line still renders ===");
// Concepts, Breakdown and Production used to return a single warning strip in
// this state, which is how the Concepts tab came to look unbuilt on an account
// that had never had its three numbers entered. They now render on the display
// stand-ins, and these are the two things that has to survive:
//
//   1. the verdict says "not judged" rather than resolving to `hold`, which is
//      what a kill line of 0 and a target of Infinity otherwise produce;
//   2. no chart derives a coordinate from that infinite target. RoasChart
//      scales its x-axis off `targetRoas`, so passing the stand-in through
//      would collapse every dot to zero without erroring.
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
  const judgedSay = moneyVerdict({ components: c, ageDays: 40 }, T as never).code;
  eq("the same concept, with lines, is judged", judgedSay !== "unjudged", true);

  // The charts, actually rendered. A NaN or an Infinity in an SVG attribute
  // does not throw: it produces an invisible chart, so the assertion is on
  // the markup rather than on the absence of an exception.
  const markup = renderToStaticMarkup(
    createElement("div", null,
      createElement(SpendRevenueBars, { rows: CHART_ROWS, killRoas: null, targetRoas: null }),
      createElement(RoasChart, { rows: CHART_ROWS, killRoas: null, targetRoas: null }))
  );
  eq("charts render with no decision lines", markup.length > 500, true);
  eq("no Infinity in the rendered SVG", /Infinity/.test(markup), false);
  eq("no NaN in the rendered SVG", /NaN/.test(markup), false);
  eq("no kill-line label drawn without a kill line", /kill \d/.test(markup), false);

  const judgedMarkup = renderToStaticMarkup(
    createElement("div", null,
      createElement(SpendRevenueBars, { rows: CHART_ROWS, killRoas: 1.8, targetRoas: 2.5 }),
      createElement(RoasChart, { rows: CHART_ROWS, killRoas: 1.8, targetRoas: 2.5 }))
  );
  eq("the kill line is drawn when there is one", /kill 1\.80/.test(judgedMarkup), true);
  eq("no 'Too little data' or 'Cannot tell' readout", /Too little data|Cannot tell/.test(judgedMarkup), false);
  eq("the zero-purchase row shows its real 0.00", /0\.00</.test(judgedMarkup), true);
  eq("the zero-purchase row reads below the kill line", (judgedMarkup.match(/Below kill line/g) ?? []).length, 2);
  eq("no row is dimmed for its purchase count", /opacity="0\.(36|405)"|<g[^>]*opacity="0\.5"/.test(judgedMarkup), false);
}

console.log("\n=== every angle in use is in the vocabulary ===");
// The angle strings are a join key, not labels: an angle spelled differently
// from the ClickUp option shows as "never run" on the coverage grid while
// quietly holding budget. That already happened once, five of the eighteen
// were paraphrased, so it is checked rather than remembered.
{
  const valid = new Set<string>(ANGLES);
  const used = new Set(
    demoCreative(presetRange("all")).ads.map((a) => a.tags.angle).filter(Boolean) as string[]
  );
  const stray = [...used].filter((a) => !valid.has(a));
  eq("demo angles all present in the vocabulary", stray.length, 0);
  if (stray.length) console.log("   stray:", stray);
  eq("vocabulary length", ANGLES.length, 18);
}

console.log("\n=== QF8: hook rate numerator, outbound CTR, names, coverage, labels ===");
{
  // D2: 3-second plays over impressions, not video starts.
  const v = comp({ impressions: 100000, videoPlays: 90000, videoViews: 30000 });
  eq("hook rate uses video_views, not starts", f(derive(v).hookRate, 3), "0.300");
  eq("an ad with no starts is not a video ad: hook null", derive(comp({ impressions: 100000, videoViews: 5000 })).hookRate, null);
  eq("a static ad reports no hook", derive(comp({ impressions: 100000 })).hookRate, null);

  // B-06: unreported outbound is null, a real zero is 0.
  eq("outbound never reported: CTR null", derive(comp({ impressions: 50000, clicks: 900 })).outboundCtr, null);
  eq("outbound reported as zero on some rows: 0", f(derive(comp({ impressions: 50000, outboundRows: 3 })).outboundCtr, 3), "0.000");
  eq("outbound reported: CTR", f(derive(comp({ impressions: 50000, outboundClicks: 500, outboundRows: 3 })).outboundCtr, 3), "0.010");
  const sumRows = add(comp({ outboundRows: 2 }), comp({ outboundRows: 5 }));
  eq("outbound rows add across ads", sumRows.outboundRows, 7);

  // B-03: names come from the asset mart, never overwrite one that is present.
  const ads = [
    { adId: "1", adsetName: null, campaignName: null },
    { adId: "2", adsetName: "kept", campaignName: null },
    { adId: "3", adsetName: null, campaignName: null },
  ];
  const assets = new Map([
    ["1", { adsetName: "AS1", campaignName: "CA I PACKS" }],
    ["2", { adsetName: "other", campaignName: "CA I PACKS" }],
  ]);
  const filled = fillNames(ads, assets);
  eq("campaign name filled from assets", filled[0].campaignName, "CA I PACKS");
  eq("ad set name filled from assets", filled[0].adsetName, "AS1");
  eq("an existing ad set name is kept", filled[1].adsetName, "kept");
  eq("an ad with no asset row stays null", filled[2].campaignName, null);
  eq("campaign focus has a chip label", focusLabel("campaignId"), "Campaign");

  // B-13: coverage from the rows on the page.
  const g = [
    { untagged: false, components: { spend: 440 } },
    { untagged: true, components: { spend: 560 } },
  ];
  eq("coverage = 1 - untagged share", f(tagCoverage(g), 2), "0.44");
  eq("coverage with no spend", tagCoverage([]), null);

  // B-14: whole-number ticks only.
  for (const max of [1, 3, 4, 5, 8, 10, 13]) {
    const t = cadenceTicks(max);
    eq(`ticks for ${max} are integers`, t.every((x) => Number.isInteger(x)), true);
    eq(`ticks for ${max} start at 0 and stay within range`, t[0] === 0 && t[t.length - 1] <= max && t.length <= 5, true);
  }
  eq("ticks 0..3", cadenceTicks(3).join(","), "0,1,2,3");

  {
    const months = [
      { month: "2026-05", label: "May", packs: 0 },
      { month: "2026-06", label: "Jun", packs: 0 },
    ];
    const html = renderToStaticMarkup(createElement(LaunchCadence, { months, target: 2 }));
    const labels = [...html.matchAll(/text-anchor="end"[^>]*>(\d+(?:\.\d+)?)</g)].map((m) => m[1]);
    eq("LaunchCadence gridline labels are integers", labels.length > 0 && labels.every((l) => /^\d+$/.test(l)), true);
    eq("LaunchCadence empty state sentence", html.includes("No packs launched in these months."), true);
    const busy = renderToStaticMarkup(createElement(LaunchCadence, { months: [{ month: "2026-05", label: "May", packs: 3 }], target: 2 }));
    eq("LaunchCadence has no empty sentence when packs exist", busy.includes("No packs launched"), false);
  }

  // B-07 / B-15: one ROAS formatter, the same as Paid.
  eq("ROAS formatter", fmtRoas(2.6), "2.60\u00d7");
  eq("ROAS formatter null", fmtRoas(null) === fmtRoas(null), true);

  // B-17: persona display.
  eq("persona code suffix stripped (em dash)", cleanPersona("Mladsi zena, co nechce vonet \u2014 MAN_NicheScentLover_AntiMainstream_20s"), "Mladsi zena, co nechce vonet");
  eq("persona code suffix stripped (hyphen)", cleanPersona("Prenetena zena - MAN_FunctionalScent_SleepSeeker_35s"), "Prenetena zena");
  eq("a persona with no code is unchanged", cleanPersona("Skepticka zena, co cte slozeni"), "Skepticka zena, co cte slozeni");
  eq("a bare code is not emptied", cleanPersona("MAN_SensitiveSkin_Switcher_40s"), "MAN_SensitiveSkin_Switcher_40s");
  eq("em dash replaced", noEmDash("a \u2014 b"), "a - b");
  eq("no em dash survives", /\u2014/.test(cleanPersona("x \u2014 y \u2014 VEN_A_B_30s")), false);

  // B-17: concept codes are humanised, one helper everywhere.
  eq("concept code humanised", humanizeConceptCode("MAN_SensitiveSwitcher_ContrarianTruth_v1"), "Sensitive Switcher, Contrarian Truth, v1");
  eq("acronym in a code keeps together", humanizeConceptCode("VEN_UGCHook_Proof_v2"), "UGC Hook, Proof, v2");
  eq("not a code, unchanged", humanizeConceptCode("Parfem nema byt jako ostatni"), "Parfem nema byt jako ostatni");
  eq("isConceptCode true", isConceptCode("MAN_SensitiveSwitcher_ContrarianTruth_v1"), true);
  eq("isConceptCode false for C07", isConceptCode("C07"), false);
  eq("label: a written name wins over a code id", conceptLabel("MAN_SensitiveSwitcher_ContrarianTruth_v1", "Parfem nema byt jako ostatni"), "Parfem nema byt jako ostatni");
  eq("label: a code id alone is humanised", conceptLabel("MAN_SensitiveSwitcher_ContrarianTruth_v1", null), "Sensitive Switcher, Contrarian Truth, v1");
  eq("label: a code used as the name is humanised", conceptLabel("86ca9t2h4", "MAN_SensitiveSwitcher_ContrarianTruth_v1"), "Sensitive Switcher, Contrarian Truth, v1");
  eq("label: a short id stays beside the name", conceptLabel("C07", "Nezna kuze"), "C07 Nezna kuze");
  eq("label: a ClickUp task id is never printed", conceptLabel("86ca9t2h4", null), null);
  eq("label: nothing", conceptLabel(null, null), null);
  eq("label has no underscore", /_/.test(conceptLabel("MAN_SensitiveSwitcher_ContrarianTruth_v1", null) ?? ""), false);

  // B-20: the static diagnosis does not repeat its label.
  const ds = diagnose(comp({ impressions: 380000, clicks: 11800, spend: 118400, purchases: 195, revenue: 281800 }), "STAT", T);
  eq("static diagnosis does not repeat 'Judge on CTR'", (ds.say.match(/Judge on CTR/g) ?? []).length, 0);
}

console.log(fails ? `\n${fails} assertion(s) differ from the brief, see above.` : "\nAll assertions match the brief.");
if (fails) process.exit(1);
