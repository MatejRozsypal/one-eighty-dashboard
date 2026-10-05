/**
 * npm run check:reports [-- --offline] [-- --print-sql]
 *
 * Owner: WP2 (RS2). Started as the RS0 contract stub; those checks stay first.
 *
 *   1. RS0 contract checks: ids, sizes, zod accept/reject, fixture invariants, em dash gate.
 *   2. Compiler: snapshot of compiled SQL text for fixed widget configs, the
 *      date predicate assertion, identifier and param validation, key stability.
 *   3. Runner policy: TTLs, byte budget, labels, error mapping, row normalisation.
 *   4. BigQuery (design 3.5): (b) dry runs for every phase-1 grain at 90d, 12m
 *      and 60m across all active clients, failing above DRY_RUN_BUDGET_SHARE of
 *      the byte budget; (c) INFORMATION_SCHEMA.COLUMNS check that every registry
 *      component exists in the live view. Skipped with a message when no GCP
 *      credentials are available (or with --offline).
 *
 * Registry: the real one (registry/components.ts, WP1) is loaded when present.
 * Until then the compiler tests run against FIXTURE_REGISTRY below, a copy of
 * design 2.3 plus kpis.fulfillment_cost (RS0 note), and step (c) reports that
 * the real registry is not there yet.
 *
 * WP1's evaluator assertions live in scripts/check-reports-eval.ts.
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
import { FIXTURE_CONFIGS, FIXTURE_FILTERS, FIXTURE_RESOLVED, FIXTURE_RESULTS } from "@/lib/reports/fixtures";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import * as compileModule from "@/lib/reports/compile";
import {
  assertDatePredicates,
  compileWidget,
  compileWidgetWith,
  componentAlias,
  createCompiler,
  type CompilerRegistry,
} from "@/lib/reports/compile";
import * as runModule from "@/lib/reports/run";
import { cacheTtlSeconds, jobLabels, mapWarehouseError, maxBytesBilled, normaliseRows } from "@/lib/reports/run";
import { BigQuery } from "@google-cloud/bigquery";
import { queryJob, toJobParams } from "@/lib/bigquery";
import { addDays, daysInRange, presetRange, resolvePeriod, scanBounds, type ComparisonMode, type DateRange } from "@/lib/period";
import { CACHE_TTL_S, DEFAULT_MAX_BYTES_BILLED, DRY_RUN_BUDGET_SHARE, MAX_SPAN } from "@/lib/reports/limits";
import { ReportsError, TOTAL_BUCKET, type CompileModule, type ResolvedWidget, type RunModule } from "@/lib/reports/contracts";
import type { ComponentDef, ComponentId, MartDef, MartId, QueryGrain, ReportClient } from "@/lib/reports/registry/types";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed += 1;
  else failures.push(detail ? `${name}: ${detail}` : name);
}

// ---------------------------------------------------------------------------
// Ids and limits
// ---------------------------------------------------------------------------

check("47 queryable metric ids (30 KPI view + 14 Meta soft + 3 hit rate)", METRIC_IDS.length === 47, String(METRIC_IDS.length));
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
  check(`no em dash in ${file}`, !readFileSync(file, "utf8").includes("\u2014"));
}


// ===========================================================================
// WP2: compiler, runner, BigQuery
// ===========================================================================

const argv = new Set(process.argv.slice(2));
const PROJECT = "oneeighty-warehouse";
process.env.GCP_PROJECT_ID ??= PROJECT;

/** Module conformance with the contracts. */
const _compileConforms: CompileModule = compileModule;
const _runConforms: RunModule = runModule;
void _compileConforms;
void _runConforms;

// ---------------------------------------------------------------------------
// Fixture registry: design 2.3 (phase 1 kpis plus two phase 2 marts) and
// kpis.fulfillment_cost, which the mart CM3 subtracts (RS0 report).
// ---------------------------------------------------------------------------

const FIXTURE_MARTS: Record<MartId, MartDef> = {
  kpis: { id: "kpis", table: "mart.mart_daily_kpis", dateColumn: "date", currencyColumn: "currency", grains: ["day", "week", "month"], phase: 1 },
  meta_campaign: { id: "meta_campaign", table: "mart.mart_meta_campaign_perf", dateColumn: "date", currencyColumn: "currency", grains: ["day", "week", "month"], phase: 2 },
  meta_ad: { id: "meta_ad", table: "mart.mart_meta_ad_perf", dateColumn: "date", currencyColumn: "currency", grains: ["day", "week", "month"], phase: 2 },
  email_campaign: { id: "email_campaign", table: "mart.mart_email_campaign_perf", dateColumn: "send_date", currencyColumn: "currency", grains: ["week", "month"], phase: 2 },
  ad_launch: { id: "ad_launch", table: "mart.rpt_ad_launch", dateColumn: "first_date", currencyColumn: null, grains: ["day", "week", "month"], phase: 2 },
};

const FIXTURE_COMPONENT_LIST: Array<[ComponentId, boolean]> = [
  ["kpis.revenue", true],
  ["kpis.net_sales", true],
  ["kpis.new_customer_revenue", true],
  ["kpis.returning_customer_revenue", true],
  ["kpis.new_customer_net_sales", true],
  ["kpis.returning_customer_net_sales", true],
  ["kpis.cogs", true],
  ["kpis.fulfillment_cost", true],
  ["kpis.orders", false],
  ["kpis.new_customer_orders", false],
  ["kpis.returning_customer_orders", false],
  ["kpis.paid_spend", true],
  ["kpis.meta_spend", true],
  ["kpis.meta_revenue", true],
  ["kpis.meta_purchases", false],
  ["kpis.meta_impressions", false],
  ["kpis.meta_clicks", false],
  ["kpis.google_spend", true],
  ["kpis.google_revenue", true],
  ["kpis.google_purchases", false],
  ["kpis.google_impressions", false],
  ["kpis.google_clicks", false],
  ["meta_campaign.link_clicks", false],
  ["meta_campaign.add_to_cart", false],
  ["email_campaign.sent", false],
  ["email_campaign.delivered", false],
  ["email_campaign.unique_opens", false],
  ["email_campaign.unique_clicks", false],
  ["email_campaign.revenue", true],
];

function fixtureComponent(id: ComponentId, money: boolean): ComponentDef {
  const [mart, column] = id.split(".") as [MartId, string];
  return { id, mart, column, money, requires: "shop", nullMeans: "gap" };
}

const FIXTURE_REGISTRY: CompilerRegistry = {
  marts: FIXTURE_MARTS,
  components: Object.fromEntries(FIXTURE_COMPONENT_LIST.map(([id, money]) => [id, fixtureComponent(id, money)])),
};

/** The real registry (WP1) when registry/components.ts exists and is populated; null while it is the RS1 stub. */
function loadRealRegistry(): { registry: CompilerRegistry | null; note: string } {
  const path = join(__dirname, "..", "lib", "reports", "registry", "components.ts");
  if (!existsSync(path)) return { registry: null, note: "registry/components.ts not present (RS1 not merged)" };
  try {
    // Variable path: this file must typecheck before WP1's module exists.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(path) as { COMPONENTS?: CompilerRegistry["components"]; MARTS?: CompilerRegistry["marts"] };
    if (!mod.COMPONENTS || !mod.MARTS || Object.keys(mod.COMPONENTS).length === 0) {
      return { registry: null, note: "registry/components.ts is a stub (no COMPONENTS or MARTS)" };
    }
    return { registry: { components: mod.COMPONENTS, marts: mod.MARTS }, note: "real registry" };
  } catch (error) {
    failures.push(`real registry failed to load: ${String(error)}`);
    return { registry: null, note: "registry/components.ts failed to load" };
  }
}

