/**
 * Fixture checks for the Creative hit rate.
 *
 *     npx tsx --tsconfig scripts/tsconfig.json scripts/check-creative-hitrate.ts
 *
 * Offline, deterministic, no warehouse. Every rule of the hit-rate definition
 * (docs: 40_hit_rate_design.md, 2.2 to 2.4 and 3) is pinned here against a
 * hand-computed figure, so a change to `classify()`, to the maturity window or
 * to the exclusions shows up as a failed line rather than as a number that
 * quietly moves on a client's screen.
 *
 * The live comparison against the warehouse (the `hr_eval` logic, per client
 * and month) is a separate harness: this file needs no credentials.
 *
 * Exits non-zero on a mismatch.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BigQuery } from "@google-cloud/bigquery";
import { WINNER_MIN_AGE_DAYS, ZERO, classify, winnerEconomics, type AdRow } from "@/lib/creative/model";
import type { CreativeThresholds } from "@/lib/creative/stats";
import {
  HIT_RATE_MATURITY_DAYS,
  HIT_RATE_REFERENCE_LABEL,
  conceptSplit,
  deltaWithheld,
  eligible,
  hitRate,
  inRange,
  launchContext,
  launchMonths,
  launchStatus,
  packHitRate,
  referenceRate,
  referenceStart,
  tileText,
  trailingMonths,
  updatedLabel,
  type LaunchRow,
} from "@/lib/creative/hitRate";
import { FLOOR_MIN_ADS, percentile, relativeFloors, withFloors, isGenuineVideo, type VideoAdRates } from "@/lib/creative/floors";
import { diagnose } from "@/lib/creative/verdict";
import { roasTone } from "@/lib/creative/tone";
import { ATTRIBUTION_LABEL } from "@/lib/creative/attribution";
import { toDisplayThresholds, toHitRateThresholds, toThresholds, type StoredCreativeSettings } from "@/lib/creative/store";
import { ANCHOR_SQL, getLaunchAnchor } from "@/lib/queries/creativeLaunch";
import { VIDEO_FLOOR_SQL } from "@/lib/queries/creative";
import { HitRateTrend, rateCeiling, rateTicks } from "@/components/creative/HitRateTrend";
import { HitRateTile } from "@/components/paid/meta/HitRateTile";
import { demoLaunches } from "@/lib/demo/creative";
import { LAUNCH_SQL, getLaunches, launchFrom } from "@/lib/queries/creativeLaunch";

process.env.GCP_PROJECT_ID ??= "oneeighty-warehouse";

let fails = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  if (!pass) fails++;
  console.log(`${pass ? "ok  " : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
};

/** Manami's proposed bar: 15 purchases to be read, shrunk ROAS 2.25 to win. */
const T: CreativeThresholds = {
  killRoas: 1.8, targetRoas: 2.25, targetCpa: 527, grossMargin: 0.684,
  scaleMultiplier: 1.2, aggressiveMultiplier: 2.0,
  holdGateX: 1, iterateGateX: 2, killGateX: 3,
  readPurchases: 15, directionalPurchases: 6, maxCiHalfWidth: 0.25,
  hookRateFloor: 0.2, holdRateFloor: 0.05, frequencyWarn: 2, frequencyAct: 3,
  noTouchDays: 14, minAdsetBudgetDaily: null, perAdFloorDaily: null, tier: null,
};
const PRIOR = 2.0;

let seq = 0;
/** An ad that is a clear winner unless the overrides say otherwise. */
function ad(over: Partial<LaunchRow> = {}): LaunchRow {
  seq += 1;
  return {
    adId: `a${seq}`, adName: `Ad ${seq}`, firstDate: "2026-07-10", ageDays: 90,
    spend: 1000, revenue: 2800, purchases: 15,
    isVideo: false, isRelaunch: false, isPreexisting: false,
    conceptId: null, conceptName: null, priorRoas: PRIOR,
    ...over,
  };
}
const revenueFor = (spend: number, roas: number) => spend * roas;

// ── n < N is never a winner ──────────────────────────────────────────────────
{
  const huge = ad({ purchases: 14, spend: 1000, revenue: 20000 });
  ok("14 purchases at raw 20.00x is not a winner (N = 15)", launchStatus(huge, T) !== "winner");
  const exactly = ad({ purchases: 15 });
  ok("15 purchases at raw 2.80x is a winner", launchStatus(exactly, T) === "winner");
  ok("0 purchases is not a winner", launchStatus(ad({ purchases: 0, revenue: 0 }), T) !== "winner");
  ok("no spend is not a winner", launchStatus(ad({ spend: 0, revenue: 0, purchases: 20 }), T) !== "winner");
}

// ── The shrinkage is the one classify() uses ─────────────────────────────────
{
  // Hand arithmetic: (15 x 2.5 + 15 x 2.0) / 30 = 2.25 exactly, which clears 2.25.
  const onTheLine = ad({ purchases: 15, spend: 1000, revenue: revenueFor(1000, 2.5) });
  ok("shrunk 2.25 exactly (raw 2.50, prior 2.00, n = k = 15) wins", launchStatus(onTheLine, T) === "winner");
  const justUnder = ad({ purchases: 15, spend: 1000, revenue: revenueFor(1000, 2.49) });
  ok("shrunk 2.245 (raw 2.49) does not win", launchStatus(justUnder, T) !== "winner");
  // The same raw ROAS wins against a higher prior and loses against a lower one.
  const mid = ad({ purchases: 30, spend: 1000, revenue: 2400 });
  ok("raw 2.40 at n = 30 wins on prior 2.20 ((72 + 33) / 45 = 2.33)", launchStatus({ ...mid, priorRoas: 2.2 }, T) === "winner");
  ok("raw 2.40 at n = 30 loses on prior 1.00 ((72 + 15) / 45 = 1.93)", launchStatus({ ...mid, priorRoas: 1.0 }, T) !== "winner");

  // Identical to classify() across a grid, so the grid badge and the hit rate cannot disagree.
  let agree = 0;
  let cells = 0;
  for (const purchases of [0, 1, 5, 14, 15, 16, 30, 60]) {
    for (const roasRaw of [0, 0.5, 1.5, 1.8, 2.0, 2.25, 2.5, 3, 5, 12]) {
      for (const prior of [0.9, 2.0, 3.1]) {
        const spend = 800;
        const row = ad({ purchases, spend, revenue: spend * roasRaw, priorRoas: prior, ageDays: 200 });
        const direct = classify({ ...ZERO, spend, revenue: spend * roasRaw, purchases }, prior, T) === "winner";
        cells += 1;
        if ((launchStatus(row, T) === "winner") === direct) agree += 1;
      }
    }
  }
  ok("winner status equals classify() === 'winner' on every grid cell", agree === cells, `${agree}/${cells}`);

  // The prior is the row's own, so a different range cannot move it.
  const row = ad({ priorRoas: 2.0 });
  ok("status does not depend on any range", launchStatus(row, T) === launchStatus({ ...row, firstDate: "2025-01-01" }, T));
  ok("no prior means never a winner, and young means open", launchStatus(ad({ priorRoas: null, ageDays: 10 }), T) === "open");
  ok("no prior and old means settled", launchStatus(ad({ priorRoas: null, ageDays: 100 }), T) === "settled");
}

