/**
 * Repeat rate page gates (WR3).
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/check-retention.ts
 *
 * Pure checks, no warehouse, no server. The demo client stands in for the
 * warehouse (it is built from customers, so the page's figures can be recounted
 * independently), and the live Manami figures are covered by the WR3 report,
 * which recomputed every tile, the cohort table and the curve from the customer
 * table with separate SQL.
 *
 *   1. Wilson, Newcombe: the design's vectors, to 0.1.
 *   2. Kaplan-Meier: no censoring equals the empirical share, a hand-computed
 *      censored example, Greenwood band, the stop at fewer than 30 at risk.
 *   3. Month maturity, windows, pooling, early rows, controls, display rules.
 *   4. The demo: recount from customers, every state is present.
 *   5. Renders: the body for a client with and without classes, the rate chip
 *      in both delta modes.
 *   6. Copy gates and source pins.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeltaModeStatic } from "@/components/ui/DeltaMode";
import { RepeatRateBody } from "@/components/retention/RepeatRateBody";
import { RateDiff, EntrantsDiff, signedPoints } from "@/components/retention/RateDiff";
import { RateCell } from "@/components/retention/RateCell";
import { kaplanMeier, kmAt, newcombe, rateState, wilson } from "@/lib/retention/stats";
import {
  HORIZONS,
  addDays,
  addMonths,
  cohortTable,
  compareWindow,
  curves,
  defaultEntry,
  entryOptions,
  entryTable,
  lastMatureWindow,
  matureOn,
  maturing,
  monthMature,
  parseEvent,
  parseHorizon,
  parseVs,
  poolRows,
  rateView,
  resolveEntry,
  tile,
  trend,
  type CohortRow,
  type Horizon,
  type RetentionData,
  type RetentionMeta,
} from "@/lib/retention/model";
import { aggregateDemo, demoCustomers, demoRetention } from "@/lib/demo/retention";
import { COHORT_SQL, CURVE_SQL, getRetention, parseCohortRows, parseCurveRows } from "@/lib/queries/retention";
import { RETENTION_TIPS } from "@/lib/metrics";
import { NAV } from "@/lib/nav";
import { pageAvailability } from "@/lib/capabilities";
import { DEMO_CLIENT } from "@/lib/demo/client";
import type { DeltaMode } from "@/lib/format";

// InfoTip measures itself in a layout effect, which a static render warns about on every tip.
const warn = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("useLayoutEffect does nothing on the server")) return;
  warn(...args);
};

const ROOT = join(__dirname, "..");
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const NBSP = new RegExp(String.fromCharCode(0xa0), "g");
const MINUS = String.fromCharCode(0x2212);

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed += 1;
  else failures.push(detail ? `${name}: ${detail}` : name);
}
function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const near = (name: string, actual: number, expected: number, tol: number) =>
  check(name, Math.abs(actual - expected) <= tol, `expected ${expected} +/- ${tol}, got ${actual}`);

const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const html = (el: ReactElement, mode?: DeltaMode) =>
  renderToStaticMarkup(mode ? createElement(DeltaModeStatic, { mode, children: el }) : el).replace(NBSP, " ");

// ---------------------------------------------------------------------------
// 1. Wilson and Newcombe vectors (design 1.8, 1.9)
// ---------------------------------------------------------------------------
for (const [k, n, p, lo, hi] of [
  [3, 40, 7.5, 2.6, 19.9],
  [0, 30, 0, 0, 11.4],
  [20, 100, 20, 13.3, 28.9],
  [200, 1000, 20, 17.6, 22.6],
] as const) {
  const w = wilson(k, n)!;
  near(`wilson ${k}/${n} p`, w.p * 100, p, 0.05);
  near(`wilson ${k}/${n} lo`, w.lo * 100, lo, 0.05);
  near(`wilson ${k}/${n} hi`, w.hi * 100, hi, 0.05);
}
check("wilson n=0 is null", wilson(0, 0) === null);
check("wilson stays inside [0, 1]", (() => { const w = wilson(30, 30)!; return w.hi <= 1 && w.lo >= 0; })());
{
  const nc = newcombe({ k: 59, n: 488 }, { k: 19, n: 202 })!;
  near("newcombe diff +2.7", nc.diff * 100, 2.7, 0.05);
  near("newcombe lo -2.8", nc.lo * 100, -2.8, 0.1);
  near("newcombe hi +7.3", nc.hi * 100, 7.3, 0.1);
  eq("newcombe verdict none", nc.verdict, "none");
  eq("newcombe up", newcombe({ k: 300, n: 1000 }, { k: 200, n: 1000 })!.verdict, "up");
  eq("newcombe down", newcombe({ k: 200, n: 1000 }, { k: 300, n: 1000 })!.verdict, "down");
  eq("newcombe needs both sides", newcombe({ k: 1, n: 0 }, { k: 1, n: 10 }), null);
}
eq("rate state few", rateState(29), "few");
eq("rate state low 30", rateState(30), "low");
eq("rate state low 99", rateState(99), "low");
eq("rate state ok 100", rateState(100), "ok");

// ---------------------------------------------------------------------------
// 2. Kaplan-Meier
// ---------------------------------------------------------------------------
{
  // No censoring (everyone without the event is watched to the same end): equals the empirical cumulative share.
  const rows = [
    { t: 3, events: 4, censored: 0 },
    { t: 10, events: 6, censored: 0 },
    { t: 10, events: 2, censored: 0 }, // same day twice: summed
    { t: 40, events: 8, censored: 0 },
    { t: 120, events: 5, censored: 0 },
    { t: 366, events: 0, censored: 75 },
  ];
  const N = 4 + 8 + 8 + 5 + 75 + 6 - 6; // 100
  const c = kaplanMeier(rows, { minAtRisk: 1 });
  eq("km total", c.total, N);
  for (const [day, events] of [[3, 4], [10, 12], [40, 20], [120, 25]] as const) {
    near(`km no censoring day ${day}`, kmAt(c, day)!.cum, events / N, 1e-12);
  }
  near("km between events holds the last step", kmAt(c, 80)!.cum, 20 / N, 1e-12);
  eq("km reaches the cap", c.endT, 365);
}
{
  // Hand computed, 5 customers: event 3, censored 4, event 6, event 6, censored 9.
  const c = kaplanMeier(
    [
      { t: 3, events: 1, censored: 0 },
      { t: 4, events: 0, censored: 1 },
      { t: 6, events: 2, censored: 0 },
      { t: 9, events: 0, censored: 1 },
    ],
    { minAtRisk: 1 }
  );
  near("km hand day 3", kmAt(c, 3)!.cum, 0.2, 1e-12);
  near("km hand day 5", kmAt(c, 5)!.cum, 0.2, 1e-12);
  const d6 = kmAt(c, 6)!;
  near("km hand day 6 survival 0.8 * (1 - 2/3)", 1 - d6.cum, 0.8 * (1 / 3), 1e-12);
  // Greenwood: S^2 * (1/(5*4) + 2/(3*1)), half = 1.96 * sqrt(var)
  const s = 0.8 / 3;
  const half = 1.96 * s * Math.sqrt(1 / 20 + 2 / 3);
  near("km hand day 6 band lo", d6.lo, 1 - (s + half), 1e-12);
  near("km hand day 6 band hi clipped to 1", d6.hi, 1, 1e-12);
  eq("km hand at risk day 3", kmAt(c, 3)!.atRisk, 5);
  eq("km hand at risk day 4", kmAt(c, 4)!.atRisk, 4);
  eq("km hand at risk day 5", kmAt(c, 5)!.atRisk, 3);
  eq("km hand at risk day 6", kmAt(c, 6)!.atRisk, 3);
  eq("km hand at risk day 7", kmAt(c, 7)!.atRisk, 1);
  eq("km hand stops when nobody is left", c.endT, 9);
  eq("km hand after the end", kmAt(c, 10), null);
}
{
  // Stops where fewer than 30 are at risk: 25 of 50 last observed on day 100.
  const c = kaplanMeier(
    [
      { t: 20, events: 5, censored: 0 },
      { t: 100, events: 0, censored: 25 },
      { t: 150, events: 10, censored: 10 },
    ],
    {}
  );
  eq("km stops once fewer than 30 are at risk", c.endT, 100);
  check("km draws no step after the stop", c.points.every((p) => p.t <= 100));
  eq("km at risk at the stop", kmAt(c, 100)!.atRisk, 45 - 0);
  eq("km too few customers draws nothing", kaplanMeier([{ t: 5, events: 3, censored: 20 }]).endT, null);
  // An event beyond the cap is not drawn but the customer stays at risk until then.
  const capped = kaplanMeier([{ t: 10, events: 2, censored: 0 }, { t: 366, events: 5, censored: 60 }]);
  eq("km cap 365", capped.endT, 365);
  near("km cap keeps later events out", kmAt(capped, 365)!.cum, 2 / 67, 1e-12);
}
check("km input without rows", kaplanMeier([]).endT === null);

// ---------------------------------------------------------------------------
// 3. Model
// ---------------------------------------------------------------------------
// Month maturity: Aug 2026 is mature for 30 days only when the cut-off is on or after 2026-09-30.
eq("aug mature for 30 on 09-29", monthMature("2026-08-01", "2026-09-29", 30), false);
eq("aug mature for 30 on 09-30", monthMature("2026-08-01", "2026-09-30", 30), true);
eq("matures on", matureOn("2026-08-01", 30), "2026-09-30");
eq("leap year", matureOn("2024-02-01", 30), "2024-03-30");
eq("window 90 at 2026-10-01", lastMatureWindow("2026-10-01", 90).label, "Jan to Jun 2026");
eq("window 180 at 2026-10-01", lastMatureWindow("2026-10-01", 180).label, "Oct 2025 to Mar 2026");
eq("window 30 at 2026-10-01", lastMatureWindow("2026-10-01", 30).label, "Mar to Aug 2026");
eq("window 365 at 2026-10-01", lastMatureWindow("2026-10-01", 365).label, "Apr to Sep 2025");
eq("compare year", compareWindow(lastMatureWindow("2026-10-01", 90), "year").label, "Jan to Jun 2025");
eq("compare prior", compareWindow(lastMatureWindow("2026-10-01", 90), "prior").label, "Jul to Dec 2025");
eq("addMonths across years", addMonths("2025-11-01", 3), "2026-02-01");
eq("params", [parseHorizon("180"), parseHorizon("7"), parseVs("prior"), parseVs("x")], [180, 90, "prior", "year"]);

// A small synthetic cohort set with every rule in it.
const Z = (v: number): Record<Horizon, number> => ({ 30: v, 60: v, 90: v, 180: v, 365: v });
function row(month: string, entry: string | null, n: number, m: number, r: number, u: number, early = false): CohortRow {
  return { month, entry, early, n, m: Z(m), r: Z(r), u: Z(u), m23: 0, r23: 0 };
}
const META: RetentionMeta = { cutoff: "2026-10-01", dataStart: "2024-05-06", guardDays: 180, classes: true };
const synth: CohortRow[] = [
  // January to June 2026: discovery 100 per month, 10 repeat, 8 full
  ...["01", "02", "03", "04", "05", "06"].map((m) => row(`2026-${m}-01`, "discovery", 100, 100, 10, 8)),
  // the same months a year earlier: 100 per month, 10 repeat
  ...["01", "02", "03", "04", "05", "06"].map((m) => row(`2025-${m}-01`, "discovery", 100, 100, 10, 8)),
  // gift: 10 entrants
  row("2026-03-01", "gift", 10, 10, 5, 5),
  row("2026-04-01", "full", 40, 40, 4, 4),
  // an early month with a huge rate must not reach any pooled figure
  row("2024-05-01", "discovery", 100, 100, 90, 90, true),
  row("2024-06-01", "discovery", 100, 100, 90, 90, true),
];
{
  const t = tile(synth, META, "discovery", "repeat", 90, "year");
  eq("tile current", [t.current.k, t.current.n], [60, 600]);
  eq("tile previous", [t.previous.k, t.previous.n], [60, 600]);
  eq("tile no change is none", t.diff!.verdict, "none");
  const all = tile(synth, META, "all", "repeat", 90, "year");
  eq("tile all pools every class", [all.current.k, all.current.n], [69, 650]);
  // The immature July 2026 month is not in a 90 day tile even if it has data.
  const withJuly = [...synth, row("2026-07-01", "discovery", 100, 3, 1, 1)];
  eq("immature month ignored by tile", tile(withJuly, META, "discovery", "repeat", 90, "year").current.n, 600);
  eq("pool excludes early", poolRows(synth, { entry: "discovery", event: "repeat", horizon: 90, monthLevel: true, cutoff: META.cutoff }).n, 1200);
  eq("pool customer level uses m", poolRows([row("2026-09-01", "discovery", 100, 7, 2, 2)], { entry: "discovery", event: "repeat", horizon: 90, monthLevel: false, cutoff: META.cutoff }), { k: 2, n: 7 });
  eq("pool month level skips immature", poolRows([row("2026-09-01", "discovery", 100, 7, 2, 2)], { entry: "discovery", event: "repeat", horizon: 90, monthLevel: true, cutoff: META.cutoff }), { k: 0, n: 0 });
  const small = tile([row("2026-01-01", "gift", 20, 20, 5, 5)], META, "gift", "repeat", 90, "year");
  eq("tile under 30 is few", small.current.state, "few");
  eq("tile under 30 has no diff", small.diff, null);
}
// Entry options and defaults.
eq("entry options need 30 mature", entryOptions(synth, META).map((o) => o.value), ["all", "discovery", "full"]);
eq("no classes no options", entryOptions(synth, { ...META, classes: false }), []);
eq("default entry discovery with 100+ entrants", defaultEntry(synth, META), "discovery");
eq("default entry all with fewer", defaultEntry([row("2026-03-01", "discovery", 90, 90, 9, 9), row("2026-04-01", "full", 90, 90, 9, 9)], META), "all");
eq("default entry for no classes", defaultEntry(synth, { ...META, classes: false }), "all");
eq("requested entry kept when offered", resolveEntry("full", synth, META), "full");
eq("requested entry dropped when not offered", resolveEntry("gift", synth, META), "discovery");
eq("event for no classes is repeat", parseEvent("full", { ...META, classes: false }), "repeat");
eq("event full kept with classes", parseEvent("full", META), "full");
eq("maturing excludes early and mature", maturing([row("2026-09-01", "discovery", 100, 7, 2, 2), row("2024-05-01", "discovery", 50, 0, 0, 0, true)], "discovery"), 93);

// Cohort table: rules.
{
  const t = cohortTable(synth, META, "discovery", "repeat", null);
  const jan26 = t.lines.find((l) => l.month === "2026-01-01")!;
  eq("cell value", [jan26.cells[90].k, jan26.cells[90].n, jan26.cells[90].mature], [10, 100, true]);
  eq("cell immature for 365", jan26.cells[365].mature, false);
  eq("cell matures on", jan26.cells[365].maturesOn, "2027-01-31");
  const early = t.lines.find((l) => l.month === "2024-05-01")!;
  eq("early row flagged", early.early, true);
  eq("early row keeps its own values", early.cells[90].k, 90);
  const last6 = t.summary.find((s) => s.label === "Last 6")!;
  const allm = t.summary.find((s) => s.label === "All mature")!;
  eq("last 6 excludes early", [last6.cells[90].k, last6.cells[90].n], [60, 600]);
  eq("all mature excludes early", [allm.cells[90].k, allm.cells[90].n], [120, 1200]);
  eq("summary entrants exclude early", allm.entrants, 1200);
  eq("newest first", t.lines[0].month > t.lines[t.lines.length - 1].month, true);
  eq("months limit", cohortTable(synth, META, "discovery", "repeat", 3).lines.length, 3);
  // A month with 29 customers shows n/a state.
  const few = cohortTable([row("2026-01-01", "discovery", 29, 29, 5, 5)], META, "discovery", "repeat", null).lines[0].cells[90];
  eq("under 30 is few", few.state, "few");
  const low = cohortTable([row("2026-01-01", "discovery", 99, 99, 5, 5)], META, "discovery", "repeat", null).lines[0].cells[90];
  eq("99 is low", low.state, "low");
  // Mixed month: early customers left out of the row and noted.
  const mixed = cohortTable([row("2024-11-01", "discovery", 29, 29, 3, 3), row("2024-11-01", "discovery", 1, 1, 0, 0, true)], META, "discovery", "repeat", null).lines[0];
  eq("mixed month uses non early", [mixed.early, mixed.entrants, mixed.earlyLeftOut], [false, 29, 1]);
}
// Trend.
{
  const tr = trend(synth, META, "discovery", "repeat", 90, null);
  eq("trend shows only mature months", tr.points[tr.points.length - 1].month, "2026-06-01");
  eq("trend early month hollow", tr.points.find((p) => p.month === "2024-05-01")!.early, true);
  eq("trend quarters need three mature non early months", tr.quarters.map((q) => q.label), ["Q1 2025", "Q2 2025", "Q1 2026", "Q2 2026"]);
  eq("quarter pools", [tr.quarters[0].rate.k, tr.quarters[0].rate.n], [30, 300]);
  eq("trend entrants parallel", tr.entrants.length, tr.points.length);
  // July 2026 is not mature for 90 days so it is absent even though it has customers.
  eq("trend omits immature", trend([...synth, row("2026-07-01", "discovery", 100, 0, 0, 0)], META, "discovery", "repeat", 90, null).points.some((p) => p.month === "2026-07-01"), false);
  eq("trend months limit", trend(synth, META, "discovery", "repeat", 90, 5).points.length, 5);
}
// Entry products.
{
  const lines = entryTable(synth, META);
  eq("entry rows with an All row", lines.map((l) => l.entry), ["discovery", "full", "gift", "all"]);
  const gift = lines.find((l) => l.entry === "gift")!;
  eq("entry class under 30 mature shows few", gift.repeat90.state, "few");
  eq("entry table empty without classes", entryTable(synth, { ...META, classes: false }), []);
  const total = lines.find((l) => l.entry === "all")!;
  eq("entry all customers excludes early", total.customers, 650 + 600);
}
check("rateView of nobody", rateView({ k: 0, n: 0 }).p === null);

// ---------------------------------------------------------------------------
// 4. Query boundary
// ---------------------------------------------------------------------------
{
  // BigQuery hands back wrapped dates, booleans and numerics.
  const raw = [
    { cohort_month: { value: "2026-03-01" }, entry_class: "discovery", is_early: false, classes_configured: true, n_customer: "82", m30: 82, m60: 82, m90: 82, m180: 82, m365: 0, r30: 5, r60: 7, r90: 7, r180: 9, r365: 0, u30: 4, u60: 6, u90: 6, u180: 8, u365: 0, m23_180: 5, r23_180: 1, cutoff_date: { value: "2026-10-01" }, data_start_date: { value: "2024-05-06" }, history_guard_days: 180 },
    { cohort_month: { value: "2024-05-01" }, entry_class: null, is_early: true, classes_configured: false, n_customer: 44, m30: 44, m60: 44, m90: 44, m180: 44, m365: 44, r30: 5, r60: 7, r90: 8, r180: 10, r365: 11, u30: 0, u60: 0, u90: 0, u180: 0, u365: 0, m23_180: 11, r23_180: 1, cutoff_date: { value: "2026-10-01" }, data_start_date: null, history_guard_days: 0 },
  ];
  const { rows, meta } = parseCohortRows(raw);
  eq("parse month", rows[0].month, "2026-03-01");
  eq("parse numerics", [rows[0].n, rows[0].m[90], rows[0].r[180], rows[0].u[90], rows[0].m23, rows[0].r23], [82, 82, 9, 6, 5, 1]);
  eq("parse early flag is a boolean", [rows[0].early, rows[1].early], [false, true]);
  eq("parse null entry", rows[1].entry, null);
  eq("parse meta", meta, { cutoff: "2026-10-01", dataStart: "2024-05-06", guardDays: 180, classes: true });
  eq("parse empty", parseCohortRows([]), { rows: [], meta: null });
  eq("parse curve rows", parseCurveRows([{ entry_class: null, grp: "older", kind: "full", t: "366", events: 2, censored: "5" }]), [{ entry: null, group: "older", event: "full", t: 366, events: 2, censored: 5 }]);
}
check("cohort query reads the view for one client", COHORT_SQL.includes("mart_retention_cohorts") && COHORT_SQL.includes("client_id = @clientId"));
check("curve query filters NOT is_early (a BOOL)", /NOT is_early/.test(CURVE_SQL) && !/is_early\s*=\s*0/.test(CURVE_SQL) && !/is_early\s*=\s*FALSE/i.test(CURVE_SQL));
check("curve query leaves out customers after the cut-off", CURVE_SQL.includes("observed_days >= 0"));
check("curve query counts an event after the cut-off as censored", CURVE_SQL.includes("day_of_event <= obs"));
check("curve query bucket 366", CURVE_SQL.includes("366"));

// ---------------------------------------------------------------------------
// 5. The demo: counts recomputed from customers, every state present
// ---------------------------------------------------------------------------
const TODAY = "2026-10-05";
const demo = demoRetention({ today: TODAY });
const { customers, cutoff } = demoCustomers({ today: TODAY });
eq("demo cut-off is yesterday minus the lag", cutoff, addDays(TODAY, -4));
eq("demo deterministic", JSON.stringify(demoRetention({ today: TODAY })) === JSON.stringify(aggregateDemo(customers, cutoff, demo.meta.dataStart!, true)), true);
eq("demo meta", [demo.meta.classes, demo.meta.guardDays, demo.primaryHorizon], [true, 180, 90]);
check("demo has customers", customers.length > 3000);
{
  // Discovery R_90 over the last mature window, counted straight from customers.
  const w = lastMatureWindow(cutoff, 90);
  const inWindow = customers.filter((c) => c.entry === "discovery" && !c.early && c.month >= w.from && c.month <= w.to);
  const t = tile(demo.rows, demo.meta, "discovery", "repeat", 90, "year");
  eq("demo tile n recount", t.current.n, inWindow.length);
  eq("demo tile k recount", t.current.k, inWindow.filter((c) => c.to2nd !== null && c.to2nd <= 90).length);
  const full = tile(demo.rows, demo.meta, "discovery", "full", 90, "year");
  eq("demo full tile k recount", full.current.k, inWindow.filter((c) => c.toFull !== null && c.toFull <= 90).length);
  check("full never exceeds repeat", full.current.k <= t.current.k);
  // Customer level all-mature R_365, recounted.
  const mat = customers.filter((c) => !c.early && c.observed >= 365);
  const row = cohortTable(demo.rows, demo.meta, "all", "repeat", null).summary[1];
  eq("demo all mature 365 recount", [row.cells[365].k, row.cells[365].n], [mat.filter((c) => c.to2nd !== null && c.to2nd <= 365).length, mat.length]);
  // KM recount for one day: at risk and events up to day 90 for the recent group, all classes.
  const recent = customers.filter((c) => !c.early && c.observed >= 0 && c.observed < 182);
  const curve = curves(demo.km, "all", "repeat").recent;
  const day = 60;
  let s = 1;
  for (let d = 1; d <= day; d++) {
    const atRisk = recent.filter((c) => (c.to2nd !== null && c.to2nd <= c.observed ? c.to2nd : c.observed) >= d).length;
    const ev = recent.filter((c) => c.to2nd !== null && c.to2nd <= c.observed && c.to2nd === d).length;
    if (ev > 0) s *= 1 - ev / atRisk;
  }
  near("demo km recount day 60", kmAt(curve, day)!.cum, 1 - s, 1e-9);
  check("demo km stops by 30 at risk", curve.endT !== null && kmAt(curve, curve.endT)!.atRisk >= 30);
}
// States
{
  const lines = cohortTable(demo.rows, demo.meta, "all", "repeat", null).lines;
  check("demo has early rows", lines.some((l) => l.early));
  check("demo has immature cells", lines.some((l) => !l.cells[90].mature));
  check("demo has mature cells", lines.some((l) => l.cells[30].mature && l.cells[30].state !== "few"));
  const gift = cohortTable(demo.rows, demo.meta, "gift", "repeat", null).lines;
  check("demo has under 30 cells", gift.some((l) => l.cells[30].mature && l.cells[30].state === "few"));
  const lowStates = ["discovery", "full", "sample", "other", "mixed"].some((e) =>
    cohortTable(demo.rows, demo.meta, e, "repeat", null).lines.some((l) => l.cells[30].mature && l.cells[30].state === "low")
  );
  check("demo has low n cells", lowStates);
  const verdicts = new Set<string>();
  for (const e of ["all", "discovery", "full"]) for (const vs of ["year", "prior"] as const) for (const ev of ["repeat", "full"] as const) {
    for (const h of [90, 180] as const) { const v = tile(demo.rows, demo.meta, e, ev, h, vs).diff?.verdict; if (v) verdicts.add(v); }
  }
  check("demo has a clear change and a no clear change", verdicts.has("up") && verdicts.has("none"), [...verdicts].join(","));
  check("demo entry options", entryOptions(demo.rows, demo.meta).length >= 5);
  check("demo trend has quarters and an early point", (() => { const t = trend(demo.rows, demo.meta, "all", "repeat", 90, null); return t.quarters.length > 0 && t.points.some((p) => p.early); })());
  const km = curves(demo.km, "all", "full");
  check("demo full curve", km.recent.endT !== null && km.older.endT !== null);
  check("demo curves stop early where few remain at risk", (() => { const e = curves(demo.km, "gift", "repeat").recent.endT; return e === null || e < 182; })());
  check("demo entry table", entryTable(demo.rows, demo.meta).length === 7);
}
// A demo without classes (the other client shape).
const plain = demoRetention({ today: TODAY, classes: false });
check("demo without classes has null entries", plain.rows.every((r) => r.entry === null) && plain.km.every((k) => k.entry === null && k.event === "repeat"));
check("demo without classes has no full events", plain.rows.every((r) => r.u[365] === 0));

// ---------------------------------------------------------------------------
// 6. Renders
// ---------------------------------------------------------------------------
const body = (data: RetentionData, params: Record<string, string> = {}, mode?: DeltaMode) =>
  html(createElement(RepeatRateBody, { data, params }), mode);
const withClasses = body(demo);
const without = body(plain);
check("body renders", withClasses.length > 5000 && without.length > 3000);
check("entry control with classes", withClasses.includes('aria-label="Entry product"') && withClasses.includes('aria-label="Event"'));
check("entry and event controls hidden without classes", !without.includes('aria-label="Entry product"') && !without.includes('aria-label="Event"'));
check("full size tiles only with classes", withClasses.includes('data-tile="full90"') && !without.includes('data-tile="full90"') && !without.includes("Full size"));
check("entry products table only with classes", withClasses.includes("Entry products") && !without.includes("Entry products"));
check("maturing tile always", withClasses.includes('data-tile="maturing"') && without.includes('data-tile="maturing"'));
check("vs control and delta toggle", withClasses.includes('aria-label="Compare with"') && withClasses.includes('aria-label="Change shown as"'));
check("horizon control", withClasses.includes('aria-label="Horizon in days"'));
check("default entry is discovery in the demo", withClasses.includes('aria-pressed="true"') && /aria-pressed="true"[^>]*>[^<]*Discovery set/.test(withClasses));
check("event full retitles the curve", body(demo, { event: "full" }).includes("Time to full size") && withClasses.includes("Time to repeat"));
check("curve section absent copy", !withClasses.includes("NaN") && !withClasses.includes("undefined") && !withClasses.includes("Infinity"));
check("all five tile windows named", /Jan to Jun 2026|[A-Z][a-z]{2} to [A-Z][a-z]{2} \d{4}/.test(withClasses));
check("early badge in the table", body(demo, { entry: "all", months: "all" }).includes(">Early<"));
check("matures hover text", body(demo, { entry: "all" }).includes("Matures "));
check("too few hover text", body(demo, { entry: "gift", months: "all" }).includes("Too few customers"));
check("low marker legend", withClasses.includes("Fewer than 100 customers"));
check("months control", withClasses.includes('aria-label="Months shown"'));
// Rate chip: the design's vector in both modes
{
  const props = { current: { k: 59, n: 488 }, previous: { k: 19, n: 202 }, diff: newcombe({ k: 59, n: 488 }, { k: 19, n: 202 }) };
  const pct = html(createElement(RateDiff, props), "pct");
  const abs = html(createElement(RateDiff, props), "abs");
  check("chip shows +2.7 pp as 2.7 pp", pct.includes("2.7 pp") && abs.includes("2.7 pp"));
  check("chip is neutral grey for no clear change", pct.includes("text-content-muted") && !pct.includes("text-positive") && !pct.includes("text-negative"));
  check("chip hover has CI and n", pct.includes(`title="+2.7 pp, 95% CI ${MINUS}2.8 to +7.3, n 488 vs 202"`), pct.slice(0, 400));
  const up = html(createElement(RateDiff, { current: { k: 300, n: 1000 }, previous: { k: 200, n: 1000 }, diff: newcombe({ k: 300, n: 1000 }, { k: 200, n: 1000 }) }), "pct");
  const down = html(createElement(RateDiff, { current: { k: 200, n: 1000 }, previous: { k: 300, n: 1000 }, diff: newcombe({ k: 200, n: 1000 }, { k: 300, n: 1000 }) }), "pct");
  check("chip green when the range is above 0", up.includes("text-positive") && up.includes("▲"));
  check("chip red when the range is below 0", down.includes("text-negative") && down.includes("▼") && down.includes(MINUS));
  check("chip n/a without a diff", html(createElement(RateDiff, { current: { k: 1, n: 10 }, previous: { k: 3, n: 100 }, diff: null }), "pct").includes("n/a"));
  eq("signed points", [signedPoints(0.0273), signedPoints(-0.0279), signedPoints(0)], ["+2.7", `${MINUS}2.8`, "0.0"]);
  // Entrant counts follow the delta toggle
  check("entrants in percent", html(createElement(EntrantsDiff, { current: 488, previous: 202 }), "pct").includes("Entrants +141.6%"));
  check("entrants in absolute", html(createElement(EntrantsDiff, { current: 488, previous: 202 }), "abs").includes("Entrants +286"));
  check("entrants negative uses the minus sign", html(createElement(EntrantsDiff, { current: 100, previous: 200 }), "pct").includes(`Entrants ${MINUS}50.0%`));
  check("tiles show the entrant change in both modes", body(demo, {}, "pct").includes("Entrants +") && body(demo, {}, "abs").includes("Entrants"));
  check("rates are points in both modes", !/[0-9]\.[0-9]%\s*vs/.test(body(demo, {}, "abs")));
}
// Cells
{
  const cell = (k: number, n: number, mature = true) => html(createElement(RateCell, { view: rateView({ k, n }), mature, maturesOn: "2026-10-30" }));
  check("cell ok", cell(20, 100).includes("20.0%") && cell(20, 100).includes('title="20 of 100, 95% CI 13.3 to 28.9%"'), cell(20, 100));
  check("cell low marker", cell(5, 50).includes("Fewer than 100 customers"));
  check("cell few is n/a", cell(1, 10).includes("n/a") && cell(1, 10).includes("Too few customers"));
  check("cell immature is n/a with date", cell(1, 100, false).includes("n/a") && cell(1, 100, false).includes("Matures Oct 30"));
}

// ---------------------------------------------------------------------------
// 7. Copy gates and source pins
// ---------------------------------------------------------------------------
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const OWNED = [
  "app/(app)/repeat-rate/page.tsx",
  "app/(app)/repeat-rate/loading.tsx",
  "lib/queries/retention.ts",
  "lib/retention/stats.ts",
  "lib/retention/model.ts",
  "lib/demo/retention.ts",
  "scripts/check-retention.ts",
  ...walk(join(ROOT, "components", "retention")).map((f) => relative(ROOT, f)),
];
const tipTexts = [
  RETENTION_TIPS.repeat(90), RETENTION_TIPS.repeat(180), RETENTION_TIPS.fullSize(90), RETENTION_TIPS.fullSize(180),
  RETENTION_TIPS.maturing, RETENTION_TIPS.cohorts, RETENTION_TIPS.trend, RETENTION_TIPS.timeToRepeat,
  RETENTION_TIPS.timeToFull, RETENTION_TIPS.entryProducts, RETENTION_TIPS.early,
];
const renders = [withClasses, without, body(demo, { event: "full", entry: "all", months: "all" }), body(demo, {}, "abs")];
const CLIENTS = /manami|dobias|ethia|rawbark|venev|lumen/i;
const TABLES = /rpt_customer_entry|mart_retention|product_classes|retention_settings|stg_|\bmart\.|\bref\.|mart_qa/i;

for (const [i, h] of renders.entries()) {
  check(`render ${i} has no em or en dash`, !h.includes(EM) && !h.includes(EN));
  check(`render ${i} has no client names`, !CLIENTS.test(h));
  check(`render ${i} has no table names`, !TABLES.test(h));
  check(`render ${i} missing values read n/a, never a dash or zero placeholder`, !/>\s*-\s*</.test(h) && !/NaN|undefined|null/.test(h));
}
for (const t of tipTexts) {
  check(`tip at most 40 words: ${t.slice(0, 30)}`, t.split(/\s+/).length <= 40, `${t.split(/\s+/).length} words`);
  check(`tip has no dash: ${t.slice(0, 30)}`, !t.includes(EM) && !t.includes(EN) && !/ - /.test(t));
  check(`tip names no table or client: ${t.slice(0, 30)}`, !CLIENTS.test(t) && !TABLES.test(t));
}
eq("tips are the design's", [RETENTION_TIPS.repeat(90), RETENTION_TIPS.early], [
  "Share of customers with a second order within 90 days of the first. Only customers whose first order is at least 90 days old count.",
  "First months of data. May include earlier customers.",
]);
for (const f of OWNED) {
  const src = read(f);
  check(`${f}: no em or en dash`, !src.includes(EM) && !src.includes(EN));
  check(`${f}: no client names in code`, f === "scripts/check-retention.ts" || !CLIENTS.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "");
}
for (const f of ["lib/retention/stats.ts", "lib/retention/model.ts", "lib/demo/retention.ts"]) {
  check(`${f}: client-safe (no server-only, no BigQuery)`, !/server-only|@\/lib\/bigquery|@google-cloud/.test(read(f)));
}
{
  const page = read("app/(app)/repeat-rate/page.tsx");
  check("page guards on capability", page.includes('pageAvailability(client, "/repeat-rate")') && page.includes("NotConnected"));
  check("page keeps RangeNote", page.includes("<RangeNote />"));
  const pageCode = page.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  check("page never reads the date range", !/params\.(range|period)/.test(pageCode) && !pageCode.includes("comparison"));
  check("page is dynamic", page.includes('dynamic = "force-dynamic"'));
  check("page title", page.includes('title: "Repeat rate"'));
  const q = read("lib/queries/retention.ts");
  check("demo is served before any query", q.indexOf("isDemo(clientId)") > 0 && q.indexOf("isDemo(clientId)") < q.indexOf("await Promise.all"));
  const nav = NAV.find((g) => g.label === "Retention")!.items.map((i) => i.label);
  eq("nav: Repeat rate second after Customers", nav.slice(0, 2), ["Customers", "Repeat rate"]);
  eq("capability: shop", [pageAvailability({ capabilities: { ...DEMO_CLIENT.capabilities, shopify: false, shoptet: false, woocommerce: false } }, "/repeat-rate"), pageAvailability(DEMO_CLIENT, "/repeat-rate")], ["not-connected", "available"]);
  check("loading skeleton exists", read("app/(app)/repeat-rate/loading.tsx").includes("SkeletonPage"));
  check("rate difference built on the delta formatter, not on Delta.tsx", read("components/retention/RateDiff.tsx").includes("deltaParts") && !read("components/retention/RateDiff.tsx").includes("ui/Delta\""));
  check("every chart is client side with hover", read("components/retention/CohortTrendChart.tsx").startsWith('"use client"') && read("components/retention/RepeatCurveChart.tsx").startsWith('"use client"'));
}
// The demo client reaches no warehouse code: getRetention('demo') resolves with the demo data.
void (async () => {
  const data = await getRetention("demo");
  check("getRetention serves the demo from memory", data !== null && data.rows.length > 0 && HORIZONS.length === 5);
  console.log(`check-retention: ${passed}/${passed + failures.length} passed`);
  for (const f of failures) console.error("FAIL " + f);
  process.exit(failures.length ? 1 : 0);
})();