const real = loadRealRegistry();

// ---------------------------------------------------------------------------
// Compiler: snapshots
// ---------------------------------------------------------------------------

function fixtureClient(id: string, currency: string): ReportClient {
  const caps = { shopify: true, shoptet: false, woocommerce: false, meta: true, googleAds: true, klaviyo: false, ecomail: false, ga4: false, shop: true, email: false };
  return { id, name: id, currency, shopPlatform: "shopify", capabilities: caps, vertical: null, subVertical: null, region: null, slot: 0 };
}

function resolved(input: {
  clientIds: string[];
  components: ComponentId[];
  grain: QueryGrain;
  current: DateRange;
  compare: ComparisonMode;
  currency?: string;
}): ResolvedWidget {
  const period = resolvePeriod(input.current, input.compare);
  const marts = [...new Set(input.components.map((c) => c.split(".")[0] as MartId))].sort();
  return {
    ...FIXTURE_RESOLVED,
    query: { ...FIXTURE_RESOLVED.query, grain: input.grain },
    clients: input.clientIds.map((id) => fixtureClient(id, "CZK")),
    queryClientIds: input.clientIds,
    period,
    scan: scanBounds(period),
    grain: input.grain,
    displayCurrency: input.currency ?? "CZK",
    components: input.components,
    marts,
    availability: {},
    warnings: [],
  };
}

const compileFixture = createCompiler(FIXTURE_REGISTRY, { projectId: PROJECT });

/** Design 2.8 example: Line, [mer, cac], manami, dobias, rawbark, week, 90 days, previous year, CZK. */
const W_MER_CAC = resolved({
  clientIds: ["rawbark", "manami", "dobias"],
  components: ["kpis.revenue", "kpis.paid_spend", "kpis.new_customer_orders"],
  grain: "week",
  current: { from: "2026-07-06", to: "2026-10-03" },
  compare: "previous_year",
});

const EXPECTED_MER_CAC_SQL = `WITH
fx_pairs AS (
  SELECT month_start, from_currency, to_currency, rate
  FROM \`oneeighty-warehouse.ref.fx_rates\`
  WHERE month_start BETWEEN DATE_TRUNC(@scanFrom, MONTH) AND DATE_TRUNC(@scanTo, MONTH)
),
fx_direct AS (
  SELECT month_start, from_currency AS ccy, rate AS to_czk
  FROM fx_pairs
  WHERE to_currency = 'CZK' AND from_currency <> 'CZK'
),
fx AS (
  SELECT month_start, ccy, to_czk
  FROM (
    SELECT month_start, ccy, to_czk, 1 AS priority FROM fx_direct
    UNION ALL
    SELECT a.month_start, a.from_currency, a.rate * d.to_czk, 2
    FROM fx_pairs AS a
    JOIN fx_direct AS d ON d.month_start = a.month_start AND d.ccy = a.to_currency
    WHERE a.from_currency <> 'CZK'
    UNION ALL
    SELECT m, 'CZK', NUMERIC '1', 0
    FROM UNNEST(GENERATE_DATE_ARRAY(DATE_TRUNC(@scanFrom, MONTH), DATE_TRUNC(@scanTo, MONTH), INTERVAL 1 MONTH)) AS m
  )
  WHERE to_czk > 0
  QUALIFY ROW_NUMBER() OVER (PARTITION BY month_start, ccy ORDER BY priority, to_czk) = 1
),
kpis AS (
  SELECT
    t.client_id,
    p.period,
    DATE_TRUNC(t.date, ISOWEEK) AS bucket,
    COUNT(*) AS kpis__n_rows,
    COUNTIF(t.currency <> c.currency) AS kpis__foreign_ccy_rows,
    COUNTIF(src.to_czk IS NULL OR dst.to_czk IS NULL) AS kpis__fx_missing_rows,
    ARRAY_AGG(DISTINCT IF(src.to_czk IS NULL OR dst.to_czk IS NULL, DATE_TRUNC(t.date, MONTH), NULL) IGNORE NULLS) AS kpis__fx_missing_months,
    SUM(t.new_customer_orders) AS kpis__new_customer_orders,
    COUNTIF(t.new_customer_orders IS NULL) AS kpis__new_customer_orders__nulls,
    SUM(IF(t.currency = c.currency, t.paid_spend, NULL)) AS kpis__paid_spend__nat,
    SUM(t.paid_spend * src.to_czk / dst.to_czk) AS kpis__paid_spend__disp,
    COUNTIF(t.currency = c.currency AND t.paid_spend IS NULL) AS kpis__paid_spend__nat_nulls,
    COUNTIF(t.paid_spend IS NULL) AS kpis__paid_spend__disp_nulls,
    SUM(IF(t.currency = c.currency, t.revenue, NULL)) AS kpis__revenue__nat,
    SUM(t.revenue * src.to_czk / dst.to_czk) AS kpis__revenue__disp,
    COUNTIF(t.currency = c.currency AND t.revenue IS NULL) AS kpis__revenue__nat_nulls,
    COUNTIF(t.revenue IS NULL) AS kpis__revenue__disp_nulls
  FROM \`oneeighty-warehouse.mart.mart_daily_kpis\` AS t
  JOIN \`oneeighty-warehouse.ref.clients\` AS c ON c.client_id = t.client_id
  CROSS JOIN UNNEST([STRUCT('cur' AS period, @curFrom AS from_date, @curTo AS to_date), STRUCT('cmp', @cmpFrom, @cmpTo)]) AS p
  LEFT JOIN fx AS src ON src.month_start = DATE_TRUNC(t.date, MONTH) AND src.ccy = t.currency
  LEFT JOIN fx AS dst ON dst.month_start = DATE_TRUNC(t.date, MONTH) AND dst.ccy = @displayCurrency
  WHERE t.client_id IN UNNEST(@clientIds)
    AND t.date BETWEEN @scanFrom AND @scanTo
    AND t.date BETWEEN p.from_date AND p.to_date
  GROUP BY 1, 2, 3
)
SELECT *
FROM kpis
ORDER BY client_id, period, bucket`;

const SNAPSHOTS: Array<{ name: string; widget: ResolvedWidget; sha256: string }> = [
  {
    name: "kpi total, revenue and orders, EUR, no comparison",
    widget: resolved({ clientIds: ["venev", "dobias"], components: ["kpis.orders", "kpis.revenue"], grain: "total", current: { from: "2025-10-04", to: "2026-10-03" }, compare: "none", currency: "EUR" }),
    sha256: "49fe1050ddd75345b3f13542e96a655ebea79ebb770bd2b7c9135511fd6090bb",
  },
  {
    name: "line day, counts only (no FX CTE), previous period",
    widget: resolved({ clientIds: ["manami"], components: ["kpis.orders", "kpis.new_customer_orders"], grain: "day", current: { from: "2026-09-04", to: "2026-10-03" }, compare: "previous_period" }),
    sha256: "9ca07d39351bc0fb9be74fe1ba99ab8cf6a506b5a54df643cfdc6d88d94ab626",
  },
  {
    name: "bar month, two marts (phase 2 fixture), USD",
    widget: resolved({ clientIds: ["manami", "ethia"], components: ["email_campaign.revenue", "kpis.revenue", "email_campaign.sent"], grain: "month", current: { from: "2026-04-01", to: "2026-09-30" }, compare: "previous_year", currency: "USD" }),
    sha256: "e34806a03009098aad1dcde39a22e69b1e7ef95f31a6fa390762d47e6e5f59fe",
  },
];