// ── Open = not a winner and under 60 days ────────────────────────────────────
{
  const loser = { purchases: 3, revenue: 500 };
  ok("not a winner at 59 days is open", launchStatus(ad({ ...loser, ageDays: 59 }), T) === "open");
  ok("not a winner at 60 days is settled", launchStatus(ad({ ...loser, ageDays: 60 }), T) === "settled");
  ok("maturity window is 60 days", HIT_RATE_MATURITY_DAYS === 60);
  ok("ME3 C9: a winner under 14 days old is open, not a winner", launchStatus(ad({ ageDays: 5 }), T) === "open");
  ok("ME3 C9: 13 days is open, 14 days is a winner", launchStatus(ad({ ageDays: 13 }), T) === "open" && launchStatus(ad({ ageDays: 14 }), T) === "winner" && WINNER_MIN_AGE_DAYS === 14);
  const rows = [ad({ ageDays: 20 }), ad({ ...loser, ageDays: 20 }), ad({ ...loser, ageDays: 120 })];
  const h = hitRate(rows, T);
  ok("counts: 3 launched, 1 winner, 1 open", h.launched === 3 && h.winners === 1 && h.open === 1, JSON.stringify(h));
  ok("a cohort with an open ad is maturing", h.maturing === true);
  ok("a cohort with none open is not", hitRate([ad(), ad({ ...loser, ageDays: 90 })], T).maturing === false);
}

// ── Relaunches and pre-existing ads leave both sides ─────────────────────────
{
  const rows = [ad(), ad({ isRelaunch: true }), ad({ isPreexisting: true }), ad({ purchases: 2, revenue: 100 })];
  const h = hitRate(rows, T);
  ok("a relaunch is not launched and not a winner", h.launched === 2 && h.winners === 1, JSON.stringify(h));
  ok("hit rate = 1 of 2 = 50% (the relaunched winner is not counted twice)", h.rate === 0.5);
  const inflated = hitRate([ad(), ad({ purchases: 2, revenue: 100 })], T);
  ok("with the relaunch removed the result is unchanged", inflated.rate === h.rate && inflated.launched === h.launched);
  ok("eligible() drops both kinds", eligible(rows).length === 2);
  ok("only relaunches: 0 launched, rate null", hitRate([ad({ isRelaunch: true })], T).rate === null);
}

// ── Missing thresholds: n/a with a launched count ────────────────────────────
{
  const rows = [ad(), ad(), ad({ isRelaunch: true })];
  const h = hitRate(rows, null);
  ok("no thresholds: rate null, winners null, launched counted", h.rate === null && h.winners === null && h.open === null && h.launched === 2, JSON.stringify(h));
  const t = tileText(h, null);
  ok("no thresholds: tile is n/a, sub '2 launched', info points to Settings", t.value === null && t.sub === "2 launched" && t.info === "Set a target ROAS in Settings.", JSON.stringify(t));
  const m = launchMonths(rows, null, "2026-09-30", { from: "2026-07-01", to: "2026-09-30" });
  ok("no thresholds: every month's rate is null, never 0", m.every((x) => x.rate === null && x.winners === null));
  ok("no thresholds: launches still counted per month", m.find((x) => x.month === "2026-07")?.launched === 2);
}

// ── Not ready is n/a, never zero ─────────────────────────────────────────────
{
  const t = tileText(null, T);
  ok("not ready: n/a with one line", t.value === null && t.sub === "Not ready" && t.info === "Launch data is not ready.", JSON.stringify(t));
  const none = tileText(hitRate([], T), T);
  ok("ready with no launches: n/a, '0 launched'", none.value === null && none.sub === "0 launched", JSON.stringify(none));
}

// ── The tile text ────────────────────────────────────────────────────────────
{
  const rows: LaunchRow[] = [];
  for (let i = 0; i < 9; i++) rows.push(ad());
  for (let i = 0; i < 95; i++) rows.push(ad({ purchases: 1, revenue: 10, ageDays: 200 }));
  for (let i = 0; i < 18; i++) rows.push(ad({ purchases: 1, revenue: 10, ageDays: 10 }));
  const t = tileText(hitRate(rows, T), T, 0.074);
  ok("9 of 122, 18 open reads '7.4%'", t.value === "7.4%", String(t.value));
  ok("sub '9 of 122 launched · 18 open'", t.sub === "9 of 122 launched · 18 open", t.sub);
  ok("info names the client's own bar, the age rule and the client's own reference", t.info.includes("15+ purchases") && t.info.includes("2.25+") && t.info.includes("14+ days") && t.info.includes(`${HIT_RATE_REFERENCE_LABEL}: 7.4%`), t.info);
  ok("ME3 C10: no fixed 5% anywhere in the tile text", !tileText(hitRate(rows, T), T, null).info.includes("5%") && !tileText(hitRate(rows, T), T, null).info.includes("Reference"));
  ok("info is at most 40 words", t.info.split(/\s+/).length <= 40);
  const noOpen = tileText(hitRate(rows.slice(0, 104), T), T);
  ok("no open ads: no '· open' suffix", !noOpen.sub.includes("open"), noOpen.sub);
}

// ── By launch month ──────────────────────────────────────────────────────────
{
  ok("trailing months cross a year boundary", trailingMonths("2026-02-14", 4).join() === "2025-11,2025-12,2026-01,2026-02");
  ok("twelve months by default", trailingMonths("2026-09-30").length === 12 && trailingMonths("2026-09-30")[0] === "2025-10");

  const rows = [
    ad({ firstDate: "2026-07-03" }), ad({ firstDate: "2026-07-20", purchases: 2, revenue: 80 }),
    ad({ firstDate: "2026-09-02", ageDays: 28, purchases: 4, revenue: 120 }),
    ad({ firstDate: "2025-12-01", isRelaunch: true }),
  ];
  const m = launchMonths(rows, T, "2026-09-30", { from: "2026-09-01", to: "2026-09-30" });
  const by = Object.fromEntries(m.map((x) => [x.month, x]));
  ok("July: 1 of 2 = 50%", by["2026-07"].launched === 2 && by["2026-07"].winners === 1 && by["2026-07"].rate === 0.5);
  ok("September is maturing with 1 open and 0 winners", by["2026-09"].maturing && by["2026-09"].open === 1 && by["2026-09"].rate === 0);
  ok("a month with no launches has rate null (a dash), not 0", by["2026-08"].launched === 0 && by["2026-08"].rate === null);
  ok("a relaunch-only month is empty, not a 0% bar", by["2025-12"].launched === 0 && by["2025-12"].rate === null);
  ok("only September is highlighted as in range", m.filter((x) => x.inRange).map((x) => x.month).join() === "2026-09");
  ok("an old, settled month is not maturing", by["2026-07"].maturing === false);

  const wide = launchMonths(rows, T, "2026-09-30", { from: "2026-07-15", to: "2026-09-30" });
  ok("a range from mid-July highlights July, August and September", wide.filter((x) => x.inRange).map((x) => x.month).join() === "2026-07,2026-08,2026-09");

  // Pooled: the rollup is sum over sum, not the mean of monthly rates.
  const pool = hitRate(rows.slice(0, 3), T);
  ok("pooled rate over the three months is 1 of 3, not an average of 50% and 0%", pool.launched === 3 && pool.winners === 1);

  const mix = [ad({ isVideo: true }), ad({ isVideo: false, purchases: 1, revenue: 5 }), ad({ isVideo: false })];
  const vid = launchMonths(mix, T, "2026-07-31", { from: "2026-07-01", to: "2026-07-31" }, "video").find((x) => x.month === "2026-07")!;
  const sta = launchMonths(mix, T, "2026-07-31", { from: "2026-07-01", to: "2026-07-31" }, "static").find((x) => x.month === "2026-07")!;
  ok("format filter: video 1 of 1", vid.launched === 1 && vid.winners === 1);
  ok("format filter: static 1 of 2", sta.launched === 2 && sta.winners === 1);
  ok("inRange keeps ads by first delivery", inRange(rows, { from: "2026-07-01", to: "2026-07-31" }).length === 2);
}

