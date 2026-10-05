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
import { ZERO, classify } from "@/lib/creative/model";
import type { CreativeThresholds } from "@/lib/creative/stats";
import {
  HIT_RATE_MATURITY_DAYS,
  conceptSplit,
  eligible,
  hitRate,
  inRange,
  launchMonths,
  launchStatus,
  tileText,
  trailingMonths,
  type LaunchRow,
} from "@/lib/creative/hitRate";
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
  ok("a young winner is a winner, not open", launchStatus(ad({ ageDays: 5 }), T) === "winner");
  const rows = [ad({ ageDays: 5 }), ad({ ...loser, ageDays: 20 }), ad({ ...loser, ageDays: 120 })];
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
  ok("no thresholds: tile is n/a, sub '2 launched', info points to Settings", t.value === null && t.sub === "2 launched" && t.info === "Set thresholds in Settings.", JSON.stringify(t));
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
  const t = tileText(hitRate(rows, T), T);
  ok("9 of 122, 18 open reads '7.4%'", t.value === "7.4%", String(t.value));
  ok("sub '9 of 122 launched · 18 open'", t.sub === "9 of 122 launched · 18 open", t.sub);
  ok("info names the client's own bar and the reference", t.info.includes("15+ purchases") && t.info.includes("2.25+") && t.info.includes("5%"), t.info);
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
  ok("an empty chart still reaches the 5% reference", rateCeiling(flat) >= 0.05);
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
    createElement(HitRateTrend, { state: "ready", months, format: "all", hrefs, concepts: null })
  );
  ok("trend shows W/n labels", html.includes(">1/2<") && html.includes(">0/1<"));
  ok("a maturing month with no winner says how many are open", html.includes("1 open"));
  const young = launchMonths([ad({ firstDate: "2026-09-02", ageDays: 20 }), ad({ firstDate: "2026-09-05", ageDays: 20, purchases: 1, revenue: 9 })], T, "2026-09-30", { from: "2026-09-01", to: "2026-09-30" });
  const youngHtml = renderToStaticMarkup(createElement(HitRateTrend, { state: "ready", months: young, format: "all", hrefs, concepts: null }));
  ok("a maturing month with a bar is hatched, with the open count", youngHtml.includes('fill="url(#hr-hatch)"') && youngHtml.includes("1 open") && youngHtml.includes(">1/2<"));
  ok("a settled month is solid", html.includes('fill="var(--positive)"'));
  ok("trend draws the 5% reference", html.includes("REF. ~5%"));
  ok("an empty month shows a dash", html.includes(">-<"));
  ok("trend has the format control", html.includes("Video") && html.includes("Static") && html.includes('aria-current="true"'));
  ok("trend renders no em dash", !html.includes("\u2014"));

  const nr = renderToStaticMarkup(createElement(HitRateTrend, { state: "not-ready", months: [], format: "all", hrefs, concepts: null }));
  ok("not ready: one line, no chart, no control", nr.includes("Launch data is not ready.") && !nr.includes("<svg") && !nr.includes("Video"));
  const nt = renderToStaticMarkup(createElement(HitRateTrend, { state: "no-thresholds", months: [], format: "all", hrefs, concepts: null }));
  ok("no thresholds: one line, no chart", nt.includes("Set thresholds in Settings.") && !nt.includes("<svg"));
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

    stub(null, [{ through: null, table_rows: 0, ad_id: null }]);
    const empty = await getLaunches("manami", range);
    ok("table exists but holds nothing for the client: not ready, not zero", empty.state === "not-ready");

    stub(null, [{ through: { value: "2026-10-04" }, table_rows: 450, ad_id: null }]);
    const quiet = await getLaunches("manami", range);
    ok("client present, no ad matches: ready with no rows", quiet.state === "ready" && quiet.rows.length === 0 && quiet.through === "2026-10-04");

    stub(null, [
      { through: { value: "2026-10-04" }, table_rows: 450, ad_id: "1", first_date: { value: "2026-07-03" }, age_days: 93, spend: 1000, revenue: 2800, purchases: 15, is_video: false, is_relaunch: false, is_preexisting: false, prior_roas: 2.029 },
    ]);
    const got = await getLaunches("manami", range);
    ok("a populated result maps to launches", got.state === "ready" && got.rows.length === 1 && got.rows[0].priorRoas === 2.029);

    stub({ code: 403, message: "Access Denied: Table oneeighty-warehouse:mart.rpt_ad_launch: Permission denied" });
    let threw = false;
    try { await getLaunches("manami", range); } catch { threw = true; }
    ok("a permission failure is thrown, not shown as not ready", threw);
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