const merCac = compileFixture(W_MER_CAC);
if (argv.has("--print-sql")) {
  console.log(`--- ${"mer cac"}\n${merCac.sql}\n${JSON.stringify(merCac.params)}`);
  for (const s of SNAPSHOTS) {
    const q = compileFixture(s.widget);
    console.log(`--- ${s.name} sha256=${createHash("sha256").update(q.sql).digest("hex")}\n${q.sql}\n${JSON.stringify(q.params)}`);
  }
}
check("snapshot: design 2.8 MER/CAC weekly SQL text", merCac.sql === EXPECTED_MER_CAC_SQL, firstDiff(merCac.sql, EXPECTED_MER_CAC_SQL));
check(
  "snapshot: MER/CAC params sorted and typed",
  JSON.stringify(merCac.params) ===
    JSON.stringify({
      clientIds: ["dobias", "manami", "rawbark"],
      curFrom: "2026-07-06",
      curTo: "2026-10-03",
      cmpFrom: "2025-07-07",
      cmpTo: "2025-10-04",
      scanFrom: "2025-07-07",
      scanTo: "2026-10-03",
      displayCurrency: "CZK",
    }) &&
    JSON.stringify(merCac.types) ===
      JSON.stringify({ clientIds: ["STRING"], curFrom: "DATE", curTo: "DATE", cmpFrom: "DATE", cmpTo: "DATE", scanFrom: "DATE", scanTo: "DATE", displayCurrency: "STRING" }),
  JSON.stringify(merCac.params)
);
check("snapshot: MER/CAC metadata", merCac.hasComparison && merCac.marts.join() === "kpis" && merCac.components.join() === "kpis.new_customer_orders,kpis.paid_spend,kpis.revenue");
for (const s of SNAPSHOTS) {
  const q = compileFixture(s.widget);
  const hash = createHash("sha256").update(q.sql).digest("hex");
  check(`snapshot: ${s.name}`, hash === s.sha256, `sha256 ${hash} (run with --print-sql to review)`);
}