// ── Concept split only when at least half are tagged ─────────────────────────
{
  const untagged = [ad(), ad(), ad(), ad({ conceptId: "C1", conceptName: "One" })];
  ok("1 of 4 tagged: split hidden", conceptSplit(untagged, T) === null);
  const half = [ad({ conceptId: "C1", conceptName: "One" }), ad({ conceptId: "C1", conceptName: "One", purchases: 1, revenue: 5 }), ad(), ad({ conceptId: "C2", conceptName: "Two" })];
  const s = conceptSplit(half, T);
  ok("3 of 4 tagged: split shown", s !== null && s.taggedShare === 0.75);
  ok("tagged concepts first by launches, Untagged last", s !== null && s.rows.map((r) => r.label).join() === "One,Two,Untagged", s?.rows.map((r) => r.label).join());
  ok("concept One: 1 of 2", s?.rows[0].winners === 1 && s?.rows[0].launched === 2);
  ok("no launches: no split", conceptSplit([], T) === null);
}

// ── Chart scale ──────────────────────────────────────────────────────────────
{
  const flat = launchMonths([], T, "2026-09-30", { from: "2026-09-01", to: "2026-09-30" });
  ok("an empty chart still has a floor of 5% on the axis", rateCeiling(flat) >= 0.05);
  ok("the ceiling clears the client's own reference line", rateCeiling(flat, 0.31) >= 0.31);
  const ceiling = rateCeiling(launchMonths([ad()], T, "2026-07-31", { from: "2026-07-01", to: "2026-07-31" }));
  ok("a 100% bar fits under the ceiling", ceiling >= 1, String(ceiling));
  ok("ticks start at 0 and end at or under the ceiling", rateTicks(0.2)[0] === 0 && rateTicks(0.2).at(-1)! <= 0.2 + 1e-9);
}

// ── What the components render ───────────────────────────────────────────────
{
  const rows = [
    ad({ firstDate: "2026-07-03" }), ad({ firstDate: "2026-07-20", purchases: 2, revenue: 80 }),
    ad({ firstDate: "2026-09-02", ageDays: 28, purchases: 4, revenue: 120 }),
  ];
  const months = launchMonths(rows, T, "2026-09-30", { from: "2026-07-01", to: "2026-09-30" });
  const hrefs = { all: "/creative", video: "/creative?hrfmt=video", static: "/creative?hrfmt=static" };
  const html = renderToStaticMarkup(
    createElement(HitRateTrend, { state: "ready", months, format: "all", hrefs, concepts: null, reference: 0.074 })
  );
  ok("trend shows W/n labels", html.includes(">1/2<") && html.includes(">0/1<"));
  ok("a maturing month with no winner says how many are open", html.includes("1 open"));
  const young = launchMonths([ad({ firstDate: "2026-09-02", ageDays: 20 }), ad({ firstDate: "2026-09-05", ageDays: 20, purchases: 1, revenue: 9 })], T, "2026-09-30", { from: "2026-09-01", to: "2026-09-30" });
  const youngHtml = renderToStaticMarkup(createElement(HitRateTrend, { state: "ready", months: young, format: "all", hrefs, concepts: null }));
  ok("a maturing month with a bar is hatched, with the open count", youngHtml.includes('fill="url(#hr-hatch)"') && youngHtml.includes("1 open") && youngHtml.includes(">1/2<"));
  ok("a settled month is solid", html.includes('fill="var(--positive)"'));
  ok("ME3 C10: trend draws the client's own 12-month rate as the reference", html.includes("YOUR 12-MO RATE 7.4%") && !html.includes("REF. ~5%") && !html.includes("REF."));
  const noRef = renderToStaticMarkup(createElement(HitRateTrend, { state: "ready", months, format: "all", hrefs, concepts: null }));
  ok("ME3 C10: no reference, no line and no label", !noRef.includes("stroke-dasharray") && !noRef.includes("12-MO"));
  ok("an empty month shows a dash", html.includes(">-<"));
  ok("trend has the format control", html.includes("Video") && html.includes("Static") && html.includes('aria-current="true"'));
  ok("trend renders no em dash", !html.includes("\u2014"));

  const nr = renderToStaticMarkup(createElement(HitRateTrend, { state: "not-ready", months: [], format: "all", hrefs, concepts: null }));
  ok("not ready: one line, no chart, no control", nr.includes("Launch data is not ready.") && !nr.includes("<svg") && !nr.includes("Video"));
  const nt = renderToStaticMarkup(createElement(HitRateTrend, { state: "no-thresholds", months: [], format: "all", hrefs, concepts: null }));
  ok("no thresholds: one line, no chart", nt.includes("Set a target ROAS in Settings.") && !nt.includes("<svg"));
  const none = renderToStaticMarkup(createElement(HitRateTrend, { state: "ready", months: launchMonths([], T, "2026-09-30", { from: "2026-09-01", to: "2026-09-30" }), format: "all", hrefs, concepts: null }));
  ok("ready with no launches: says so, no bars", none.includes("No launches in these months.") && !none.includes("<rect x"));

  const split = conceptSplit([ad({ conceptId: "C1", conceptName: "One" })], T);
  const withSplit = renderToStaticMarkup(createElement(HitRateTrend, { state: "ready", months, format: "all", hrefs, concepts: split?.rows ?? null }));
  ok("concept table renders when given", withSplit.includes("<table") && withSplit.includes(">One<"));

  const text = tileText(hitRate(rows, T), T);
  const tile = renderToStaticMarkup(createElement(HitRateTile, { text, href: "/creative?client=x", needsThresholds: false }));
  ok("Paid tile shows the same value and sub as the Creative tile", tile.includes(String(text.value)) && tile.includes(text.sub));
  ok("Paid tile links to Creatives", tile.includes('href="/creative?client=x"'));
  const tileNt = renderToStaticMarkup(createElement(HitRateTile, { text: { ...tileText(hitRate(rows, null), null), sub: "Set thresholds" }, href: "/creative", needsThresholds: true }));
  ok("Paid tile without thresholds: n/a, 'Set thresholds', links to Settings", tileNt.includes("n/a") && tileNt.includes("Set thresholds") && tileNt.includes('href="/settings"'));
  const tileNr = renderToStaticMarkup(createElement(HitRateTile, { text: tileText(null, T), href: "/creative", needsThresholds: false }));
  ok("Paid tile not ready: n/a, 'Not ready'", tileNr.includes("n/a") && tileNr.includes("Not ready") && !tileNr.includes(">0%<"));
}

