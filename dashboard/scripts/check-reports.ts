/**
 * npm run check:reports
 *
 * Stub created by RS0 (contracts). WP2 owns this file from here on and adds
 * the BigQuery dry runs and the live column check (design 3.5 b and c); WP1's
 * evaluator assertions live in scripts/check-reports-eval.ts. Keep the
 * contract checks below: they pin the zod rules and the fixture invariants
 * every package relies on.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CELL_STATUS_PRECEDENCE,
  LayoutItem,
  ReportFilters,
  WidgetConfig,
  WIDGET_TYPES,
  type CellStatus,
  type WidgetResult,
} from "@/lib/reports/types";
import { METRIC_IDS, PHASE2_METRIC_IDS, isMetricId } from "@/lib/reports/registry/ids";
import { GRID, WIDGET_SIZE, MAX_METRICS_PER_WIDGET } from "@/lib/reports/limits";
import { REPORTS_ROLES } from "@/lib/reports/contracts";
import { DEFAULT_REPORT_FILTERS } from "@/lib/reports/types";
import { FIXTURE_CONFIGS, FIXTURE_FILTERS, FIXTURE_RESULTS } from "@/lib/reports/fixtures";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed += 1;
  else failures.push(detail ? `${name}: ${detail}` : name);
}

// ---------------------------------------------------------------------------
// Ids and limits
// ---------------------------------------------------------------------------

check("30 phase-1 metric ids", METRIC_IDS.length === 30, String(METRIC_IDS.length));
check("metric ids unique", new Set([...METRIC_IDS, ...PHASE2_METRIC_IDS]).size === METRIC_IDS.length + PHASE2_METRIC_IDS.length);
check("phase 2 ids are not queryable", PHASE2_METRIC_IDS.every((id) => !isMetricId(id)));
check("client role never gets Reports", !(REPORTS_ROLES as readonly string[]).includes("client"));
for (const type of WIDGET_TYPES) {
  const s = WIDGET_SIZE[type];
  check(`size ${type}`, s.minW <= s.w && s.minH <= s.h && s.w <= GRID.cols && s.minH >= GRID.minH && s.h <= GRID.maxH);
}

// ---------------------------------------------------------------------------
// Zod contracts
// ---------------------------------------------------------------------------

check("default filters parse", ReportFilters.safeParse(DEFAULT_REPORT_FILTERS).success);
check("fixture filters parse", ReportFilters.safeParse(FIXTURE_FILTERS).success);
for (const [type, cfg] of Object.entries(FIXTURE_CONFIGS)) {
  const r = WidgetConfig.safeParse(cfg);
  check(`config ${type} parses`, r.success, r.success ? undefined : JSON.stringify(r.error.issues));
  if (r.success) check(`config ${type} overrides default to {}`, typeof r.data.query.overrides === "object");
}

const base = FIXTURE_CONFIGS.line;
const rejects: Array<[string, unknown]> = [
  ["unknown metric", { ...base, query: { ...base.query, metrics: ["roas"] } }],
  ["phase 2 metric", { ...base, query: { ...base.query, metrics: ["email_revenue"] } }],
  ["duplicate metric", { ...base, query: { ...base.query, metrics: ["mer", "mer"] } }],
  ["too many metrics", { ...base, query: { ...base.query, metrics: METRIC_IDS.slice(0, MAX_METRICS_PER_WIDGET + 1) } }],
  ["ranked with two metrics", { ...FIXTURE_CONFIGS.ranked, query: { ...FIXTURE_CONFIGS.ranked.query, metrics: ["mer", "cac"] } }],
  ["scatter without axes", { ...FIXTURE_CONFIGS.scatter, view: { type: "scatter" } }],
  ["scatter axis not in metrics", { ...FIXTURE_CONFIGS.scatter, view: { type: "scatter", scatter: { x: "cac", y: "mer" } } }],
  ["config version 2", { ...base, v: 2 }],
];
for (const [name, cfg] of rejects) check(`rejects ${name}`, !WidgetConfig.safeParse(cfg).success);

const filterRejects: Array<[string, unknown]> = [
  ["today preset", { ...DEFAULT_REPORT_FILTERS, period: { kind: "preset", preset: "today" } }],
  ["from after to", { ...DEFAULT_REPORT_FILTERS, period: { kind: "custom", from: "2026-09-02", to: "2026-09-01" } }],
  ["impossible date", { ...DEFAULT_REPORT_FILTERS, period: { kind: "custom", from: "2026-02-30", to: "2026-03-01" } }],
  ["client id with a quote", { ...DEFAULT_REPORT_FILTERS, clients: { mode: "list", ids: ["x' OR 1=1"] } }],
  ["empty client list", { ...DEFAULT_REPORT_FILTERS, clients: { mode: "list", ids: [] } }],
  ["unknown currency", { ...DEFAULT_REPORT_FILTERS, currency: "GBP" }],
];
for (const [name, f] of filterRejects) check(`filters reject ${name}`, !ReportFilters.safeParse(f).success);

const uuid = "00000000-0000-4000-8000-000000000000";
check("layout accepts a full-width item", LayoutItem.safeParse({ id: uuid, x: 0, y: 0, w: 12, h: 8 }).success);
check("layout rejects x + w > 12", !LayoutItem.safeParse({ id: uuid, x: 6, y: 0, w: 7, h: 8 }).success);
check("layout rejects h < 2", !LayoutItem.safeParse({ id: uuid, x: 0, y: 0, w: 3, h: 1 }).success);

// ---------------------------------------------------------------------------
// Fixture invariants (n/a semantics: gaps are null, never 0)
// ---------------------------------------------------------------------------

const seenStatus = new Set<CellStatus>();
const seenKinds = new Set<string>();
const seenBench = new Set<string>();

for (const [key, result] of Object.entries(FIXTURE_RESULTS) as Array<[string, WidgetResult]>) {
  const n = result.buckets.length;
  check(`${key} grain total has no buckets`, result.grain !== "total" || n === 0);
  check(`${key} partial buckets in range`, result.partialBuckets.every((i) => i >= 0 && i < n));
  for (const b of result.benchmarks) seenBench.add(b.status);
  for (const b of result.benchmarks) check(`${key} benchmark value null only for no_fx`, (b.value === null) === (b.status === "no_fx"));
  for (const s of result.series) {
    seenKinds.add(s.kind);
    check(`${key}/${s.id} slot in range`, s.slot >= 0 && s.slot < 6);
    check(`${key}/${s.id} rollup lists clients`, s.kind === "client" || (s.clientIds?.length ?? 0) > 0);
    for (const [metric, cell] of Object.entries(s.cells)) {
      if (!cell) continue;
      const at = `${key}/${s.id}/${metric}`;
      seenStatus.add(cell.status);
      check(`${at} status known`, CELL_STATUS_PRECEDENCE.includes(cell.status));
      if (cell.status !== "ok") {
        check(`${at} non-ok total is null`, cell.total === null && cell.compareTotal === null && cell.delta === null);
        check(`${at} non-ok has a reason`, typeof cell.reason === "string" && cell.reason.length > 0);
      }
      if (cell.status === "not_connected") {
        check(`${at} not_connected has no points`, cell.points === undefined && cell.comparePoints === undefined);
        check(`${at} not_connected names the gap`, (cell.missing?.length ?? 0) > 0);
      }
      if (cell.status === "fx_missing") check(`${at} fx_missing names months`, (cell.fxMonths?.length ?? 0) > 0);
      if (cell.points) check(`${at} points align with buckets`, cell.points.length === n);
      if (cell.comparePoints) {
        check(`${at} comparePoints need a comparison`, result.comparison !== null);
        check(`${at} comparePoints align with buckets`, cell.comparePoints.length === n);
      }
      if (result.comparison === null) check(`${at} no comparison, no compareTotal`, cell.compareTotal === null);
      if (cell.coverage) check(`${at} coverage sane`, cell.coverage.included <= cell.coverage.of);
    }
  }
}

for (const status of CELL_STATUS_PRECEDENCE) check(`fixtures cover status ${status}`, seenStatus.has(status));
for (const kind of ["client", "combined", "vertical"]) check(`fixtures cover split ${kind}`, seenKinds.has(kind));
for (const status of ["ok", "stale", "no_fx"]) check(`fixtures cover benchmark ${status}`, seenBench.has(status));
check("fixtures include a result without benchmarks", Object.values(FIXTURE_RESULTS).some((r) => r.benchmarks.length === 0));

// ---------------------------------------------------------------------------
// House rule: no em dash anywhere in lib/reports
// ---------------------------------------------------------------------------

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
for (const file of walk(join(__dirname, "..", "lib", "reports"))) {
  check(`no em dash in ${file}`, !readFileSync(file, "utf8").includes("—"));
}

// ---------------------------------------------------------------------------

if (failures.length) {
  console.error(`check:reports  ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`check:reports  ${passed}/${passed} passed`);