// F1: NULL-row counts ride along with every component sum, in the same row sets.
check(
  "F1 sql: money component has nat and disp NULL counts",
  merCac.sql.includes("COUNTIF(t.currency = c.currency AND t.paid_spend IS NULL) AS kpis__paid_spend__nat_nulls") &&
    merCac.sql.includes("COUNTIF(t.paid_spend IS NULL) AS kpis__paid_spend__disp_nulls")
);
check("F1 sql: non-money component has a NULL count", merCac.sql.includes("COUNTIF(t.new_customer_orders IS NULL) AS kpis__new_customer_orders__nulls"));
check("F1 sql: still one query (one mart CTE, one SELECT)", merCac.marts.length === 1 && merCac.sql.split("\nSELECT *\n").length === 2);
if (real.registry) {
  const cogsQ = createCompiler(real.registry, { projectId: PROJECT })(
    resolved({ clientIds: ["manami"], components: ["kpis.cogs", "kpis.revenue"], grain: "month", current: { from: "2026-04-01", to: "2026-09-30" }, compare: "none" })
  );
  check(
    "F1 sql: COGS NULL count only on rows with revenue (guard)",
    cogsQ.sql.includes("COUNTIF(t.currency = c.currency AND t.cogs IS NULL AND t.revenue > 0) AS kpis__cogs__nat_nulls") &&
      cogsQ.sql.includes("COUNTIF(t.cogs IS NULL AND t.revenue > 0) AS kpis__cogs__disp_nulls") &&
      cogsQ.sql.includes("COUNTIF(t.currency = c.currency AND t.revenue IS NULL) AS kpis__revenue__nat_nulls")
  );
  // Gap rule 2026-10-04: ad outcomes count the days without their platform's spend, never their own NULLs (a NULL purchase value on a day with spend is zero).
  const roasQ = createCompiler(real.registry, { projectId: PROJECT })(
    resolved({ clientIds: ["ethia", "venev"], components: ["kpis.meta_revenue", "kpis.meta_spend", "kpis.google_clicks", "kpis.google_spend"], grain: "week", current: { from: "2026-09-01", to: "2026-09-30" }, compare: "none" })
  );
  check(
    "Gap rule sql: Meta purchase value counts NULL Meta spend days",
    roasQ.sql.includes("COUNTIF(t.currency = c.currency AND t.meta_spend IS NULL) AS kpis__meta_revenue__nat_nulls") &&
      roasQ.sql.includes("COUNTIF(t.meta_spend IS NULL) AS kpis__meta_revenue__disp_nulls") &&
      !roasQ.sql.includes("t.meta_revenue IS NULL")
  );
  check("Gap rule sql: Google clicks count NULL Google spend days", roasQ.sql.includes("COUNTIF(t.google_spend IS NULL) AS kpis__google_clicks__nulls") && !roasQ.sql.includes("t.google_clicks IS NULL"));
  check("Gap rule sql: spend still counts its own NULLs", roasQ.sql.includes("COUNTIF(t.meta_spend IS NULL) AS kpis__meta_spend__disp_nulls"));

  // FX4: Meta soft metrics read the campaign and ad marts next to the KPI view, one CTE per mart.
  const metaQ = createCompiler(real.registry, { projectId: PROJECT })(
    resolved({
      clientIds: ["dobias", "venev"],
      components: ["kpis.meta_spend", "kpis.meta_impressions", "meta_campaign.spend", "meta_campaign.landing_page_views", "meta_campaign.link_clicks", "meta_campaign.impressions", "meta_ad.video_play_actions", "meta_ad.video_impressions"],
      grain: "week",
      current: { from: "2026-09-01", to: "2026-09-30" },
      compare: "previous_period",
    })
  );
  check("FX4 sql: three mart CTEs joined USING (client_id, period, bucket)", metaQ.marts.join() === "kpis,meta_ad,meta_campaign" && metaQ.sql.includes("FROM kpis\nFULL OUTER JOIN meta_ad USING (client_id, period, bucket)\nFULL OUTER JOIN meta_campaign USING (client_id, period, bucket)"));
  check("FX4 sql: every mart CTE has its own date predicate", (["kpis", "meta_ad", "meta_campaign"] as const).every((m) => {
    const start = metaQ.sql.indexOf(`\n${m} AS (\n`);
    const end = metaQ.sql.indexOf("\n)", start + 5);
    return start >= 0 && metaQ.sql.slice(start, end).includes("t.date BETWEEN @scanFrom AND @scanTo") && metaQ.sql.slice(start, end).includes("t.date BETWEEN p.from_date AND p.to_date");
  }));
  check("FX4 sql: Meta money converted per row from the account currency", metaQ.sql.includes("SUM(t.spend * src.to_czk / dst.to_czk) AS meta_campaign__spend__disp") && metaQ.sql.includes("SUM(IF(t.currency = c.currency, t.spend, NULL)) AS meta_campaign__spend__nat"));
  check("FX4 sql: per-mart guards", (["kpis", "meta_ad", "meta_campaign"] as const).every((m) => metaQ.sql.includes(`AS ${m}__n_rows`) && metaQ.sql.includes(`AS ${m}__foreign_ccy_rows`)) && metaQ.sql.includes("AS meta_campaign__fx_missing_rows") && metaQ.sql.includes("0 AS meta_ad__fx_missing_rows"));
  check("FX4 sql: Meta outcomes count NULL spend rows of their own mart", metaQ.sql.includes("COUNTIF(t.spend IS NULL) AS meta_campaign__landing_page_views__nulls") && !metaQ.sql.includes("t.landing_page_views IS NULL"));
  const SCOPE = "meta_ad__scope_video_play_actions_ad_id";
  check("QF1 sql: video ads decided per ad over the period in a scope pre-CTE", metaQ.sql.includes(`\n${SCOPE} AS (\n`) && metaQ.sql.includes("t.ad_id AS scope_key,\n    LOGICAL_OR(t.video_play_actions > 0) AS scope_flag"));
  check("QF1 sql: scope pre-CTE carries the date predicate and the period tagging", (() => {
    const start = metaQ.sql.indexOf(`\n${SCOPE} AS (\n`);
    const body = metaQ.sql.slice(start, metaQ.sql.indexOf("\n)", start));
    return body.includes("t.date BETWEEN @scanFrom AND @scanTo") && body.includes("t.date BETWEEN p.from_date AND p.to_date") && body.includes("p.period") && body.includes("t.client_id IN UNNEST(@clientIds)");
  })());
  check("QF1 sql: ad mart joins the scope on client, period and ad", metaQ.sql.includes(`LEFT JOIN ${SCOPE} AS s1 ON s1.client_id = t.client_id AND s1.period = p.period AND s1.scope_key = t.ad_id`));
  check("QF1 sql: video impressions keep every day of a video ad (zero-play days included), never a row-level filter", metaQ.sql.includes("SUM(IF(COALESCE(s1.scope_flag, FALSE), t.impressions, NULL)) AS meta_ad__video_impressions") && metaQ.sql.includes("COUNTIF(COALESCE(s1.scope_flag, FALSE) AND t.spend IS NULL) AS meta_ad__video_impressions__nulls") && !metaQ.sql.includes("IF(t.video_play_actions > 0"));
  check("FX4: tampered scope pre-CTE without its date predicate is rejected", (() => {
    try {
      assertDatePredicates(metaQ.sql.replace(new RegExp(`(\\n${SCOPE} AS \\([\\s\\S]*?)AND t\\.date BETWEEN @scanFrom AND @scanTo`), "$1AND TRUE"), [real.registry!.marts.meta_ad!]);
      return false;
    } catch (error) {
      return /date predicate/.test(String(error));
    }
  })());
  {
    const hookQ = createCompiler(real.registry, { projectId: PROJECT })(
      resolved({ clientIds: ["venev"], components: ["meta_ad.video_impressions", "meta_ad.video_views"], grain: "total", current: { from: "2026-09-01", to: "2026-09-30" }, compare: "none" })
    );
    check("QF1 sql: without comparison the scope is tagged 'cur' and joined on client and ad", hookQ.sql.includes("'cur' AS period,\n    t.ad_id AS scope_key") && hookQ.sql.includes(`LEFT JOIN ${SCOPE} AS s1 ON s1.client_id = t.client_id AND s1.scope_key = t.ad_id`) && hookQ.sql.includes("t.date BETWEEN @curFrom AND @curTo"));
    check("QF1 sql: hook numerator is video_views of video ads", hookQ.sql.includes("SUM(IF(COALESCE(s1.scope_flag, FALSE), t.video_views, NULL)) AS meta_ad__video_views"));
  }

  // QF1 shared query: kpis selects every component, so widgets over the same filters share one SQL and key.
  {
    const realCompile = createCompiler(real.registry, { projectId: PROJECT });
    const base = { clientIds: ["dobias", "manami"], grain: "week" as const, current: { from: "2026-07-06", to: "2026-10-03" }, compare: "previous_period" as const };
    const a = realCompile(resolved({ ...base, components: ["kpis.revenue"] }));
    const b = realCompile(resolved({ ...base, components: ["kpis.cogs", "kpis.fulfillment_cost", "kpis.fulfilment_stated", "kpis.other_cm1_stated", "kpis.paid_spend", "kpis.revenue"] }));
    const c = realCompile(resolved({ ...base, components: ["kpis.new_customer_orders"] }));
    const kpiIds = Object.keys(real.registry.components).filter((id) => id.startsWith("kpis.")).sort();
    check("QF1 shared: different kpis metrics compile to byte-identical SQL and one key", a.sql === b.sql && b.sql === c.sql && a.key === b.key && b.key === c.key);
    check("QF1 shared: the compiled components are every kpis component", a.components.join() === kpiIds.join() && kpiIds.length === 24);
    check("QF1 shared: counts-only widget joins FX too (superset has money)", c.sql.includes("fx_pairs") && c.params.displayCurrency === "CZK");
    const m = realCompile(resolved({ ...base, components: ["kpis.revenue", "meta_campaign.spend"] }));
    check("QF1 shared: Meta marts keep the widget's own components", m.components.filter((id) => id.startsWith("meta_campaign.")).join() === "meta_campaign.spend" && m.components.filter((id) => id.startsWith("kpis.")).length === 24);
    check("QF1 stated cost: orders emitted as money twice (native rows, per-month FX), rate never in SQL", a.sql.includes("SUM(IF(t.currency = c.currency, t.orders, NULL)) AS kpis__fulfilment_stated__nat") && a.sql.includes("SUM(t.orders * src.to_czk / dst.to_czk) AS kpis__fulfilment_stated__disp") && a.sql.includes("SUM(t.orders * src.to_czk / dst.to_czk) AS kpis__other_cm1_stated__disp") && !/rate|@fulfil/i.test(Object.keys(a.params).join()));
    check("QF1 shared: fixture registry (no selectAll) keeps the widget subset", merCac.components.join() === "kpis.new_customer_orders,kpis.paid_spend,kpis.revenue");
  }
  check("FX4 sql: assertDatePredicates passes for all three marts", (() => { try { assertDatePredicates(metaQ.sql, [real.registry!.marts.kpis!, real.registry!.marts.meta_ad!, real.registry!.marts.meta_campaign!]); return true; } catch { return false; } })());
  check("FX4: tampered Meta CTE without its date predicate is rejected", (() => {
    try {
      assertDatePredicates(metaQ.sql.replace(/(\nmeta_ad AS \([\s\S]*?)AND t\.date BETWEEN @scanFrom AND @scanTo/, "$1AND TRUE"), [real.registry!.marts.meta_ad!]);
      return false;
    } catch (error) {
      return /date predicate/.test(String(error));
    }
  })());
  // HR3: hit rate reads the launch cohort entity mart; thresholds never reach SQL or the key.
  {
    const realCompile = createCompiler(real.registry, { projectId: PROJECT });
    const base = { clientIds: ["dobias", "ethia", "manami", "venev"], grain: "month" as const, current: { from: "2025-10-01", to: "2026-09-30" }, compare: "previous_period" as const };
    const w = resolved({ ...base, components: ["ad_launch.launched", "ad_launch.winners"] });
    const q = realCompile(w);
    const INPUTS = "ad_launch.age_days,ad_launch.prior_roas,ad_launch.purchases,ad_launch.revenue,ad_launch.spend";
    check("HR3 sql: entity mart selects every classifier input, never a classified output", q.components.join() === INPUTS && !/ad_launch__(winners|launched|open)/.test(q.sql), q.components.join());
    check("HR3 sql: one row per ad (entity key, GROUP BY 4), inputs as ANY_VALUE with NULL counts", q.sql.includes("t.ad_id AS entity_key") && q.sql.includes("GROUP BY 1, 2, 3, 4") && q.sql.includes("ANY_VALUE(t.purchases) AS ad_launch__purchases") && q.sql.includes("COUNTIF(t.prior_roas IS NULL) AS ad_launch__prior_roas__nulls"));
    check("HR3 sql: pre-existing ads and relaunches excluded in WHERE", q.sql.includes("AND t.is_preexisting IS NOT TRUE") && q.sql.includes("AND t.is_relaunch IS NOT TRUE"));
    check("HR3 sql: bucketed on first delivery, date predicate and period tagging", q.sql.includes("DATE_TRUNC(t.first_date, MONTH) AS bucket") && q.sql.includes("t.first_date BETWEEN @scanFrom AND @scanTo") && q.sql.includes("t.first_date BETWEEN p.from_date AND p.to_date") && q.sql.includes("FROM `oneeighty-warehouse.mart.rpt_ad_launch` AS t"));
    check("HR3 sql: no FX, no display currency param (no money)", !q.sql.includes("fx_pairs") && !("displayCurrency" in q.params) && q.sql.includes("0 AS ad_launch__fx_missing_rows"));
    check("HR3 sql: assertDatePredicates passes", (() => { try { assertDatePredicates(q.sql, [real.registry!.marts.ad_launch!]); return true; } catch { return false; } })());
    check("HR3: tampered entity CTE without its date predicate is rejected", (() => {
      try {
        assertDatePredicates(q.sql.replace("AND t.first_date BETWEEN @scanFrom AND @scanTo", "AND TRUE"), [real.registry!.marts.ad_launch!]);
        return false;
      } catch (error) {
        return /date predicate/.test(String(error));
      }
    })());
    const T = (targetRoas: number, readPurchases: number) => ({ killRoas: 1.8, targetRoas, targetCpa: 500, grossMargin: null, scaleMultiplier: 1.2, aggressiveMultiplier: 2, holdGateX: 1, iterateGateX: 2, killGateX: 3, readPurchases, directionalPurchases: 6, maxCiHalfWidth: 0.25, hookRateFloor: 0.2, holdRateFloor: 0.05, frequencyWarn: 2, frequencyAct: 3, noTouchDays: 14, minAdsetBudgetDaily: null, perAdFloorDaily: null, tier: null });
    const withT = (t: ReturnType<typeof T> | null) => realCompile({ ...w, clients: w.clients.map((c) => ({ ...c, creativeThresholds: t })) });
    const a = withT(T(2.25, 15));
    const b = withT(T(3, 25));
    const n = withT(null);
    check("HR3: changing thresholds leaves SQL and cache key byte-identical", a.sql === q.sql && b.sql === q.sql && n.sql === q.sql && a.key === q.key && b.key === q.key && n.key === q.key && JSON.stringify(a.params) === JSON.stringify(b.params));
    check("HR3: no threshold value anywhere in SQL or params", !/2\.25|readPurchases|target/i.test(a.sql + JSON.stringify(a.params)));
    const l = realCompile(resolved({ ...base, components: ["ad_launch.launched"] }));
    check("HR3 shared: hit rate, winners and ads launched compile to one SQL and key", l.sql === q.sql && l.key === q.key);
    const mixed = realCompile(resolved({ ...base, components: ["ad_launch.launched", "ad_launch.winners", "kpis.revenue"] }));
    check("HR3 sql: mixed with kpis, every CTE carries entity_key and the join uses it", mixed.sql.includes("FROM ad_launch\nFULL OUTER JOIN kpis USING (client_id, period, bucket, entity_key)") && mixed.sql.includes("'' AS entity_key") && mixed.sql.endsWith("ORDER BY client_id, period, bucket, entity_key"));
    const plain = realCompile(resolved({ ...base, components: ["kpis.revenue"] }));
    check("HR3 sql: widgets without an entity mart are unchanged (no entity_key)", !plain.sql.includes("entity_key") && plain.sql.endsWith("ORDER BY client_id, period, bucket"));
    const nl = normaliseRows(
      [{ client_id: "manami", period: "cur", bucket: { value: "2026-09-01" }, entity_key: "123", ad_launch__n_rows: 1, ad_launch__foreign_ccy_rows: 0, ad_launch__fx_missing_rows: 0, ad_launch__fx_missing_months: [], ad_launch__purchases: 16, ad_launch__spend: big2("1000.5"), ad_launch__revenue: big2("2600"), ad_launch__age_days: 70, ad_launch__prior_roas: big2("2.0287"), ad_launch__prior_roas__nulls: 0 }],
      q
    );
    check("HR3 normalise: entity row inputs as numbers", nl[0].values["ad_launch.spend"]?.nat === 1000.5 && nl[0].values["ad_launch.prior_roas"]?.nat === 2.0287 && nl[0].values["ad_launch.purchases"]?.nat === 16 && nl[0].guards.ad_launch?.nRows === 1);
  }
  const nm = normaliseRows(
    [{ client_id: "venev", period: "cur", bucket: { value: "2026-09-07" }, kpis__n_rows: 7, kpis__foreign_ccy_rows: 0, kpis__fx_missing_rows: 0, kpis__fx_missing_months: [], meta_campaign__n_rows: null, meta_campaign__foreign_ccy_rows: null, meta_campaign__fx_missing_rows: null, meta_campaign__fx_missing_months: null, meta_campaign__spend__nat: null, meta_campaign__spend__disp: null, meta_campaign__landing_page_views: null }],
    { components: ["meta_campaign.landing_page_views", "meta_campaign.spend"], marts: ["kpis", "meta_campaign"] }
  );
  check("FX4 normalise: absent joined side gives zero guards and null sums", nm[0].guards.meta_campaign?.nRows === 0 && nm[0].values["meta_campaign.spend"]?.disp === null && nm[0].values["meta_campaign.landing_page_views"]?.nat === null && nm[0].values["meta_campaign.landing_page_views"]?.natNulls === 0);
}

function big2(s: string) {
  return { toString: () => s, valueOf: () => s, toJSON: () => s };
}

function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  return `first difference at ${i}: got ${JSON.stringify(a.slice(i, i + 60))}, want ${JSON.stringify(b.slice(i, i + 60))}`;
}