// ── ME3 C9: the 14-day winner rule is in the one shared classify path ───────
{
  const strong = { ...ZERO, spend: 1000, revenue: 2800, purchases: 15 };
  ok("classify: old enough is a winner", classify(strong, 2.0, T, 14) === "winner" && classify(strong, 2.0, T, 400) === "winner");
  ok("classify: under 14 days is open, not carrier or loser", classify(strong, 2.0, T, 13) === "open" && classify(strong, 2.0, T, 0) === "open");
  ok("classify: unknown age applies no rule", classify(strong, 2.0, T) === "winner" && classify(strong, 2.0, T, null) === "winner");
  const weak = { ...ZERO, spend: 2000, revenue: 2000, purchases: 20 };
  ok("classify: age never turns a loser or carrier into anything else", classify(weak, 2.0, T, 3) === classify(weak, 2.0, T, 300));

  const mk = (id: string, c: Partial<typeof strong>): AdRow => ({
    adId: id, adName: id, adsetId: null, adsetName: null, campaignId: null, campaignName: null,
    tags: {} as AdRow["tags"], components: { ...ZERO, ...c }, monthlySpend: [],
  });
  const ads = [mk("old", strong), mk("young", strong), mk("weak", weak)];
  const ages: Record<string, number> = { old: 60, young: 12, weak: 60 };
  const w = winnerEconomics(ads, 2.0, T, (id) => ages[id] ?? null);
  ok("scorecard: the 12-day-old ad is not a winner, it is open", w.winners === 1 && w.open === 1 && w.decided === 2, JSON.stringify(w));
  ok("scorecard without ages is the old behaviour (age unknown, no rule)", winnerEconomics(ads, 2.0, T).winners === 2);

  // The scorecard, the grid and the hit rate say the same thing for the same ad.
  let same = 0;
  let cells = 0;
  for (const age of [0, 5, 13, 14, 15, 59, 60, 200]) {
    for (const p of [10, 15, 40]) {
      for (const roas of [1.2, 2.25, 2.6, 4]) {
        const row = ad({ ageDays: age, purchases: p, spend: 1000, revenue: 1000 * roas, priorRoas: 2.0 });
        const viaTile = launchStatus(row, T) === "winner";
        const viaGrid = classify({ ...ZERO, spend: 1000, revenue: 1000 * roas, purchases: p }, 2.0, T, age) === "winner";
        const viaCard = winnerEconomics([mk("x", { spend: 1000, revenue: 1000 * roas, purchases: p })], 2.0, T, () => age).winners === 1;
        cells += 1;
        if (viaTile === viaGrid && viaGrid === viaCard) same += 1;
      }
    }
  }
  ok("ME3 C3: tile, grid and scorecard agree on every age x purchases x ROAS cell", same === cells, `${same}/${cells}`);
}

// ── ME3 C3: the grid colour follows classify(), directional gets 'promising' ─
{
  const lines = { directionalPurchases: 6, targetRoas: 2.25, killRoas: 1.8 };
  ok("tone: a read winner is winner", roasTone({ purchases: 40, roas: 2.6, outcome: "winner" }, lines) === "winner");
  ok("tone: above target but not a winner (directional) is promising, not winner", roasTone({ purchases: 9, roas: 3.1, outcome: "open" }, lines) === "promising");
  ok("tone: above target and read but too young is promising", roasTone({ purchases: 30, roas: 2.6, outcome: "open" }, lines) === "promising");
  ok("tone: under the directional gate is muted whatever the ROAS", roasTone({ purchases: 3, roas: 9, outcome: "open" }, lines) === "muted");
  ok("tone: below the kill line is negative, between the lines neutral", roasTone({ purchases: 40, roas: 1.2, outcome: "loser" }, lines) === "negative" && roasTone({ purchases: 40, roas: 2.0, outcome: "carrier" }, lines) === "neutral");
  const display = { ...T, targetRoas: Number.POSITIVE_INFINITY, killRoas: 0 };
  ok("tone: with no lines set nothing is coloured", roasTone({ purchases: 40, roas: 9, outcome: classify({ ...ZERO, spend: 1000, revenue: 9000, purchases: 40 }, 2, display, 99) }, { directionalPurchases: 6, targetRoas: Infinity, killRoas: 0 }) === "neutral");
}

// ── ME3 C4: hit rate independent of Target CPA, CPA unit, no 'Body problem' at CPA 0 ─
{
  const base: StoredCreativeSettings = {
    clientId: "venev", breakEvenRoas: 1.89, killRoas: 1.9, targetRoas: 2.1, targetCpa: null, grossMargin: null,
    scaleMultiplier: 1.2, aggressiveMultiplier: 2, holdGateX: 1, iterateGateX: 2, killGateX: 3,
    minAdsetBudgetDaily: null, perAdFloorDaily: null, monthlyBudget: null, noTouchDays: 14, tier: null,
    readPurchases: 10, directionalPurchases: 5, maxCiHalfWidth: 0.25, hookRateFloor: 0.2, holdRateFloor: 0.05,
    frequencyWarn: 2, frequencyAct: 3, testPurchases: 25, packsPerMonthTarget: 2, hooksPerBodyTarget: 6,
    netNewShareTarget: 0.2, updatedAt: null, updatedBy: null,
  };
  ok("no CPA: verdict thresholds stay null (verdicts and spend gates need it)", toThresholds(base) === null);
  const hit = toHitRateThresholds(base);
  ok("no CPA: the hit rate still has thresholds (target + read threshold)", hit !== null && hit.targetRoas === 2.1 && hit.readPurchases === 10);
  ok("no target: no hit rate thresholds", toHitRateThresholds({ ...base, targetRoas: null }) === null);
  ok("no kill line: hit rate thresholds still exist, kill reads 0", toHitRateThresholds({ ...base, killRoas: null })?.killRoas === 0);
  const full = toThresholds({ ...base, targetCpa: 783 })!;
  ok("with a CPA the hit rate and verdict thresholds agree on every winner input", hit !== null && hit.targetRoas === full.targetRoas && hit.readPurchases === full.readPurchases);
  const row = ad({ purchases: 12, spend: 1000, revenue: 2900, priorRoas: 2.0 });
  ok("a winner is a winner with or without a CPA", launchStatus(row, hit!) === launchStatus(row, full));
  ok("hit rate without CPA is a number", hitRate([row, ad({ purchases: 1, revenue: 5 })], hit!).rate === 0.5);

  const noCpa = toDisplayThresholds(base);
  ok("display thresholds carry CPA 0 when none is set", noCpa.targetCpa === 0);
  const orphan = diagnose({ ...ZERO, impressions: 50000, clicks: 900, spend: 5000, purchases: 0 }, "STAT", noCpa);
  ok("diagnose: a zero-purchase ad is NOT 'Body problem' when there is no CPA", orphan.code !== "body-problem", orphan.code);
  const vid = diagnose({ ...ZERO, impressions: 200000, videoPlays: 90000, videoViews: 48000, videoThruplays: 14000, clicks: 4800, spend: 30000, purchases: 0 }, "DYN", noCpa);
  ok("diagnose: same for video", vid.code !== "body-problem", vid.code);
  const withCpa = diagnose({ ...ZERO, impressions: 50000, clicks: 900, spend: 5000, purchases: 0 }, "STAT", { ...noCpa, targetCpa: 500 });
  ok("diagnose: with a CPA the body problem still fires", withCpa.code === "body-problem");
}