// ---------------------------------------------------------------------------
// Compiler: structure and validation
// ---------------------------------------------------------------------------

{
  const total = compileFixture(SNAPSHOTS[0].widget);
  check("total grain buckets to TOTAL_BUCKET", total.sql.includes(`DATE '${TOTAL_BUCKET}' AS bucket`));
  check("no comparison: no cmp params and no cmp tag", !total.hasComparison && !("cmpFrom" in total.params) && !total.sql.includes("'cmp'"));
  const counts = compileFixture(SNAPSHOTS[1].widget);
  check("counts only: no FX CTE and no displayCurrency param", !counts.sql.includes("fx_pairs") && !("displayCurrency" in counts.params));
  check("day grain bucket is the date", counts.sql.includes("t.date AS bucket"));
  const multi = compileFixture(SNAPSHOTS[2].widget);
  check("two marts: FULL OUTER JOIN USING", multi.sql.includes("FROM email_campaign\nFULL OUTER JOIN kpis USING (client_id, period, bucket)"));
  check("two marts: each CTE has its own date predicate", multi.sql.includes("t.send_date BETWEEN @scanFrom AND @scanTo") && multi.sql.includes("t.date BETWEEN @scanFrom AND @scanTo"));
  check("month grain bucket", multi.sql.includes("DATE_TRUNC(t.send_date, MONTH) AS bucket"));

  for (const q of [merCac, total, counts, multi]) {
    const ids = q.params.clientIds as string[];
    check(`no client id in SQL text (${q.key.slice(0, 8)})`, ids.every((id) => !q.sql.includes(`'${id}'`) && !q.sql.includes(`"${id}"`)));
    check(`every @param in SQL is declared (${q.key.slice(0, 8)})`, [...q.sql.matchAll(/@([a-zA-Z]+)/g)].every((m) => m[1] in q.params && m[1] in q.types));
    check(`every declared param is used (${q.key.slice(0, 8)})`, Object.keys(q.params).every((p) => q.sql.includes(`@${p}`)));
    check(`key is sha256 hex (${q.key.slice(0, 8)})`, /^[0-9a-f]{64}$/.test(q.key));
  }

  const shuffled = compileFixture({
    ...W_MER_CAC,
    queryClientIds: ["manami", "dobias", "rawbark", "manami"],
    components: ["kpis.revenue", "kpis.new_customer_orders", "kpis.paid_spend"],
  });
  check("key stable under client and component order", shuffled.key === merCac.key);
  check("key changes with params", compileFixture({ ...W_MER_CAC, displayCurrency: "EUR" }).key !== merCac.key);

  const throws = (name: string, fn: () => unknown, match?: RegExp) => {
    try {
      fn();
      check(`throws: ${name}`, false, "did not throw");
    } catch (error) {
      check(`throws: ${name}`, !match || match.test(String(error)), String(error));
    }
  };

  throws("tampered SQL without date predicate", () =>
    assertDatePredicates(merCac.sql.replace("AND t.date BETWEEN @scanFrom AND @scanTo", "AND TRUE"), [FIXTURE_MARTS.kpis]), /date predicate/);
  throws("SQL without the mart CTE", () => assertDatePredicates("SELECT 1", [FIXTURE_MARTS.kpis]), /not found/);
  check("assertDatePredicates passes the compiled SQL", (() => { try { assertDatePredicates(merCac.sql, [FIXTURE_MARTS.kpis]); return true; } catch { return false; } })());
  throws("unknown component", () => compileFixture({ ...W_MER_CAC, components: ["kpis.nope" as ComponentId] }), /Unknown component/);
  throws("no components", () => compileFixture({ ...W_MER_CAC, components: [] }), /no components/);
  throws("unsafe column in registry", () =>
    compileWidgetWith(W_MER_CAC, {
      marts: FIXTURE_MARTS,
      components: { ...FIXTURE_REGISTRY.components, "kpis.revenue": { ...fixtureComponent("kpis.revenue", true), column: "revenue) --" } },
    }), /safe identifier/);
  throws("unsafe table in registry", () =>
    compileWidgetWith(W_MER_CAC, { marts: { ...FIXTURE_MARTS, kpis: { ...FIXTURE_MARTS.kpis, table: "mart.x`; DROP" } }, components: FIXTURE_REGISTRY.components }), /safe identifier/);
  throws("component with a mismatched definition", () =>
    compileWidgetWith(W_MER_CAC, { marts: FIXTURE_MARTS, components: { ...FIXTURE_REGISTRY.components, "kpis.revenue": fixtureComponent("kpis.net_sales", true) } }), /does not match/);
  throws("grain unsupported by mart", () => compileFixture({ ...SNAPSHOTS[2].widget, grain: "day" }), /does not support grain/);
  throws("component mart missing from widget.marts", () => compileFixture({ ...W_MER_CAC, marts: [] }), /missing from widget.marts/);
  throws("client id with a quote", () => compileFixture({ ...W_MER_CAC, queryClientIds: ["x' OR 1=1"] }), /Client id/);
  throws("display currency not ISO", () => compileFixture({ ...W_MER_CAC, displayCurrency: "native" }), /Display currency/);
  throws("bad date", () => compileFixture({ ...W_MER_CAC, period: { ...W_MER_CAC.period, current: { from: "2026-07-06'", to: "2026-10-03" } } }), /YYYY-MM-DD/);
  throws("scan does not cover comparison", () => compileFixture({ ...W_MER_CAC, scan: W_MER_CAC.period.current }), /Scan bounds/);
  throws("bad project id", () => compileWidgetWith(W_MER_CAC, FIXTURE_REGISTRY, { projectId: "x`.y" }), /Project id/);
  check("compileWidget is bound to the real registry", (() => {
    try {
      const q = compileWidget(W_MER_CAC);
      return q.sql.includes("mart_daily_kpis") && q.marts.includes("kpis");
    } catch {
      return false;
    }
  })());
  check("componentAlias", componentAlias("kpis.new_customer_orders") === "kpis__new_customer_orders");
}