// ── ME3 C5: relative hook and hold floors ───────────────────────────────────
{
  ok("percentile: linear interpolation like PERCENTILE_CONT", percentile([1, 2, 3, 4], 0.25) === 1.75 && percentile([5], 0.25) === 5 && percentile([], 0.25) === null && percentile([0, 10], 0.5) === 5);
  const vids = (n: number, hook: (i: number) => number, hold: (i: number) => number): VideoAdRates[] =>
    Array.from({ length: n }, (_, i) => ({ impressions: 100000, plays: hook(i) * 100000, thruplays: hold(i) * 100000, starts: 60000 }));
  const fallback = { hookRateFloor: 0.2, holdRateFloor: 0.05 };
  const few = relativeFloors(vids(FLOOR_MIN_ADS - 1, () => 0.3, () => 0.08), fallback);
  ok("fewer than 15 genuine video ads: the stored floors apply, labelled fallback", few.basis === "fallback" && few.hookRateFloor === 0.2 && few.holdRateFloor === 0.05 && few.ads === 14);
  const fifteen = relativeFloors(vids(15, (i) => 0.2 + i * 0.01, (i) => 0.03 + i * 0.002), fallback);
  // p25 of 15 values is index 3.5: hook 0.2 + 0.035 = 0.235, hold 0.03 + 0.007 = 0.037.
  ok("15 genuine ads: p25 of hook and of hold, labelled relative", fifteen.basis === "relative" && Math.abs(fifteen.hookRateFloor - 0.235) < 1e-9 && Math.abs(fifteen.holdRateFloor - 0.037) < 1e-9 && fifteen.ads === 15, JSON.stringify(fifteen));
  const banners: VideoAdRates[] = Array.from({ length: 30 }, () => ({ impressions: 100000, plays: 500, thruplays: 100, starts: 3000 }));
  const mixed = relativeFloors([...vids(15, (i) => 0.2 + i * 0.01, (i) => 0.03 + i * 0.002), ...banners], fallback);
  ok("banners with incidental video starts (3% of impressions) are not in the percentile", mixed.ads === 15 && Math.abs(mixed.hookRateFloor - 0.235) < 1e-9);
  ok("genuine video: 30% starts and 5,000 impressions", isGenuineVideo({ impressions: 5000, plays: 1000, thruplays: 300, starts: 1500 }) && !isGenuineVideo({ impressions: 4999, plays: 1000, thruplays: 300, starts: 3000 }) && !isGenuineVideo({ impressions: 10000, plays: 1000, thruplays: 300, starts: 2999 }));
  const t2 = withFloors(T, fifteen);
  ok("withFloors replaces the two floors and nothing else", t2.hookRateFloor === fifteen.hookRateFloor && t2.holdRateFloor === fifteen.holdRateFloor && t2.targetRoas === T.targetRoas && t2.floorBasis === "relative");
  ok("withFloors with no data leaves the thresholds as they were", withFloors(T, null) === T);
  const d = diagnose({ ...ZERO, impressions: 200000, videoPlays: 90000, videoViews: 40000, videoThruplays: 14000, clicks: 4800, spend: 30000, purchases: 51 }, "DYN", t2);
  ok("a hook under the relative floor says whose floor it is", d.code === "hook-problem" && d.say.includes("your p25 of video ads") && d.say.includes("23.5%"), d.say);
  const d0 = diagnose({ ...ZERO, impressions: 200000, videoPlays: 90000, videoViews: 30000, videoThruplays: 14000, clicks: 4800, spend: 30000, purchases: 51 }, "DYN", T);
  ok("the stored floor keeps its old wording", d0.code === "hook-problem" && !d0.say.includes("p25"), d0.say);
  ok("floor SQL: genuine video only, 180 days, 5,000 impressions, one client", /SAFE_DIVIDE\(SUM\(p\.video_play_actions\), SUM\(p\.impressions\)\) >= 0\.3/.test(VIDEO_FLOOR_SQL) && VIDEO_FLOOR_SQL.includes("INTERVAL 180 DAY") && VIDEO_FLOOR_SQL.includes(">= 5000") && VIDEO_FLOOR_SQL.includes("@clientId") && !VIDEO_FLOOR_SQL.includes("\u2014"));
}

// ── ME3 C6: when the table was built, and the delta while maturing ──────────
{
  const now = new Date("2026-10-05T12:00:00Z");
  ok("same day, Prague time: 'Updated 10:10'", updatedLabel("2026-10-05T08:10:12Z", now) === "Updated 10:10", String(updatedLabel("2026-10-05T08:10:12Z", now)));
  ok("an older build shows the day: 'Updated 3 Oct 10:10'", updatedLabel("2026-10-03T08:10:12Z", now) === "Updated 3 Oct 10:10", String(updatedLabel("2026-10-03T08:10:12Z", now)));
  ok("no timestamp or a bad one shows nothing", updatedLabel(null, now) === null && updatedLabel("not a date", now) === null);
  const maturing = { launched: 10, winners: 1, open: 3, rate: 0.1, maturing: true };
  const settled = { launched: 12, winners: 2, open: 0, rate: 0.17, maturing: false };
  ok("delta withheld: current maturing against a settled comparison", deltaWithheld(maturing, settled) === true);
  ok("delta kept: both settled, both maturing, or the current one settled", deltaWithheld(settled, settled) === false && deltaWithheld(maturing, maturing) === false && deltaWithheld(settled, maturing) === false);
}

// ── ME3 C10: the reference is the client's own trailing 365 days ────────────
{
  ok("the reference window starts 364 days before through (365 days inclusive)", referenceStart("2026-10-04") === "2025-10-05" && referenceStart("2026-03-01") === "2025-03-02");
  const rows = [
    ad({ firstDate: "2025-10-05" }),                         // first day of the window, a winner
    ad({ firstDate: "2025-10-04" }),                         // one day too old: out
    ad({ firstDate: "2026-02-01", purchases: 1, revenue: 5 }),
    ad({ firstDate: "2026-09-01", purchases: 1, revenue: 5 }),
    ad({ firstDate: "2026-02-01", isRelaunch: true }),        // relaunch: out
  ];
  ok("reference = winners / launched over the 365 days: 1 of 3", referenceRate(rows, T, "2026-10-04") === 1 / 3);
  ok("reference is null without thresholds and without launches", referenceRate(rows, null, "2026-10-04") === null && referenceRate([], T, "2026-10-04") === null);
  ok("there is no fixed 5% constant any more", !Object.keys(require("@/lib/creative/hitRate")).includes("HIT_RATE_REFERENCE"));
}

// ── ME3 C7: launch context and pack-level hit rate ───────────────────────────
{
  const range = { from: "2026-01-01", to: "2026-09-30" };
  const L = (over: Partial<LaunchRow>) => ad({ adsetId: "s1", adsetFirstDate: "2026-03-01", isNewAdset: true, ...over });
  const win = { purchases: 20, revenue: 2800 };
  const lose = { purchases: 2, revenue: 50 };
  const rows = [
    L({ adId: "a", adsetId: "s1", ...win }),
    L({ adId: "b", adsetId: "s1", ...lose, isNewAdset: false }),
    L({ adId: "c", adsetId: "s2", adsetFirstDate: "2026-04-01", ...lose }),
    L({ adId: "d", adsetId: "s2", adsetFirstDate: "2026-04-01", ...lose, isNewAdset: false }),
    L({ adId: "e", adsetId: "s3", adsetFirstDate: "2025-06-01", ...win, isNewAdset: false }),   // an old ad set
    L({ adId: "f", adsetId: null, adsetFirstDate: null, ...lose, isNewAdset: null }),
    L({ adId: "g", adsetId: "s4", adsetFirstDate: "2026-05-01", ...lose, isRelaunch: true }),   // relaunch: out
  ];
  const ctx = launchContext(rows, T);
  ok("context: new ad set 2 launched 1 winner; existing 3 launched 1 winner; 1 unknown", ctx.ready && ctx.newAdset.launched === 2 && ctx.newAdset.winners === 1 && ctx.existing.launched === 3 && ctx.existing.winners === 1 && ctx.unknown === 1 && ctx.launches === 6, JSON.stringify(ctx));
  ok("context: rates", ctx.newAdset.rate === 0.5 && Math.abs((ctx.existing.rate ?? 0) - 1 / 3) < 1e-12);
  const packs = packHitRate(rows, T, range);
  ok("packs: ad sets first delivered in range with a winner (s1 yes, s2 no; s3 is old, s4 only a relaunch)", packs.ready && packs.launched === 2 && packs.winners === 1 && packs.rate === 0.5, JSON.stringify(packs));
  ok("packs: an ad added later to a new ad set counts toward the pack", packHitRate([L({ adId: "p", adsetId: "s9", ...lose }), L({ adId: "q", adsetId: "s9", ...win, isNewAdset: false })], T, range).winners === 1);
  const open = packHitRate([L({ adId: "o", adsetId: "s7", ...lose, ageDays: 20 })], T, range);
  ok("packs: no winner and a young ad is open, rate is a lower bound", open.open === 1 && open.maturing === true && open.winners === 0);
  const old = rows.map((r) => ({ ...r, adsetId: undefined, adsetFirstDate: undefined, isNewAdset: undefined }));
  ok("columns missing: context and packs are not ready, never a split of zeros", launchContext(old, T).ready === false && packHitRate(old, T, range).ready === false);
  ok("no thresholds: counts but no winners", launchContext(rows, null).newAdset.winners === null && packHitRate(rows, null, range).winners === null && packHitRate(rows, null, range).launched === 2);
  ok("nothing launched: not ready (the chart already says so)", launchContext([], T).ready === false && launchContext([], T).launches === 0);
  const hrefs = { all: "/creative", video: "/creative?hrfmt=video", static: "/creative?hrfmt=static" };
  const months = launchMonths(rows, T, "2026-09-30", range);
  const html = renderToStaticMarkup(createElement(HitRateTrend, { state: "ready", months, format: "all", hrefs, concepts: null, context: ctx, packs }));
  ok("trend shows the context block with both rows and the pack row", html.includes("Launch context") && html.includes("New ad set") && html.includes("Added to existing ad set") && html.includes("Packs (new ad sets) with a winner"));
  const nr = renderToStaticMarkup(createElement(HitRateTrend, { state: "ready", months, format: "all", hrefs, concepts: null, context: launchContext(old, T), packs: packHitRate(old, T, range) }));
  ok("columns missing: one muted line, no table", nr.includes("Launch context is not ready.") && !nr.includes("New ad set"));
}

// ── ME3 C2: one attribution label, and it is not the old literal ────────────
{
  ok("the label says what is true", ATTRIBUTION_LABEL === "7-day click + 1-day view");
  const { readFileSync, readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f: string) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
  const root = join(__dirname, "..");
  const hits = [...walk(join(root, "components")), ...walk(join(root, "app")), ...walk(join(root, "lib"))].filter((f) => /customers excluded/i.test(readFileSync(f, "utf8")) && !f.endsWith("attribution.ts"));
  ok("no screen prints '7-day click, customers excluded' any more", hits.length === 0, hits.join(", "));
  const bar = renderToStaticMarkup(createElement(require("@/components/creative/CreativeBar").CreativeBar, { unmapped: 0, through: "2026-10-04", updated: "Updated 10:10", currency: "CZK", href: "#u" }));
  ok("the bar prints the label from the constant, the date and 'Updated 10:10'", bar.includes(ATTRIBUTION_LABEL) && bar.includes("through 2026-10-04") && bar.includes("Updated 10:10"));
  ok("the bar without a build time shows no 'Updated'", !renderToStaticMarkup(createElement(require("@/components/creative/CreativeBar").CreativeBar, { unmapped: 0, through: "2026-10-04", currency: "CZK", href: "#u" })).includes("Updated"));
}