// ---------------------------------------------------------------------------
// Runner: policy helpers and normalisation
// ---------------------------------------------------------------------------

{
  const today = "2026-10-04";
  check("ttl: range ending yesterday is recent", cacheTtlSeconds("2026-10-03", today) === CACHE_TTL_S.recent);
  check("ttl: two days before yesterday is recent", cacheTtlSeconds("2026-10-01", today) === CACHE_TTL_S.recent);
  check("ttl: five days back is lastWeek", cacheTtlSeconds("2026-09-28", today) === CACHE_TTL_S.lastWeek);
  check("ttl: a month back is older", cacheTtlSeconds("2026-09-01", today) === CACHE_TTL_S.older);
  check("budget default 2 GiB", maxBytesBilled({}) === DEFAULT_MAX_BYTES_BILLED && DEFAULT_MAX_BYTES_BILLED === 2147483648);
  check("budget from env", maxBytesBilled({ REPORTS_MAX_BYTES_BILLED: "1073741824" }) === 1073741824);
  check("budget ignores junk", maxBytesBilled({ REPORTS_MAX_BYTES_BILLED: "2GB" }) === DEFAULT_MAX_BYTES_BILLED && maxBytesBilled({ REPORTS_MAX_BYTES_BILLED: "0" }) === DEFAULT_MAX_BYTES_BILLED);

  const labels = jobLabels({ userEmail: "Someone@Example.com", widgetType: "line" });
  check("labels: app, feature, widget_type", labels.app === "dashboard" && labels.feature === "reports" && labels.widget_type === "line");
  check("labels: user is 8 hex of sha1, never the email", /^[0-9a-f]{8}$/.test(labels.user) && labels.user === createHash("sha1").update("someone@example.com").digest("hex").slice(0, 8));
  check("labels: valid BigQuery label values", Object.entries(labels).every(([k, v]) => /^[a-z][a-z0-9_-]{0,62}$/.test(k) && /^[a-z0-9_-]{0,63}$/.test(v)));

  const bytes = { message: "Query exceeded limit for bytes billed: 2147483648. 4194304000 or higher required.", errors: [{ reason: "bytesBilledLimitExceeded" }] };
  const timeout = { message: "Job execution was cancelled: Job timed out after 20 sec", errors: [{ reason: "timeout" }] };
  const perm = { message: "Access Denied: Table oneeighty-warehouse:mart.x: User does not have permission", errors: [{ reason: "accessDenied" }] };
  const m1 = mapWarehouseError(bytes);
  const m2 = mapWarehouseError(timeout);
  const m3 = mapWarehouseError(perm);
  check("error map: bytes billed -> over_budget", m1 instanceof ReportsError && m1.code === "over_budget");
  check("error map: job timeout -> timeout", m2.code === "timeout");
  check("error map: permission -> warehouse_error", m3.code === "warehouse_error");
  check("error map: message never leaks BigQuery text", ![m1, m2, m3].some((e) => /oneeighty|permission|Access Denied/.test(e.message)));
  check("error map: cause kept for logs", m3.cause === perm);
  const passthrough = new ReportsError("too_large");
  check("error map: ReportsError passes through", mapWarehouseError(passthrough) === passthrough);

  const big = (s: string) => ({ toString: () => s, valueOf: () => s, toJSON: () => s });
  const rows = normaliseRows(
    [
      {
        client_id: "dobias",
        period: "cmp",
        bucket: { value: "2025-07-07" },
        kpis__n_rows: 7,
        kpis__foreign_ccy_rows: 0,
        kpis__fx_missing_rows: 2,
        kpis__fx_missing_months: [{ value: "2025-08-01" }, { value: "2025-07-01" }],
        kpis__revenue__nat: big("1234.5"),
        kpis__revenue__disp: big("28000.125"),
        kpis__new_customer_orders: 12,
        kpis__paid_spend__nat: null,
        kpis__paid_spend__disp: null,
      },
      { client_id: "manami", period: "cur", bucket: { value: TOTAL_BUCKET }, kpis__n_rows: 1, kpis__foreign_ccy_rows: 1, kpis__fx_missing_rows: 0, kpis__fx_missing_months: null, kpis__revenue__nat: 1, kpis__revenue__disp: 1, kpis__new_customer_orders: null, kpis__paid_spend__nat: 0, kpis__paid_spend__disp: 0 },
    ],
    { components: ["kpis.new_customer_orders", "kpis.paid_spend", "kpis.revenue"], marts: ["kpis"] }
  );
  const r0 = rows[0];
  check("normalise: ids, period and DATE bucket", r0.clientId === "dobias" && r0.period === "cmp" && r0.bucket === "2025-07-07");
  check("normalise: NUMERIC to number", r0.values["kpis.revenue"]?.nat === 1234.5 && r0.values["kpis.revenue"]?.disp === 28000.125);
  check("normalise: count has nat === disp", r0.values["kpis.new_customer_orders"]?.nat === 12 && r0.values["kpis.new_customer_orders"]?.disp === 12);
  check("normalise: NULL stays null, never 0", r0.values["kpis.paid_spend"]?.nat === null && r0.values["kpis.paid_spend"]?.disp === null);
  check("normalise: guards and sorted fx months", JSON.stringify(r0.guards.kpis) === JSON.stringify({ nRows: 7, foreignCcyRows: 0, fxMissingRows: 2, fxMissingMonths: ["2025-07-01", "2025-08-01"] }));
  check("normalise: NULL counts default to 0 when the column is absent", r0.values["kpis.revenue"]?.natNulls === 0 && r0.values["kpis.new_customer_orders"]?.natNulls === 0);
  const nrows = normaliseRows(
    [{ client_id: "dobias", period: "cur", bucket: { value: "2026-04-01" }, kpis__n_rows: 30, kpis__foreign_ccy_rows: 0, kpis__fx_missing_rows: 0, kpis__fx_missing_months: [], kpis__revenue__nat: 210447, kpis__revenue__disp: 210447, kpis__revenue__nat_nulls: 0, kpis__revenue__disp_nulls: 0, kpis__paid_spend__nat: 1724, kpis__paid_spend__disp: 1724, kpis__paid_spend__nat_nulls: 19, kpis__paid_spend__disp_nulls: 19, kpis__new_customer_orders: 5, kpis__new_customer_orders__nulls: 2 }],
    { components: ["kpis.new_customer_orders", "kpis.paid_spend", "kpis.revenue"], marts: ["kpis"] }
  );
  const nv = nrows[0].values;
  check("normalise: NULL-row counts carried (money nat/disp, count)", nv["kpis.paid_spend"]?.natNulls === 19 && nv["kpis.paid_spend"]?.dispNulls === 19 && nv["kpis.revenue"]?.natNulls === 0 && nv["kpis.new_customer_orders"]?.natNulls === 2 && nv["kpis.new_customer_orders"]?.dispNulls === 2);
  check("normalise: NULL fx months is empty, zero stays zero", rows[1].guards.kpis?.fxMissingMonths.length === 0 && rows[1].values["kpis.paid_spend"]?.nat === 0 && rows[1].values["kpis.new_customer_orders"]?.nat === null);
}

// ---------------------------------------------------------------------------
// Wire params: what @google-cloud/bigquery actually sends (2026-10-04 bug)
// ---------------------------------------------------------------------------
//
// A provided type of DATE makes the library send `value.value`; for a plain
// string that is undefined, so every date param went out as NULL, every query
// matched 0 rows and every Reports cell read "No data" with HTTP 200. A dry
// run cannot see it, so the params are serialised here with the library's own
// encoder and compared to the compiled values.
{
  const q = compileWidgetWith(
    resolved({ clientIds: ["dobias", "manami"], components: ["kpis.revenue"], grain: "week", current: { from: "2026-07-06", to: "2026-10-03" }, compare: "previous_period" }),
    FIXTURE_REGISTRY,
    { projectId: "oneeighty-warehouse" }
  );
  const encode = BigQuery as unknown as { valueToQueryParameter_(v: unknown, t: unknown): { parameterValue: { value?: unknown; arrayValues?: Array<{ value?: unknown }> } } };
  const wire = toJobParams(q.params, q.types);
  const dateNames = Object.keys(q.types).filter((k) => q.types[k] === "DATE");
  check("wire params: compiled query has six DATE params", dateNames.length === 6);
  check(
    "wire params: every DATE param reaches BigQuery as its YYYY-MM-DD value, never NULL",
    dateNames.every((k) => encode.valueToQueryParameter_(wire[k], q.types[k]).parameterValue.value === q.params[k]),
    dateNames.map((k) => `${k}=${JSON.stringify(encode.valueToQueryParameter_(wire[k], q.types[k]).parameterValue)}`).join(" ")
  );
  check("wire params: raw strings would be NULL (guards the encoder assumption)", encode.valueToQueryParameter_("2026-07-06", "DATE").parameterValue.value === undefined);
  const ids = encode.valueToQueryParameter_(wire.clientIds, q.types.clientIds).parameterValue.arrayValues?.map((v) => v.value);
  check("wire params: ARRAY<STRING> and STRING untouched", JSON.stringify(ids) === JSON.stringify(q.params.clientIds) && encode.valueToQueryParameter_(wire.displayCurrency, "STRING").parameterValue.value === "CZK");
  const arr = encode.valueToQueryParameter_(toJobParams({ d: ["2026-01-01"] }, { d: ["DATE"] }).d, ["DATE"]).parameterValue.arrayValues;
  check("wire params: ARRAY<DATE> items wrapped too", arr?.[0]?.value === "2026-01-01");
}