// ── ME5: the decision basis is 7-day click + 1-day view everywhere ──────────
{
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
  const { basisPurchasesSql, basisRevenueSql } = require("@/lib/creative/attribution") as typeof import("@/lib/creative/attribution");
  const { metaBasisSql } = require("@/lib/queries/metaBasis") as typeof import("@/lib/queries/metaBasis");

  ok("basis SQL falls back to the stored figure when the split is missing", basisPurchasesSql() === "COALESCE(purchases_7dc_1dv, purchases)" && basisRevenueSql("a") === "COALESCE(a.revenue_7dc_1dv, a.revenue)");
  const q1 = metaBasisSql("p", { byCampaign: true, ccy: "meta", dateClause: "date BETWEEN @from AND @to" });
  ok("campaign basis (Meta currency): ad mart summed per campaign and day, no fx", q1.includes("GROUP BY a.date, a.campaign_id") && q1.includes("mart_meta_ad_perf") && q1.includes("a.date BETWEEN @from AND @to") && !q1.includes("fx_rates"));
  const q2 = metaBasisSql("p", { byCampaign: false, ccy: "client", dateClause: "date BETWEEN @scanFrom AND @scanTo" });
  ok("day basis (client currency): same monthly rate as the marts, identity when equal", q2.includes("IF(cl.meta_currency = cl.currency, NUMERIC '1', mfx.rate)") && q2.includes("mfx.month_start   = DATE_TRUNC(a.date, MONTH)") && q2.includes("GROUP BY a.date") && !q2.includes("campaign_id"));

  // launchFrom: the winner test reads the basis columns, not the stored ones.
  const base = { ad_id: "1", ad_name: "A", first_date: { value: "2026-07-01" }, age_days: 60, spend: "1000", is_video: true, is_relaunch: false, is_preexisting: false };
  const withBasis = launchFrom({ ...base, revenue: "2600", purchases: 16, prior_roas: "2.0", revenue_7dc_1dv: "2700", purchases_7dc_1dv: 18, prior_roas_7dc_1dv: "2.1" });
  ok("launchFrom: purchases, revenue and prior come from the 7dc_1dv columns", withBasis.purchases === 18 && withBasis.revenue === 2700 && withBasis.priorRoas === 2.1);
  const legacyOnly = launchFrom({ ...base, revenue: "2600", purchases: 16, prior_roas: "2.0" });
  ok("launchFrom: a table without the columns reads the stored ones", legacyOnly.purchases === 16 && legacyOnly.revenue === 2600 && legacyOnly.priorRoas === 2.0);
  const incomplete = launchFrom({ ...base, revenue: "2600", purchases: 16, prior_roas: "2.0", revenue_7dc_1dv: null, purchases_7dc_1dv: null, prior_roas_7dc_1dv: null });
  ok("launchFrom: a NULL basis (split incomplete) is never a winner, as in the Reports compiler", incomplete.purchases === 0 && incomplete.priorRoas === null && launchStatus(incomplete, T) !== "winner");
  const flip = launchFrom({ ...base, revenue: "2600", purchases: 16, prior_roas: "2.0", revenue_7dc_1dv: "1500", purchases_7dc_1dv: 12, prior_roas_7dc_1dv: "2.0" });
  ok("the stored columns no longer decide: a winner on them that fails on the basis is not one", launchStatus(launchFrom({ ...base, revenue: "2600", purchases: 16, prior_roas: "2.0" }), T) === "winner" && launchStatus(flip, T) !== "winner");

  ok("anchor reads the basis prior", /prior_roas_7dc_1dv AS prior_roas/.test(ANCHOR_SQL));
  const creativeSrc = src("lib/queries/creative.ts");
  ok("Creative grid and account totals sum the basis columns", (creativeSrc.match(/SUM\(\$\{basisRevenueSql\(\)\}\) AS revenue, SUM\(\$\{basisPurchasesSql\(\)\}\) AS purchases/g) ?? []).length === 2);
  const metaSrc = src("lib/queries/paidMeta.ts");
  ok("Paid Meta: campaign rows overlay the ad mart basis; ads and the ad set rollup read the basis", metaSrc.includes("metaBasisSql(PROJECT_ID, { byCampaign: true, ccy: \"meta\"") && metaSrc.includes("COALESCE(b.revenue, c.revenue)") && metaSrc.includes("COALESCE(b.purchases, c.purchases)") && metaSrc.includes("SELECT adset_id, ${ADSET_SUMS_BASIS}") && /SUM\(\$\{basisRevenueSql\(\)\}\) AS revenue,\s+SUM\(\$\{basisPurchasesSql\(\)\}\) AS purchases,\s+SUM\(impressions\) AS impressions, SUM\(link_clicks\) AS link_clicks,\s+SUM\(outbound_clicks\)/.test(metaSrc));
  const ovSrc = src("lib/queries/paidOverview.ts");
  ok("Paid Overview: Meta row and campaigns overlay the basis, only on rows that already carry Meta figures", ovSrc.includes("COALESCE(mb.revenue, k.meta_revenue)") && ovSrc.includes("COALESCE(mb.purchases, k.meta_purchases)") && (ovSrc.match(/IF\(k\.meta_spend IS NULL AND k\.meta_impressions IS NULL AND k\.meta_revenue IS NULL AND k\.meta_purchases IS NULL,/g) ?? []).length === 2 && ovSrc.includes("IF(mb.campaign_id IS NULL, c.revenue_client_ccy, mb.revenue)") && ovSrc.includes("COALESCE(mb.purchases, c.purchases)"));
  ok("only the (empty) ad set mart read keeps stored purchase sums in creative.ts", (creativeSrc.match(/SUM\(revenue\) AS revenue, SUM\(purchases\) AS purchases/g) ?? []).length === 1);
  const regSrc = src("lib/reports/registry/components.ts");
  ok("Reports: the launch inputs read the basis columns", /"ad_launch\.purchases":[^\n]*column: "purchases_7dc_1dv"/.test(regSrc) && /"ad_launch\.revenue":[^\n]*column: "revenue_7dc_1dv"/.test(regSrc) && /"ad_launch\.prior_roas":[^\n]*column: "prior_roas_7dc_1dv"/.test(regSrc));
  const { SEMANTIC_VERSION } = require("@/lib/reports/registry/types") as typeof import("@/lib/reports/registry/types");
  ok("semantic version bumped for the basis change (cache keys)", SEMANTIC_VERSION >= 9, String(SEMANTIC_VERSION));
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f: string) => { const q = join(dir, f); return statSync(q).isDirectory() ? walk(q) : /\.(ts|tsx)$/.test(f) ? [q] : []; });
  const old = [...walk(join(__dirname, "..", "components")), ...walk(join(__dirname, "..", "app")), ...walk(join(__dirname, "..", "lib"))].filter((f) => readFileSync(f, "utf8").includes("Meta default attribution (per ad set)"));
  ok("the old per-ad-set label is printed nowhere", old.length === 0, old.join(", "));
}

// ── Queries: shape of the anchor read ────────────────────────────────────────
{
  ok("anchor SQL reads one client's launch table only", /mart\.rpt_ad_launch/.test(ANCHOR_SQL) && ANCHOR_SQL.includes("@clientId") && ANCHOR_SQL.includes("age_days") && ANCHOR_SQL.includes("prior_roas") && !ANCHOR_SQL.includes("\u2014"));
  ok("launch SQL reaches back to the reference window and selects all columns (ad set columns arrive later)", /INTERVAL 364 DAY/.test(LAUNCH_SQL) && /r\.\*/.test(LAUNCH_SQL) && /refreshed_at/.test(LAUNCH_SQL));
}