// ---------------------------------------------------------------------------
// BigQuery: (b) dry runs and (c) live column check
// ---------------------------------------------------------------------------

function hasCredentials(): boolean {
  return Boolean(
    process.env.GCP_SERVICE_ACCOUNT_KEY_BASE64 ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      existsSync(join(homedir(), ".config", "gcloud", "application_default_credentials.json"))
  );
}

function isAuthError(error: unknown): boolean {
  return /default credentials|invalid_grant|invalid_rapt|unauthenticated|reauth|Could not refresh access token/i.test(String(error));
}

const WINDOWS: Array<{ name: string; preset: "90d" | "12m" | "all" }> = [
  { name: "90d", preset: "90d" },
  { name: "12m", preset: "12m" },
  { name: "60m", preset: "all" },
];
const GRAINS: QueryGrain[] = ["day", "week", "month", "total"];

/** Span in the grain's own unit (design 2.7 limits). Month and total: the all preset is the warehouse window by definition. */
function withinSpan(grain: QueryGrain, range: DateRange): boolean {
  const days = daysInRange(range);
  if (grain === "day") return days <= MAX_SPAN.day;
  if (grain === "week") return Math.ceil(days / 7) <= MAX_SPAN.week;
  return true;
}

async function bigQueryChecks(): Promise<void> {
  if (argv.has("--offline")) {
    console.log("check:reports  SKIP BigQuery steps (b, c): --offline");
    return;
  }
  if (!hasCredentials()) {
    console.log(
      "check:reports  SKIP BigQuery steps (b, c): no GCP credentials (set GCP_SERVICE_ACCOUNT_KEY_BASE64, GOOGLE_APPLICATION_CREDENTIALS, or run gcloud auth application-default login)"
    );
    return;
  }

  const registry = real.registry ?? FIXTURE_REGISTRY;
  const registryName = real.registry ? "real registry" : "fixture registry";
  const budget = maxBytesBilled();
  const limit = budget * DRY_RUN_BUDGET_SHARE;

  let clients: string[];
  try {
    const res = await queryJob<{ client_id: string }>(
      `SELECT client_id FROM \`${PROJECT}.ref.clients\` WHERE status = 'active' AND client_id <> 'demo' ORDER BY client_id`,
      { jobTimeoutMs: 20_000, labels: { app: "dashboard", feature: "reports", widget_type: "check" } }
    );
    clients = res.rows.map((r) => r.client_id);
  } catch (error) {
    if (isAuthError(error)) {
      console.log(`check:reports  SKIP BigQuery steps (b, c): credentials present but not usable (${String(error).slice(0, 120)})`);
      return;
    }
    throw error;
  }
  check("bq: active clients found", clients.length > 0);

  // (b) Dry runs. Every phase-1 kpis component at once: a single metric reads
  // a subset of these columns, and BigQuery prunes columns through the view,
  // so this is the upper bound for every phase-1 metric at that grain and window.
  const phase1 = (Object.values(registry.components) as ComponentDef[])
    .filter((c) => registry.marts[c.mart]?.phase === 1)
    .map((c) => c.id)
    .sort();
  console.log(`check:reports  (b) dry runs, ${registryName}, ${phase1.length} components, ${clients.length} clients, budget ${budget} B, fail above ${limit} B`);
  const today = new Date().toISOString().slice(0, 10);
  for (const w of WINDOWS) {
    const range = presetRange(w.preset, today);
    for (const grain of GRAINS) {
      if (!withinSpan(grain, range)) {
        console.log(`  ${w.name.padEnd(4)} ${grain.padEnd(5)} skipped: over MAX_SPAN (resolve answers 413)`);
        continue;
      }
      const widget = resolved({ clientIds: clients, components: phase1, grain, current: range, compare: "previous_year" });
      const q = compileWidgetWith(widget, registry, { projectId: PROJECT });
      const res = await queryJob(q.sql, { params: q.params, types: q.types, dryRun: true, maximumBytesBilled: budget });
      const bytes = res.totalBytesProcessed ?? Number.NaN;
      console.log(`  ${w.name.padEnd(4)} ${grain.padEnd(5)} ${String(bytes).padStart(12)} B  (${((bytes / budget) * 100).toFixed(2)}% of budget)`);
      check(`dry run ${w.name} ${grain} within ${DRY_RUN_BUDGET_SHARE * 100}% of budget`, bytes <= limit, `${bytes} B`);
    }
  }

  // (c) Live column check.
  if (!real.registry) console.log(`check:reports  (c) real registry skipped: ${real.note}; checking the fixture registry instead`);
  const byTable = new Map<string, { mart: MartDef; columns: Set<string> }>();
  for (const mart of Object.values(registry.marts) as MartDef[]) {
    const needed = new Set<string>(["client_id", mart.dateColumn]);
    if (mart.currencyColumn) needed.add(mart.currencyColumn);
    for (const c of Object.values(registry.components) as ComponentDef[]) if (c.mart === mart.id) needed.add(c.column);
    byTable.set(mart.table, { mart, columns: needed });
  }
  for (const [table, { mart, columns }] of byTable) {
    const [dataset, name] = table.split(".");
    const res = await queryJob<{ column_name: string }>(
      `SELECT column_name FROM \`${PROJECT}.${dataset}\`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = @table`,
      { params: { table: name }, types: { table: "STRING" }, jobTimeoutMs: 20_000 }
    );
    const live = new Set(res.rows.map((r) => r.column_name));
    const missing = [...columns].filter((c) => !live.has(c));
    if (mart.phase === 1) {
      check(`columns: ${table} has every ${registryName} column`, live.size > 0 && missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : "table not found");
    } else if (missing.length) {
      console.log(`  phase 2 mart ${table}: ${live.size === 0 ? "not found" : `missing ${missing.join(", ")}`} (not a failure until phase 2 ships)`);
    }
    console.log(`  ${table}: ${columns.size - missing.length}/${columns.size} columns live`);
  }
}

async function main(): Promise<void> {
  try {
    await bigQueryChecks();
  } catch (error) {
    failures.push(`BigQuery step threw: ${String(error).slice(0, 300)}`);
  }
  if (failures.length) {
    console.error(`check:reports  ${passed} passed, ${failures.length} failed`);
    for (const f of failures) console.error(`  FAIL ${f}`);
    process.exit(1);
  }
  console.log(`check:reports  ${passed}/${passed} passed (registry: ${real.note})`);
}

void main();