async function main() {
// ── The demo path needs no warehouse ─────────────────────────────────────────
{
  const d = demoLaunches();
  ok("demo launches are ready and non-empty", d.state === "ready" && d.rows.length > 0);
  if (d.state === "ready") {
    ok("demo rows have valid first dates and ages", d.rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.firstDate) && r.ageDays >= 0));
    ok("demo is deterministic", JSON.stringify(demoLaunches()) === JSON.stringify(d));
    ok("demo carries no em dash", !JSON.stringify(d).includes("\u2014"));
  }
  ok("getLaunches serves the demo client without BigQuery", (await getLaunches("demo", { from: "2026-01-01", to: "2026-09-08" })).state === "ready");
}

// ── The query: shape, and a missing table reads as not ready ────────────────
{
  ok("SQL reads only mart.rpt_ad_launch", /mart\.rpt_ad_launch/.test(LAUNCH_SQL) && !/mart_meta_ad_perf|mart_creative/.test(LAUNCH_SQL));
  ok("SQL is parameterised and casts its dates", LAUNCH_SQL.includes("@clientId") && LAUNCH_SQL.includes("DATE(@from)") && LAUNCH_SQL.includes("DATE(@to)"));
  ok("SQL filters pre-existing ads", /NOT r\.is_preexisting/.test(LAUNCH_SQL));
  ok("thresholds never reach the SQL", !/target|kill|readPurchases|read_purchases/i.test(LAUNCH_SQL));
  ok("SQL carries no em dash", !LAUNCH_SQL.includes("\u2014"));

  const row = launchFrom({
    ad_id: 42, ad_name: "A \u2014 B", first_date: { value: "2026-07-03" }, age_days: "93", spend: "1000.5",
    revenue: 2800, purchases: 15, is_video: true, is_relaunch: false, is_preexisting: false,
    concept_id: "", concept_name: null, prior_roas: "2.029",
  });
  ok("row mapping: ids, dates, numbers and flags", row.adId === "42" && row.firstDate === "2026-07-03" && row.ageDays === 93 && row.spend === 1000.5 && row.isVideo === true && row.isRelaunch === false && row.priorRoas === 2.029);
  ok("row mapping: empty concept is null, em dash in a name is removed", row.conceptId === null && row.adName === "A - B", row.adName);
  ok("row mapping: a null prior stays null, not 0", launchFrom({ ad_id: "x", first_date: "2026-01-01", prior_roas: null }).priorRoas === null);

  // Stub the BigQuery client: the page must survive a missing table and must not hide anything else.
  const real = BigQuery.prototype.query;
  const stub = (error: { code?: number; message: string } | null, rows: Array<Record<string, unknown>> = []) => {
    (BigQuery.prototype as unknown as { query: unknown }).query = async () => {
      if (error) throw Object.assign(new Error(error.message), error);
      return [rows];
    };
  };
  const range = { from: "2026-01-01", to: "2026-09-30" };
  try {
    stub({ code: 404, message: "Not found: Table oneeighty-warehouse:mart.rpt_ad_launch was not found in location EU" });
    const missing = await getLaunches("manami", range);
    ok("missing table: not ready, no throw", missing.state === "not-ready");

    stub(null, [{ table_through: null, table_rows: 0, ad_id: null }]);
    const empty = await getLaunches("manami", range);
    ok("table exists but holds nothing for the client: not ready, not zero", empty.state === "not-ready");

    stub(null, [{ table_through: { value: "2026-10-04" }, table_rows: 450, ad_id: null }]);
    const quiet = await getLaunches("manami", range);
    ok("client present, no ad matches: ready with no rows", quiet.state === "ready" && quiet.rows.length === 0 && quiet.through === "2026-10-04");

    stub(null, [
      { table_through: { value: "2026-10-04" }, table_refreshed_at: "2026-10-05T08:10:12Z", table_rows: 450, ad_id: "1", first_date: { value: "2026-07-03" }, age_days: 93, spend: 1000, revenue: 2800, purchases: 15, is_video: false, is_relaunch: false, is_preexisting: false, prior_roas: 2.029 },
    ]);
    const got = await getLaunches("manami", range);
    ok("a populated result maps to launches", got.state === "ready" && got.rows.length === 1 && got.rows[0].priorRoas === 2.029);
    ok("ME3 C6: the table's build time rides along", got.state === "ready" && got.refreshedAt === "2026-10-05T08:10:12Z");
    ok("ME3 C7: a table without the ad set columns maps them to undefined (not ready), never to false", got.state === "ready" && got.rows[0].isNewAdset === undefined && got.rows[0].adsetId === undefined && got.rows[0].adsetFirstDate === undefined);

    stub({ code: 403, message: "Access Denied: Table oneeighty-warehouse:mart.rpt_ad_launch: Permission denied" });
    let threw = false;
    try { await getLaunches("manami", range); } catch { threw = true; }
    ok("a permission failure is thrown, not shown as not ready", threw);
  } finally {
    (BigQuery.prototype as unknown as { query: unknown }).query = real;
  }
}

// ── ME3: the anchor read ─────────────────────────────────────────────────────
{
  const real = BigQuery.prototype.query;
  const stub = (error: { code?: number; message: string } | null, rows: Array<Record<string, unknown>> = []) => {
    (BigQuery.prototype as unknown as { query: unknown }).query = async () => {
      if (error) throw Object.assign(new Error(error.message), error);
      return [rows];
    };
  };
  try {
    stub({ code: 404, message: "Not found: Table oneeighty-warehouse:mart.rpt_ad_launch was not found in location EU" });
    ok("anchor: a missing table reads as null (no age rule, window mean)", (await getLaunchAnchor("manami")) === null);
    stub(null, []);
    ok("anchor: an empty client reads as null", (await getLaunchAnchor("manami")) === null);
    stub(null, [
      { ad_id: "1", age_days: 40, prior_roas: "2.029", through: { value: "2026-10-04" }, refreshed_at: "2026-10-05T08:10:12Z" },
      { ad_id: "2", age_days: 3, prior_roas: "2.029", through: { value: "2026-10-04" }, refreshed_at: "2026-10-05T08:10:12Z" },
    ]);
    const a = await getLaunchAnchor("manami");
    ok("anchor: prior, through, build time and ages by ad", a !== null && a.priorRoas === 2.029 && a.through === "2026-10-04" && a.refreshedAt === "2026-10-05T08:10:12Z" && a.ageByAd.get("1") === 40 && a.ageByAd.get("2") === 3);
    stub({ code: 403, message: "Access Denied: Table oneeighty-warehouse:mart.rpt_ad_launch: Permission denied" });
    let threw = false;
    try { await getLaunchAnchor("manami"); } catch { threw = true; }
    ok("anchor: a permission failure is thrown", threw);
    ok("anchor: the demo client is served without BigQuery", ((await getLaunchAnchor("demo"))?.ageByAd.size ?? 0) > 0);
  } finally {
    (BigQuery.prototype as unknown as { query: unknown }).query = real;
  }
}

}

main()
  .then(() => {
    console.log(fails === 0 ? "\nall hit-rate checks passed" : `\n${fails} FAILED`);
    process.exit(fails === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
