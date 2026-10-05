/**
 * check-reports-eval: fixture assertions for the Reports semantic layer (WP1).
 *
 * Covers the registry (components verified against the live view, metrics,
 * caveats, capabilities), resolve.ts (filters, clients, period clamp,
 * currency, limits, availability), evaluate.ts (ratio from summed components,
 * combined across currencies, FX bucket nulling, COGS zero and NULL guard,
 * not_connected exclusion and coverage, status precedence, pp vs relative
 * deltas, partial buckets, low volume, comparison alignment) and
 * benchmarkMatch.ts (vertical and region preference, time window, FX, stale).
 *
 * Pure: no BigQuery, no network. Run:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/check-reports-eval.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { matchBenchmarks, fxFactor, regionPreference } from "@/lib/reports/benchmarkMatch";
import type { BenchmarkRow, ComponentRow, ComponentSum, FxRate, ResolvedWidget } from "@/lib/reports/contracts";
import { NO_THRESHOLDS, classifyEntityRows, evaluateWidget } from "@/lib/reports/evaluate";
import { hitRate, launchStatus, type LaunchRow } from "@/lib/creative/hitRate";
import type { CreativeThresholds } from "@/lib/creative/stats";
import { FIXTURE_CLIENTS, FIXTURE_FILTERS, FIXTURE_RESOLVED, FIXTURE_ROWS, FIXTURE_TODAY } from "@/lib/reports/fixtures";
import { CAPABILITIES, evalCapExpr, missingCapabilities, toReportCapabilities } from "@/lib/reports/registry/capabilities";
import { CAVEATS, clientCaveats, visibleCaveats } from "@/lib/reports/registry/caveats";
import { COMPONENTS, MARTS } from "@/lib/reports/registry/components";
import { METRIC_IDS, PHASE2_METRIC_IDS, REGISTRY_METRIC_IDS, type MetricId } from "@/lib/reports/registry/ids";
import { METRICS, METRIC_LIST, componentsFor, findMetricId } from "@/lib/reports/registry/metrics";
import { IDENTIFIER_RE, type ComponentId, type ReportClient } from "@/lib/reports/registry/types";
import { buildBuckets, mergeFilters, partialBucketIndexes, resolveWidget } from "@/lib/reports/resolve";
import { WidgetQuery, verticalSeriesId, type ReportFilters, type WidgetResult } from "@/lib/reports/types";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(detail === undefined ? name : `${name}: ${JSON.stringify(detail)}`);
}

function close(a: number | null | undefined, b: number, eps = 1e-9): boolean {
  return typeof a === "number" && Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
}

function eqJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const [alpha, bravo, charlie, delta] = FIXTURE_CLIENTS;
const TODAY = FIXTURE_TODAY; // yesterday = 2026-10-03

function widget(metrics: MetricId[], opts: { grain?: WidgetQuery["grain"]; split?: WidgetQuery["split"]; filters?: Partial<ReportFilters>; clients?: readonly ReportClient[] } = {}): ResolvedWidget {
  const query = WidgetQuery.parse({ metrics, grain: opts.grain ?? "total", split: opts.split ?? "client" });
  const out = resolveWidget({ filters: { ...FIXTURE_FILTERS, ...opts.filters }, query, clients: opts.clients ?? FIXTURE_CLIENTS, today: TODAY });
  if (!out.ok) throw new Error(`resolve failed: ${out.error.message}`);
  return out.widget;
}

type V = number | null | [number | null, number | null] | ComponentSum;

/** A summed value with NULL rows inside it (SQL SUM skips them): `sum` over the valued rows, `nulls` rows without a value. */
const withNulls = (sum: number | null, nulls: number): ComponentSum => ({ nat: sum, disp: sum, natNulls: nulls, dispNulls: nulls });

function row(clientId: string, period: "cur" | "cmp", bucket: string, values: Partial<Record<ComponentId, V>>, guards: Partial<{ foreignCcyRows: number; fxMissingRows: number; fxMissingMonths: string[] }> = {}): ComponentRow {
  const vals: Partial<Record<ComponentId, ComponentSum>> = {};
  for (const [k, v] of Object.entries(values) as Array<[ComponentId, V]>) {
    vals[k] = Array.isArray(v) ? { nat: v[0], disp: v[1] } : v !== null && typeof v === "object" ? v : { nat: v, disp: v };
  }
  return {
    clientId,
    period,
    bucket,
    guards: { kpis: { nRows: 1, foreignCcyRows: guards.foreignCcyRows ?? 0, fxMissingRows: guards.fxMissingRows ?? 0, fxMissingMonths: guards.fxMissingMonths ?? [] } },
    values: vals,
  };
}

function evalW(w: ResolvedWidget, rows: ComponentRow[]): WidgetResult {
  return evaluateWidget({ widget: w, rows, benchmarks: [], run: { key: "k", cached: false, generatedAt: "2026-10-04T00:00:00.000Z" } });
}

function cell(r: WidgetResult, seriesId: string, metric: MetricId) {
  const s = r.series.find((x) => x.id === seriesId);
  const c = s?.cells[metric];
  if (!c) throw new Error(`no cell ${seriesId}/${metric}`);
  return c;
}

// ---------------------------------------------------------------------------
// 1. Registry
// ---------------------------------------------------------------------------

/** Live columns of mart.mart_daily_kpis, INFORMATION_SCHEMA.COLUMNS, 2026-10-04. */
const LIVE_KPIS_COLUMNS = [
  "client_id", "date", "currency", "revenue", "new_customer_revenue", "returning_customer_revenue", "net_sales",
  "new_customer_net_sales", "returning_customer_net_sales", "shipping_revenue", "tax_collected", "gross_revenue_incl_tax",
  "cogs", "orders", "unique_customers", "new_customer_orders", "returning_customer_orders", "meta_spend", "meta_revenue",
  "meta_purchases", "meta_impressions", "meta_clicks", "meta_reach", "google_spend", "google_revenue", "google_purchases",
  "google_impressions", "google_clicks", "paid_spend", "cm1_other_costs", "fulfillment_cost", "cm1", "cm2", "cm3",
];
/** Live columns used from mart.mart_meta_campaign_perf and mart.mart_meta_ad_perf, INFORMATION_SCHEMA.COLUMNS, 2026-10-04. */
const LIVE_META_CAMPAIGN_COLUMNS = ["date", "currency", "spend", "impressions", "reach", "link_clicks", "landing_page_views", "add_to_cart", "initiate_checkout", "purchases"];
const LIVE_META_AD_COLUMNS = ["date", "currency", "ad_id", "spend", "impressions", "video_play_actions", "video_views", "video_thruplays"];
const LIVE_EMAIL_CAMPAIGN_COLUMNS = ["send_date", "currency", "sent", "delivered", "unique_opens", "unique_clicks", "revenue"];
/** Live columns used from mart.rpt_ad_launch (HR1, migration 254), INFORMATION_SCHEMA.COLUMNS, 2026-10-05. */
const LIVE_AD_LAUNCH_COLUMNS = ["client_id", "ad_id", "first_date", "spend", "revenue", "purchases", "age_days", "is_preexisting", "is_relaunch", "prior_roas"];
const LIVE = { kpis: LIVE_KPIS_COLUMNS, meta_campaign: LIVE_META_CAMPAIGN_COLUMNS, meta_ad: LIVE_META_AD_COLUMNS, email_campaign: LIVE_EMAIL_CAMPAIGN_COLUMNS, ad_launch: LIVE_AD_LAUNCH_COLUMNS } as const;

for (const c of Object.values(COMPONENTS)) {
  check(`component ${c.id} column is an identifier`, IDENTIFIER_RE.test(c.column));
  // Classified components (hit rate) are written by the evaluator, never read from a column.
  if (c.classified === undefined) check(`component ${c.id} exists in the live view`, (LIVE[c.mart] as readonly string[]).includes(c.column));
}
for (const c of Object.values(COMPONENTS)) {
  if (c.filterScope) check(`component ${c.id} scope key exists in the live view`, (LIVE[c.mart] as readonly string[]).includes(c.filterScope.key));
}
for (const m of Object.values(MARTS)) {
  check(`mart ${m.id} date column live`, (LIVE[m.id] as readonly string[]).includes(m.dateColumn));
  check(`mart ${m.id} currency column live`, m.currencyColumn === null || (LIVE[m.id] as readonly string[]).includes(m.currencyColumn));
}
check("excluded columns are not components", !["unique_customers", "cm1", "cm2", "cm3", "frequency_per_day"].some((c) => Object.values(COMPONENTS).some((d) => d.column === c)));
check("cogs guard is revenue", COMPONENTS["kpis.cogs"].zeroIsMissingWhen === "kpis.revenue");

check("every registry id defined", REGISTRY_METRIC_IDS.every((id) => METRICS[id]?.id === id));
check("47 queryable metrics (30 KPI view + 14 Meta soft + 3 hit rate)", METRIC_IDS.length === 47 && METRIC_IDS.every((id) => METRICS[id].phase === 1));
check("4 phase-2 metrics (email)", PHASE2_METRIC_IDS.length === 4 && PHASE2_METRIC_IDS.every((id) => METRICS[id].phase === 2));
check("picker list holds the 47 queryable metrics", METRIC_LIST.length === 47);
check("cm3 = revenue - cogs - fulfillment - paid (mart) - stated fulfilment and other CM1 (Snapshot parity)", METRICS.cm3.kind === "sum" && eqJson(METRICS.cm3.terms, [
  { c: "kpis.revenue", sign: 1, nullAs: "gap" },
  { c: "kpis.cogs", sign: -1, nullAs: "gap" },
  { c: "kpis.fulfillment_cost", sign: -1, nullAs: "zero" },
  { c: "kpis.paid_spend", sign: -1, nullAs: "zero" },
  { c: "kpis.fulfilment_stated", sign: -1, nullAs: "zero" },
  { c: "kpis.other_cm1_stated", sign: -1, nullAs: "zero" },
]));
check("cm1_pct = revenue - cogs - stated other CM1", METRICS.cm1_pct.kind === "ratio" && eqJson(METRICS.cm1_pct.numerator, [
  { c: "kpis.revenue", sign: 1, nullAs: "gap" },
  { c: "kpis.cogs", sign: -1, nullAs: "gap" },
  { c: "kpis.other_cm1_stated", sign: -1, nullAs: "zero" },
]));
check("stated-rate components: orders as money, zero, one rate each", (["kpis.fulfilment_stated", "kpis.other_cm1_stated"] as const).every((id) => COMPONENTS[id].column === "orders" && COMPONENTS[id].money && COMPONENTS[id].nullMeans === "zero") && COMPONENTS["kpis.fulfilment_stated"].perClientRate === "fulfilment" && COMPONENTS["kpis.other_cm1_stated"].perClientRate === "otherCm1");
check("only kpis selects all components (shared query)", MARTS.kpis.selectAll === true && !("selectAll" in MARTS.meta_ad) && !("selectAll" in MARTS.meta_campaign) && !("selectAll" in MARTS.email_campaign));
check("cm3_pct uses the same numerator", METRICS.cm3_pct.kind === "ratio" && METRICS.cm3.kind === "sum" && eqJson(METRICS.cm3_pct.numerator, METRICS.cm3.terms));
check("meta.components sorted and unique", REGISTRY_METRIC_IDS.every((id) => {
  const c = METRICS[id].meta.components;
  return eqJson([...c].sort(), c) && new Set(c).size === c.length;
}));
check("fxMode display for money", METRICS.revenue.meta.fxMode === "display" && METRICS.mer.meta.fxMode === "native-per-client");
check("meta_cpm scale 1000", METRICS.meta_cpm.kind === "ratio" && METRICS.meta_cpm.scale === 1000);
check("mer requires shop and paid", eqJson(METRICS.mer.meta.requires, { all: [{ any: ["meta", "googleAds"] }, "shop"] }));
check("meta_roas requires meta", METRICS.meta_roas.meta.requires === "meta");
check("money metrics carry foreign_currency_rows", (METRICS.revenue.caveats ?? []).includes("foreign_currency_rows") && (METRICS.mer.caveats ?? []).includes("foreign_currency_rows"));
check("count metrics do not", !(METRICS.orders.caveats ?? []).includes("foreign_currency_rows"));
check("woo fee caveat not on any metric", REGISTRY_METRIC_IDS.every((id) => !(METRICS[id].caveats ?? []).includes("woo_fees_not_netted")));
check("findMetricId by alias", findMetricId("Gross margin") === "cm1_pct" && findMetricId("first orders") === "new_customers" && findMetricId("nope") === null);
check("componentsFor adds guard and volume components", eqJson(componentsFor(["cogs"]), ["kpis.cogs", "kpis.revenue"]) && componentsFor(["mer"]).includes("kpis.paid_spend"));

// Caveats
check("woo_fees_not_netted never applies", FIXTURE_CLIENTS.every((c) => !CAVEATS.woo_fees_not_netted.applies(c)));
check("foreign_currency_rows never from registry", FIXTURE_CLIENTS.every((c) => !CAVEATS.foreign_currency_rows.applies(c)));
check("shoptet: revenue incl VAT", clientCaveats(alpha).includes("revenue_incl_vat") && !clientCaveats(bravo).includes("revenue_incl_vat"));
check("shopify: refunds not netted", clientCaveats(bravo).includes("returns_not_netted"));
check("google only paid", clientCaveats(charlie).includes("google_only_paid") && !clientCaveats(alpha).includes("google_only_paid"));
check("visible caveats intersect", eqJson(visibleCaveats(clientCaveats(charlie), METRICS.mer.caveats), ["google_only_paid"]));

// Capabilities
const rc = toReportCapabilities({ shopify: false, shoptet: false, woocommerce: true, klaviyo: false, ecomail: true, meta: false, googleAds: true, ga4: false, instagram: true });
check("derived shop and email", rc.shop && rc.email && rc.woocommerce && !("instagram" in rc));
check("evalCapExpr any/all", evalCapExpr({ all: ["shop", { any: ["meta", "googleAds"] }] }, rc) && !evalCapExpr({ all: ["shop", "meta"] }, rc));
check("missingCapabilities", eqJson(missingCapabilities({ all: ["shop", "meta"] }, rc), ["meta"]) && eqJson(missingCapabilities("shop", rc), []));
check("capability list complete", CAPABILITIES.length === 10);

// ---------------------------------------------------------------------------
// 2. Resolve
// ---------------------------------------------------------------------------

check("mergeFilters prefers overrides", eqJson(mergeFilters(FIXTURE_FILTERS, { currency: "EUR" }), { ...FIXTURE_FILTERS, currency: "EUR" }));

{
  const w = widget(["revenue"], { filters: { clients: { mode: "list", ids: ["delta", "zulu", "alpha"] } } });
  check("list: unknown ids dropped, sorted", eqJson(w.clients.map((c) => c.id), ["alpha", "delta"]));
}
{
  const w = widget(["revenue"], { filters: { clients: { mode: "vertical", verticals: ["vertical_a", "unassigned"] } } });
  check("vertical selection incl. unassigned", eqJson(w.clients.map((c) => c.id), ["alpha", "bravo", "delta"]));
}
{
  const w = widget(["revenue"], { filters: { clients: { mode: "all" }, period: { kind: "preset", preset: "90d" } } });
  check("all clients", w.clients.length === 4);
  check("preset 90d ends yesterday", eqJson(w.period.current, { from: "2026-07-06", to: "2026-10-03" }));
  check("previous period", eqJson(w.period.comparison, { from: "2026-04-07", to: "2026-07-05" }));
  check("scan covers both", eqJson(w.scan, { from: "2026-04-07", to: "2026-10-03" }));
}
{
  const w = widget(["revenue"], { filters: { period: { kind: "custom", from: "2026-09-01", to: "2026-10-10" }, compare: "previous_year" } });
  check("custom clamped to yesterday", w.period.current.to === "2026-10-03" && w.warnings.some((x) => x.code === "range_clamped"));
  check("previous year is 364 days back", w.period.comparison?.from === "2025-09-02");
}
{
  const w = widget(["revenue"], { grain: "month", filters: { period: { kind: "custom", from: "2015-01-01", to: "2016-01-01" } } });
  check("range before the warehouse window clamps into it", eqJson(w.period.current, { from: "2021-10-03", to: "2021-10-03" }) && w.warnings.some((x) => x.code === "range_clamped"));
  const w2 = widget(["revenue"], { grain: "month", filters: { period: { kind: "custom", from: "2015-01-01", to: "2026-09-30" } } });
  check("custom from clamped to the warehouse window", eqJson(w2.period.current, { from: "2021-10-03", to: "2026-09-30" }));
}
{
  const w = widget(["revenue"], { filters: { currency: "native", clients: { mode: "list", ids: ["alpha", "charlie"] } } });
  check("native resolves to shared currency", w.displayCurrency === "CZK" && !w.warnings.some((x) => x.code === "currency_coerced"));
  const w2 = widget(["revenue"], { filters: { currency: "native", clients: { mode: "list", ids: ["bravo"] } } });
  check("native single USD client", w2.displayCurrency === "USD");
  const w3 = widget(["revenue"], { filters: { currency: "native" } });
  check("mixed currencies coerce to CZK", w3.displayCurrency === "CZK" && w3.warnings.some((x) => x.code === "currency_coerced"));
}
{
  const q = WidgetQuery.parse({ metrics: ["revenue"], grain: "day", split: "client" });
  const tooLong = resolveWidget({ filters: { ...FIXTURE_FILTERS, period: { kind: "custom", from: "2025-08-01", to: "2026-09-30" } }, query: q, clients: FIXTURE_CLIENTS, today: TODAY });
  check("day span > 400 is too_large", !tooLong.ok && tooLong.error.limit === "span" && tooLong.error.suggestion === "Use week grain");
  const points = resolveWidget({ filters: { ...FIXTURE_FILTERS, period: { kind: "custom", from: "2025-09-19", to: "2026-10-03" } }, query: q, clients: FIXTURE_CLIENTS, today: TODAY });
  check("380 days x 4 clients is too many points", !points.ok && points.error.limit === "points");
  const combined = resolveWidget({ filters: { ...FIXTURE_FILTERS, period: { kind: "preset", preset: "12m" } }, query: { ...q, split: "combined" }, clients: FIXTURE_CLIENTS, today: TODAY });
  check("365 days combined is fine", combined.ok);
  const allMonth = resolveWidget({ filters: { ...FIXTURE_FILTERS, period: { kind: "preset", preset: "all" } }, query: { ...q, grain: "month" }, clients: FIXTURE_CLIENTS, today: TODAY });
  check("preset all fits month grain", allMonth.ok);
  const allWeek = resolveWidget({ filters: { ...FIXTURE_FILTERS, period: { kind: "preset", preset: "all" } }, query: { ...q, grain: "week" }, clients: FIXTURE_CLIENTS, today: TODAY });
  check("preset all at week grain suggests month", !allWeek.ok && allWeek.error.suggestion === "Use month grain");
}
{
  const w = widget(["meta_roas", "cm3"], { grain: "week" });
  check("availability: charlie has no meta", w.availability.charlie.meta_roas?.ok === false && eqJson(w.availability.charlie.meta_roas?.missing, ["meta"]));
  check("components sorted incl. fulfilment", eqJson(w.components, ["kpis.cogs", "kpis.fulfillment_cost", "kpis.fulfilment_stated", "kpis.meta_revenue", "kpis.meta_spend", "kpis.other_cm1_stated", "kpis.paid_spend", "kpis.revenue"]));
  check("marts", eqJson(w.marts, ["kpis"]));
  const w2 = widget(["meta_roas"]);
  check("client with every metric not connected left out of query ids", eqJson(w2.queryClientIds, ["alpha", "bravo", "delta"]));
}

// ---------------------------------------------------------------------------
// 3. Buckets
// ---------------------------------------------------------------------------

{
  const range = { from: "2026-09-02", to: "2026-10-03" };
  check("week buckets start on Monday", eqJson(buildBuckets(range, "week"), ["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]));
  check("partial first and last week", eqJson(partialBucketIndexes(range, "week"), [0, 4]));
  check("month buckets", eqJson(buildBuckets(range, "month"), ["2026-09-01", "2026-10-01"]));
  check("partial months", eqJson(partialBucketIndexes(range, "month"), [0, 1]));
  check("full month not partial", eqJson(partialBucketIndexes({ from: "2026-09-01", to: "2026-09-30" }, "month"), []));
  check("full ISO weeks not partial", eqJson(partialBucketIndexes({ from: "2026-09-07", to: "2026-09-20" }, "week"), []));
  check("day buckets never partial", eqJson(partialBucketIndexes(range, "day"), []) && buildBuckets(range, "day").length === 32);
  check("total has no buckets", eqJson(buildBuckets(range, "total"), []));
}

// ---------------------------------------------------------------------------
// 4. Evaluate
// ---------------------------------------------------------------------------

// Range 2026-09-07..2026-10-03 (4 ISO weeks, last one partial), compare previous period 2026-08-11..2026-09-06.

// 4.1 Ratio from summed components, never averaged; totals from component sums.
{
  const w = widget(["mer"], { grain: "week", filters: { clients: { mode: "list", ids: ["alpha"] } } });
  const r = evalW(w, [
    row("alpha", "cur", "2026-09-07", { "kpis.revenue": 300, "kpis.paid_spend": 100 }),
    row("alpha", "cur", "2026-09-14", { "kpis.revenue": 100, "kpis.paid_spend": 300 }),
  ]);
  const c = cell(r, "alpha", "mer");
  check("bucket ratio", close(c.points?.[0], 3) && close(c.points?.[1], 1 / 3));
  check("total = SUM(num)/SUM(den), not mean of buckets", close(c.total, 1));
  check("missing bucket is a gap", c.points?.[2] === null && c.points?.[3] === null && c.points?.length === 4);
  check("partial last week flagged", eqJson(r.partialBuckets, [3]) && r.buckets.length === 4);
  check("ok cell has no reason", c.status === "ok" && c.reason === undefined);
}

// 4.2 Combined across currencies: rollups read display sums.
{
  const w = widget(["revenue", "mer"], { split: "combined", filters: { clients: { mode: "list", ids: ["alpha", "bravo"] } } });
  const r = evalW(w, [
    row("alpha", "cur", "1970-01-01", { "kpis.revenue": 1000, "kpis.paid_spend": 500 }),
    row("bravo", "cur", "1970-01-01", { "kpis.revenue": [100, 2310], "kpis.paid_spend": [50, 1155] }),
  ]);
  check("combined revenue in CZK", close(cell(r, "combined", "revenue").total, 3310));
  check("combined MER from display sums", close(cell(r, "combined", "mer").total, 3310 / 1655));
  check("combined coverage 2 of 2", eqJson(cell(r, "combined", "revenue").coverage, { included: 2, of: 2 }));
  check("combined series lists clients", eqJson(r.series[0].clientIds, ["alpha", "bravo"]) && r.series[0].kind === "combined");
  check("combined caveats are the union", r.series[0].caveats.includes("revenue_incl_vat") && r.series[0].caveats.includes("returns_not_netted"));

  // Per-client: money metrics read display, ratio metrics read native.
  const w2 = widget(["revenue", "mer"], { filters: { clients: { mode: "list", ids: ["bravo"] } } });
  const r2 = evalW(w2, [row("bravo", "cur", "1970-01-01", { "kpis.revenue": [100, 2310], "kpis.paid_spend": [40, 1155] })]);
  check("per-client money reads display", close(cell(r2, "bravo", "revenue").total, 2310));
  check("per-client ratio reads native", close(cell(r2, "bravo", "mer").total, 2.5));
}

// 4.3 FX bucket nulling.
{
  const w = widget(["cm3", "mer", "revenue"], { grain: "week", filters: { clients: { mode: "list", ids: ["bravo"] }, compare: "none" } });
  const r = evalW(w, [
    row("bravo", "cur", "2026-09-07", { "kpis.revenue": [26000, 601000], "kpis.cogs": [7800, 180300], "kpis.paid_spend": [5000, 115600], "kpis.fulfillment_cost": [0, 0] }),
    row("bravo", "cur", "2026-09-28", { "kpis.revenue": [20000, 231000], "kpis.cogs": [6000, 69300], "kpis.paid_spend": [4000, 46200], "kpis.fulfillment_cost": [0, 0] }, { fxMissingRows: 3, fxMissingMonths: ["2026-10-01"] }),
  ]);
  const cm3 = cell(r, "bravo", "cm3");
  check("fx bucket nulled, never a partial SUM", cm3.points?.[3] === null);
  check("unaffected bucket kept", close(cm3.points?.[0], 601000 - 180300 - 115600));
  check("cell fx_missing with reason and months", cm3.status === "fx_missing" && cm3.reason === "No FX Oct 2026" && eqJson(cm3.fxMonths, ["2026-10-01"]) && cm3.total === null && cm3.delta === null);
  check("native ratio untouched by FX", cell(r, "bravo", "mer").status === "ok" && close(cell(r, "bravo", "mer").points?.[3], 5));
  check("fx warning", r.warnings.some((x) => x.code === "fx_missing" && eqJson(x.months, ["2026-10-01"])));
  check("no comparison: no comparePoints", cm3.comparePoints === undefined && r.comparison === null);

  // Same currency as display and no foreign rows: native is exact, no rate needed.
  const wUsd = widget(["revenue"], { grain: "week", filters: { clients: { mode: "list", ids: ["bravo"] }, currency: "USD", compare: "none" } });
  const rUsd = evalW(wUsd, [row("bravo", "cur", "2026-09-28", { "kpis.revenue": [20000, null] }, { fxMissingRows: 3, fxMissingMonths: ["2026-10-01"] })]);
  check("same currency needs no FX", cell(rUsd, "bravo", "revenue").status === "ok" && close(cell(rUsd, "bravo", "revenue").total, 20000));

  // Rollup: a client without FX is left out of the combined bucket and total (gap rule 2026-10-04), never a partial sum of its rows.
  const wc = widget(["mer"], { split: "combined", grain: "week", filters: { clients: { mode: "list", ids: ["alpha", "bravo"] }, compare: "none" } });
  const rcmb = evalW(wc, [
    row("alpha", "cur", "2026-09-28", { "kpis.revenue": 1000, "kpis.paid_spend": 500 }),
    row("alpha", "cur", "2026-09-07", { "kpis.revenue": 1000, "kpis.paid_spend": 500 }),
    row("bravo", "cur", "2026-09-28", { "kpis.revenue": [100, 2310], "kpis.paid_spend": [50, 1155] }, { fxMissingRows: 1, fxMissingMonths: ["2026-10-01"] }),
  ]);
  const cm = cell(rcmb, "combined", "mer");
  check("combined ratio leaves the fx_missing client out", cm.status === "ok" && close(cm.total, 2) && eqJson(cm.coverage, { included: 1, of: 2 }));
  check("combined excluded lists the client with its FX reason", eqJson(cm.excluded, [{ id: "bravo", name: bravo.name, reason: "No FX Oct 2026" }]));
  check("combined fx bucket computed from the rest, other bucket kept", close(cm.points?.[3], 2) && close(cm.points?.[0], 2) && eqJson(cm.pointCoverage, [2, 2, 2, 1]));
  check("combined fx exclusion still warns", rcmb.warnings.some((x) => x.code === "fx_missing" && eqJson(x.months, ["2026-10-01"])));
  const onlyFx = evalW(widget(["mer"], { split: "combined", filters: { clients: { mode: "list", ids: ["bravo"] }, compare: "none" } }), [
    row("bravo", "cur", "1970-01-01", { "kpis.revenue": [100, 2310], "kpis.paid_spend": [50, 1155] }, { fxMissingRows: 1, fxMissingMonths: ["2026-10-01"] }),
  ]);
  check("combined with every client fx_missing is fx_missing", cell(onlyFx, "combined", "mer").status === "fx_missing" && cell(onlyFx, "combined", "mer").reason === "No FX Oct 2026" && eqJson(cell(onlyFx, "combined", "mer").coverage, { included: 0, of: 1 }));
}

// 4.4 COGS zero and NULL guard.
{
  const w = widget(["cm3", "cogs", "cm1_pct", "revenue"], { filters: { clients: { mode: "list", ids: ["charlie"] }, compare: "none" } });
  const zero = evalW(w, [row("charlie", "cur", "1970-01-01", { "kpis.revenue": 194000, "kpis.cogs": 0, "kpis.paid_spend": 20000, "kpis.fulfillment_cost": 0 })]);
  check("COGS 0 on positive revenue: not_measured", cell(zero, "charlie", "cm3").status === "not_measured" && cell(zero, "charlie", "cm3").reason === "No cost data" && cell(zero, "charlie", "cm3").total === null);
  check("COGS metric itself not measured", cell(zero, "charlie", "cogs").status === "not_measured");
  check("CM1 % not measured", cell(zero, "charlie", "cm1_pct").status === "not_measured");
  check("revenue unaffected by the guard", cell(zero, "charlie", "revenue").status === "ok");
  const nul = evalW(w, [row("charlie", "cur", "1970-01-01", { "kpis.revenue": 194000, "kpis.cogs": null, "kpis.paid_spend": 20000, "kpis.fulfillment_cost": 0 })]);
  check("Woo NULL COGS on positive revenue: not_measured, not no_data", cell(nul, "charlie", "cm3").status === "not_measured");
  const noRev = evalW(w, [row("charlie", "cur", "1970-01-01", { "kpis.revenue": 0, "kpis.cogs": 0, "kpis.paid_spend": 0, "kpis.fulfillment_cost": 0 })]);
  check("COGS 0 on zero revenue is a real 0", cell(noRev, "charlie", "cm3").status === "ok" && cell(noRev, "charlie", "cm3").total === 0);

  // Strict totals: one uncosted week makes the total not measured; costed weeks keep their points.
  const wk = widget(["cm3"], { grain: "week", filters: { clients: { mode: "list", ids: ["alpha"] }, compare: "none" } });
  const part = evalW(wk, [
    row("alpha", "cur", "2026-09-07", { "kpis.revenue": 1000, "kpis.cogs": 300, "kpis.paid_spend": 100, "kpis.fulfillment_cost": 50 }),
    row("alpha", "cur", "2026-09-14", { "kpis.revenue": 1000, "kpis.cogs": 0, "kpis.paid_spend": 100, "kpis.fulfillment_cost": 0 }),
  ]);
  const pc = cell(part, "alpha", "cm3");
  check("costed bucket value includes fulfilment", close(pc.points?.[0], 1000 - 300 - 50 - 100));
  check("uncosted bucket null", pc.points?.[1] === null);
  check("total not measured, never partial", pc.status === "not_measured" && pc.total === null);

  // CM3 mart definition: fulfilment and paid spend count as 0 when null.
  const nulls = evalW(wk, [row("alpha", "cur", "2026-09-07", { "kpis.revenue": 1000, "kpis.cogs": 300, "kpis.paid_spend": null, "kpis.fulfillment_cost": null })]);
  check("null paid and fulfilment count as 0", close(cell(nulls, "alpha", "cm3").total, 700));

  // Rollup: a client with no cost data is left out of the combined cell.
  const wcmb = widget(["cm3_pct"], { split: "combined", filters: { clients: { mode: "list", ids: ["alpha", "charlie"] }, compare: "none" } });
  const rcmb = evalW(wcmb, [
    row("alpha", "cur", "1970-01-01", { "kpis.revenue": 1000, "kpis.cogs": 300, "kpis.paid_spend": 100, "kpis.fulfillment_cost": 0 }),
    row("charlie", "cur", "1970-01-01", { "kpis.revenue": 500, "kpis.cogs": null, "kpis.paid_spend": 50, "kpis.fulfillment_cost": 0 }),
  ]);
  const cnm = cell(rcmb, "combined", "cm3_pct");
  check("combined leaves the not measured client out", cnm.status === "ok" && close(cnm.total, 0.6) && eqJson(cnm.coverage, { included: 1, of: 2 }) && eqJson(cnm.excluded, [{ id: "charlie", name: charlie.name, reason: "No cost data" }]));
}

// 4.5 not_connected exclusion and coverage.
{
  const w = widget(["meta_roas", "mer"], { split: "combined", filters: { clients: { mode: "list", ids: ["alpha", "charlie"] }, compare: "none" } });
  const r = evalW(w, [
    row("alpha", "cur", "1970-01-01", { "kpis.meta_revenue": 240, "kpis.meta_spend": 100, "kpis.revenue": 1000, "kpis.paid_spend": 200 }),
    row("charlie", "cur", "1970-01-01", { "kpis.meta_revenue": null, "kpis.meta_spend": null, "kpis.revenue": 500, "kpis.paid_spend": 50 }),
  ]);
  const c = cell(r, "combined", "meta_roas");
  check("rollup excludes not_connected client", c.status === "ok" && close(c.total, 2.4) && eqJson(c.coverage, { included: 1, of: 2 }));
  check("rollup lists the not_connected client with its reason", eqJson(c.excluded, [{ id: "charlie", name: charlie.name, reason: "Meta not connected" }]));
  check("rollup with everybody included has no excluded list", cell(r, "combined", "mer").excluded === undefined);
  check("rollup MER includes both", close(cell(r, "combined", "mer").total, 1500 / 250) && eqJson(cell(r, "combined", "mer").coverage, { included: 2, of: 2 }));

  const wc = widget(["meta_roas"], { grain: "week", filters: { clients: { mode: "list", ids: ["charlie"] } } });
  const rc2 = evalW(wc, []);
  const nc = cell(rc2, "charlie", "meta_roas");
  check("client not_connected", nc.status === "not_connected" && nc.reason === "Meta not connected" && eqJson(nc.missing, ["meta"]));
  check("not_connected has no points", nc.points === undefined && nc.comparePoints === undefined && nc.total === null);

  const wn = widget(["meta_roas"], { split: "combined", filters: { clients: { mode: "list", ids: ["charlie"] } } });
  const rn = evalW(wn, []);
  check("rollup with nobody connected", cell(rn, "combined", "meta_roas").status === "not_connected" && eqJson(cell(rn, "combined", "meta_roas").coverage, { included: 0, of: 1 }));
}

// 4.6 Status precedence and no_data.
{
  // fx_missing beats not_measured: bravo, CZK display, Oct without rate AND COGS 0.
  const w = widget(["cm3"], { filters: { clients: { mode: "list", ids: ["bravo"] }, compare: "none" } });
  const r = evalW(w, [row("bravo", "cur", "1970-01-01", { "kpis.revenue": [100, 2310], "kpis.cogs": [0, 0], "kpis.paid_spend": [10, 231] }, { fxMissingRows: 1, fxMissingMonths: ["2026-10-01"] })]);
  check("fx_missing > not_measured", cell(r, "bravo", "cm3").status === "fx_missing");
  // not_connected beats fx_missing.
  const w2 = widget(["meta_roas"], { split: "combined", filters: { clients: { mode: "list", ids: ["charlie"] } } });
  check("not_connected > everything", cell(evalW(w2, [row("charlie", "cur", "1970-01-01", {}, { fxMissingRows: 1, fxMissingMonths: ["2026-10-01"] })]), "combined", "meta_roas").status === "not_connected");
  // no_data: capability present, no rows. Never 0.
  const w3 = widget(["mer", "orders"], { grain: "week", filters: { clients: { mode: "list", ids: ["delta"] } } });
  const r3 = evalW(w3, []);
  const nd = cell(r3, "delta", "orders");
  check("no rows is no_data, null not 0", nd.status === "no_data" && nd.reason === "No data" && nd.total === null && nd.points?.every((p) => p === null) === true);
  // Zero denominator: no value.
  const w4 = widget(["mer"], { filters: { clients: { mode: "list", ids: ["alpha"] } } });
  check("zero denominator is no_data", cell(evalW(w4, [row("alpha", "cur", "1970-01-01", { "kpis.revenue": 100, "kpis.paid_spend": 0 })]), "alpha", "mer").status === "no_data");
}

// 4.7 Deltas: pp for percent units, relative otherwise, null on a zero baseline.
{
  const w = widget(["returning_order_share", "mer", "orders"], { filters: { clients: { mode: "list", ids: ["alpha"] } } });
  const r = evalW(w, [
    row("alpha", "cur", "1970-01-01", { "kpis.returning_customer_orders": 30, "kpis.orders": 100, "kpis.revenue": 330, "kpis.paid_spend": 100 }),
    row("alpha", "cmp", "1970-01-01", { "kpis.returning_customer_orders": 25, "kpis.orders": 100, "kpis.revenue": 300, "kpis.paid_spend": 100 }),
  ]);
  const share = cell(r, "alpha", "returning_order_share");
  check("percent delta is pp", share.deltaKind === "pp" && close(share.delta, 0.05) && close(share.compareTotal, 0.25));
  const mer = cell(r, "alpha", "mer");
  check("ratio delta is relative", mer.deltaKind === "relative" && close(mer.delta, 0.1));
  check("zero baseline delta is null", (() => {
    const r0 = evalW(w, [row("alpha", "cur", "1970-01-01", { "kpis.orders": 10 }), row("alpha", "cmp", "1970-01-01", { "kpis.orders": 0 })]);
    const c = cell(r0, "alpha", "orders");
    return c.compareTotal === 0 && c.delta === null && c.status === "ok";
  })());
  check("total grain has no points", share.points === undefined && share.comparePoints === undefined && r.buckets.length === 0);
}

// 4.8 Comparison buckets align by position.
{
  const w = widget(["orders"], { grain: "week", filters: { clients: { mode: "list", ids: ["alpha"] }, period: { kind: "custom", from: "2026-09-07", to: "2026-09-20" } } });
  // previous period: 2026-08-24..2026-09-06 (weeks 08-24, 08-31)
  const r = evalW(w, [
    row("alpha", "cur", "2026-09-07", { "kpis.orders": 10 }),
    row("alpha", "cur", "2026-09-14", { "kpis.orders": 12 }),
    row("alpha", "cmp", "2026-08-24", { "kpis.orders": 8 }),
    row("alpha", "cmp", "2026-08-31", { "kpis.orders": 9 }),
  ]);
  const c = cell(r, "alpha", "orders");
  check("comparePoints by position", eqJson(c.comparePoints, [8, 9]) && eqJson(c.points, [10, 12]));
  check("comparison totals", c.total === 22 && c.compareTotal === 17 && close(c.delta, 5 / 17));
}

// 4.9 Low volume, foreign rows caveat, vertical split.
{
  const w = widget(["mer"], { filters: { clients: { mode: "list", ids: ["alpha", "bravo"] } } });
  const r = evalW(w, [
    row("alpha", "cur", "1970-01-01", { "kpis.revenue": 300000, "kpis.paid_spend": 100000 }),
    row("bravo", "cur", "1970-01-01", { "kpis.revenue": [400, 9240], "kpis.paid_spend": [50, 1155] }, { foreignCcyRows: 1 }),
  ]);
  check("low volume below 2% of max spend", cell(r, "bravo", "mer").lowVolume === true && cell(r, "alpha", "mer").lowVolume === undefined);
  check("foreign rows caveat", r.series.find((s) => s.id === "bravo")!.caveats.includes("foreign_currency_rows") && !r.series.find((s) => s.id === "alpha")!.caveats.includes("foreign_currency_rows"));

  const wv = widget(["orders"], { split: "vertical" });
  const rv = evalW(wv, [row("alpha", "cur", "1970-01-01", { "kpis.orders": 5 }), row("bravo", "cur", "1970-01-01", { "kpis.orders": 7 }), row("charlie", "cur", "1970-01-01", { "kpis.orders": 2 })]);
  check("vertical series order, unassigned last", eqJson(rv.series.map((s) => s.id), [verticalSeriesId("vertical_a"), verticalSeriesId("vertical_b"), verticalSeriesId("unassigned")]));
  check("vertical rollup sums", cell(rv, verticalSeriesId("vertical_a"), "orders").total === 12 && eqJson(rv.series[0].clientIds, ["alpha", "bravo"]));
  check("vertical with no rows is no_data", cell(rv, verticalSeriesId("unassigned"), "orders").status === "no_data");
}

// 4.10 RS0 contract fixtures (FIXTURE_RESOLVED + FIXTURE_ROWS) evaluate to the statuses fixtures.ts describes.
{
  const r = evalW(FIXTURE_RESOLVED, [...FIXTURE_ROWS]);
  check("rs0 alpha week 1 MER 3.1", close(cell(r, "alpha", "mer").points?.[0], 3.1));
  check("rs0 alpha week 1 CM3 182000", close(cell(r, "alpha", "cm3").points?.[0], 182000));
  check("rs0 alpha week 1 Meta ROAS 2.4", close(cell(r, "alpha", "meta_roas").points?.[0], 2.4));
  check("rs0 bravo CM3 fx_missing Oct", cell(r, "bravo", "cm3").status === "fx_missing" && cell(r, "bravo", "cm3").points?.[3] === null && cell(r, "bravo", "cm3").reason === "No FX Oct 2026");
  check("rs0 bravo MER native ok", cell(r, "bravo", "mer").status === "ok");
  check("rs0 bravo foreign rows caveat", r.series.find((s) => s.id === "bravo")!.caveats.includes("foreign_currency_rows"));
  check("rs0 charlie CM3 not measured", cell(r, "charlie", "cm3").status === "not_measured");
  check("rs0 charlie Meta ROAS not connected", cell(r, "charlie", "meta_roas").status === "not_connected");
  check("rs0 delta no data everywhere", (["mer", "cm3", "meta_roas"] as MetricId[]).every((m) => cell(r, "delta", m).status === "no_data"));
  check("rs0 partial last week", eqJson(r.partialBuckets, [3]) && eqJson(r.buckets, ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]));
}

// 4.11 Result envelope.
{
  const w = widget(["revenue"], { filters: { clients: { mode: "list", ids: ["alpha"] } } });
  const r = evalW(w, []);
  check("envelope", r.key === "k" && r.currency === "CZK" && r.grain === "total" && eqJson(r.current, w.period.current) && r.benchmarks.length === 0);
  check("client series uses registry slot and name", r.series[0].label === "Alpha" && r.series[0].slot === alpha.slot && r.series[0].clientIds === undefined);
  void delta;
}

// 4.12 F1: NULL rows inside a sum are a gap, never a partial sum ("no data is not zero").
{
  const TOTAL = "1970-01-01";
  const wkMer = widget(["mer"], { grain: "week", filters: { clients: { mode: "list", ids: ["alpha"] }, compare: "none" } });
  // The review case: two days, spend [100, NULL], revenue [1000, 1000]. The old partial sum gave MER 20.
  const gapWeek = evalW(wkMer, [row("alpha", "cur", "2026-09-07", { "kpis.revenue": 2000, "kpis.paid_spend": withNulls(100, 1) })]);
  const g = cell(gapWeek, "alpha", "mer");
  check("F1: week with a NULL-spend day is a gap, not 20", g.points?.[0] === null && g.total === null && g.status === "no_data" && g.reason === "Missing days");
  const fullWeek = evalW(wkMer, [row("alpha", "cur", "2026-09-07", { "kpis.revenue": 2000, "kpis.paid_spend": withNulls(200, 0) })]);
  check("F1: the same week with both days valued keeps its value", close(cell(fullWeek, "alpha", "mer").points?.[0], 10) && cell(fullWeek, "alpha", "mer").status === "ok");

  // Total grain and a gap in one bucket: points keep their valued weeks, the total is a gap, never the sum of the valued weeks.
  const mixed = evalW(wkMer, [
    row("alpha", "cur", "2026-09-07", { "kpis.revenue": 1000, "kpis.paid_spend": withNulls(100, 0) }),
    row("alpha", "cur", "2026-09-14", { "kpis.revenue": 1000, "kpis.paid_spend": withNulls(100, 2) }),
  ]);
  const m = cell(mixed, "alpha", "mer");
  check("F1: valued week keeps its value, gap week is null", close(m.points?.[0], 10) && m.points?.[1] === null);
  check("F1: total over a gap week is a gap", m.total === null && m.status === "no_data" && m.reason === "Missing days");
  const wkTotal = widget(["mer", "paid_spend", "cac"], { grain: "total", filters: { clients: { mode: "list", ids: ["alpha"] }, compare: "none" } });
  const tot = evalW(wkTotal, [row("alpha", "cur", TOTAL, { "kpis.revenue": 2000, "kpis.paid_spend": withNulls(100, 19), "kpis.new_customer_orders": 10 })]);
  check("F1: total grain: MER, spend and CAC are all gaps", ["mer", "paid_spend", "cac"].every((id) => cell(tot, "alpha", id as MetricId).status === "no_data" && cell(tot, "alpha", id as MetricId).total === null));
  check("F1: gap in spend does not null a metric without spend", (() => {
    const w = widget(["revenue", "orders"], { grain: "total", filters: { clients: { mode: "list", ids: ["alpha"] }, compare: "none" } });
    const r = evalW(w, [row("alpha", "cur", TOTAL, { "kpis.revenue": 2000, "kpis.orders": 7, "kpis.paid_spend": withNulls(100, 19) })]);
    return cell(r, "alpha", "revenue").status === "ok" && close(cell(r, "alpha", "orders").total, 7);
  })());
  check("F1: a gap on the comparison period only leaves the current cell valued, without a delta", (() => {
    const w = widget(["mer"], { grain: "total", filters: { clients: { mode: "list", ids: ["alpha"] }, compare: "previous_period" } });
    const r = evalW(w, [
      row("alpha", "cur", TOTAL, { "kpis.revenue": 1000, "kpis.paid_spend": withNulls(100, 0) }),
      row("alpha", "cmp", TOTAL, { "kpis.revenue": 1000, "kpis.paid_spend": withNulls(50, 3) }),
    ]);
    const c = cell(r, "alpha", "mer");
    return c.status === "ok" && close(c.total, 10) && c.compareTotal === null && c.delta === null;
  })());

  // Rollups: a client with a gap is left out (owner rule 2026-10-04), the rest are summed, coverage and excluded say so.
  const wCmb = widget(["mer"], { split: "combined", filters: { clients: { mode: "list", ids: ["alpha", "bravo", "charlie"] }, compare: "none" } });
  const cmbGap = evalW(wCmb, [
    row("alpha", "cur", TOTAL, { "kpis.revenue": 1000, "kpis.paid_spend": withNulls(100, 4) }),
    row("bravo", "cur", TOTAL, { "kpis.revenue": [100, 2300], "kpis.paid_spend": [10, 230] }),
    row("charlie", "cur", TOTAL, { "kpis.revenue": 500, "kpis.paid_spend": 50 }),
  ]);
  const cg = cell(cmbGap, "combined", "mer");
  check("Gap rule: combined MER leaves the gap client out", cg.status === "ok" && close(cg.total, (2300 + 500) / (230 + 50)) && eqJson(cg.coverage, { included: 2, of: 3 }));
  check("Gap rule: excluded client named with Missing days", eqJson(cg.excluded, [{ id: "alpha", name: alpha.name, reason: "Missing days" }]));
  const bigGap = evalW(wCmb, [
    row("alpha", "cur", TOTAL, { "kpis.revenue": 9000, "kpis.paid_spend": withNulls(100, 4) }),
    row("bravo", "cur", TOTAL, { "kpis.revenue": [100, 2300], "kpis.paid_spend": [10, 230] }),
    row("charlie", "cur", TOTAL, { "kpis.revenue": 500, "kpis.paid_spend": 50 }),
  ]);
  check("Gap rule: the excluded client's revenue is not summed either (no partial ratio)", close(cell(bigGap, "combined", "mer").total, 2800 / 280));
  const allGap = evalW(wCmb, [
    row("alpha", "cur", TOTAL, { "kpis.revenue": 1000, "kpis.paid_spend": withNulls(100, 4) }),
    row("bravo", "cur", TOTAL, { "kpis.revenue": [100, 2300], "kpis.paid_spend": { nat: 10, disp: 230, natNulls: 1, dispNulls: 1 } }),
    row("charlie", "cur", TOTAL, { "kpis.revenue": 500, "kpis.paid_spend": withNulls(50, 2) }),
  ]);
  const ag = cell(allGap, "combined", "mer");
  check("Gap rule: no client left is a gap with Missing days", ag.status === "no_data" && ag.total === null && ag.reason === "Missing days" && eqJson(ag.coverage, { included: 0, of: 3 }) && ag.excluded?.length === 3);
  const mixedOut = evalW(widget(["cm3_pct"], { split: "combined", filters: { clients: { mode: "list", ids: ["bravo", "charlie"] }, compare: "none" } }), [
    row("bravo", "cur", TOTAL, { "kpis.revenue": [100, 2300], "kpis.cogs": [30, 690], "kpis.paid_spend": [10, 230], "kpis.fulfillment_cost": [0, 0] }, { fxMissingRows: 1, fxMissingMonths: ["2026-10-01"] }),
    row("charlie", "cur", TOTAL, { "kpis.revenue": 500, "kpis.cogs": null, "kpis.paid_spend": 50, "kpis.fulfillment_cost": 0 }),
  ]);
  check("Gap rule: mixed reasons with nobody left is no_data", cell(mixedOut, "combined", "cm3_pct").status === "no_data" && cell(mixedOut, "combined", "cm3_pct").reason === "No data");

  // Comparison like for like: the comparison sums exactly the clients of the current total.
  const wCmp = widget(["mer"], { split: "combined", filters: { clients: { mode: "list", ids: ["alpha", "charlie"] }, compare: "previous_period" } });
  const cmpSame = evalW(wCmp, [
    row("alpha", "cur", TOTAL, { "kpis.revenue": 1000, "kpis.paid_spend": withNulls(100, 1) }),
    row("charlie", "cur", TOTAL, { "kpis.revenue": 500, "kpis.paid_spend": withNulls(50, 0) }),
    row("alpha", "cmp", TOTAL, { "kpis.revenue": 9000, "kpis.paid_spend": withNulls(100, 0) }),
    row("charlie", "cmp", TOTAL, { "kpis.revenue": 400, "kpis.paid_spend": withNulls(50, 0) }),
  ]);
  const cs = cell(cmpSame, "combined", "mer");
  check("Gap rule: comparison over the same client set as the current total", close(cs.total, 10) && close(cs.compareTotal, 8) && close(cs.delta, 0.25));
  const cmpDiff = evalW(wCmp, [
    row("alpha", "cur", TOTAL, { "kpis.revenue": 1000, "kpis.paid_spend": withNulls(100, 0) }),
    row("charlie", "cur", TOTAL, { "kpis.revenue": 500, "kpis.paid_spend": withNulls(50, 0) }),
    row("alpha", "cmp", TOTAL, { "kpis.revenue": 900, "kpis.paid_spend": withNulls(100, 2) }),
    row("charlie", "cmp", TOTAL, { "kpis.revenue": 400, "kpis.paid_spend": withNulls(50, 0) }),
  ]);
  const cd = cell(cmpDiff, "combined", "mer");
  check("Gap rule: a client left out only in the comparison: value kept, comparison and delta n/a", cd.status === "ok" && close(cd.total, 10) && cd.compareTotal === null && cd.delta === null && eqJson(cd.coverage, { included: 2, of: 2 }));

  // Buckets: each point leaves out its own gap clients; comparison points are like for like too.
  const wWk = widget(["mer"], { split: "combined", grain: "week", filters: { clients: { mode: "list", ids: ["alpha", "charlie"] }, period: { kind: "custom", from: "2026-09-07", to: "2026-09-20" }, compare: "previous_period" } });
  const wk = evalW(wWk, [
    row("alpha", "cur", "2026-09-07", { "kpis.revenue": 1000, "kpis.paid_spend": withNulls(100, 0) }),
    row("alpha", "cur", "2026-09-14", { "kpis.revenue": 1000, "kpis.paid_spend": withNulls(100, 1) }),
    row("charlie", "cur", "2026-09-07", { "kpis.revenue": 500, "kpis.paid_spend": withNulls(100, 0) }),
    row("charlie", "cur", "2026-09-14", { "kpis.revenue": 500, "kpis.paid_spend": withNulls(100, 0) }),
    row("alpha", "cmp", "2026-08-24", { "kpis.revenue": 800, "kpis.paid_spend": withNulls(100, 3) }),
    row("alpha", "cmp", "2026-08-31", { "kpis.revenue": 800, "kpis.paid_spend": withNulls(100, 0) }),
    row("charlie", "cmp", "2026-08-24", { "kpis.revenue": 400, "kpis.paid_spend": withNulls(100, 0) }),
    row("charlie", "cmp", "2026-08-31", { "kpis.revenue": 400, "kpis.paid_spend": withNulls(100, 0) }),
  ]);
  const wc2 = cell(wk, "combined", "mer");
  check("Gap rule: week points leave out the gap client per bucket", close(wc2.points?.[0], 7.5) && close(wc2.points?.[1], 5) && eqJson(wc2.pointCoverage, [2, 1]));
  check("Gap rule: comparison point null when its set differs, like for like otherwise", wc2.comparePoints?.[0] === null && close(wc2.comparePoints?.[1], 4));
  check("Gap rule: week total leaves alpha out (gap in one of its weeks)", close(wc2.total, 5) && eqJson(wc2.coverage, { included: 1, of: 2 }) && close(wc2.compareTotal, 4) && close(wc2.delta, 0.25));

  // Vertical rollups follow the same rule.
  const vr = evalW(widget(["mer"], { split: "vertical", filters: { clients: { mode: "list", ids: ["alpha", "bravo"] }, compare: "none" } }), [
    row("alpha", "cur", TOTAL, { "kpis.revenue": 1000, "kpis.paid_spend": withNulls(100, 3) }),
    row("bravo", "cur", TOTAL, { "kpis.revenue": [100, 2300], "kpis.paid_spend": [10, 230] }),
  ]);
  const vc = cell(vr, verticalSeriesId("vertical_a"), "mer");
  check("Gap rule: vertical rollup leaves the gap client out", vc.status === "ok" && close(vc.total, 10) && eqJson(vc.coverage, { included: 1, of: 2 }) && vc.excluded?.[0]?.id === "alpha");
  const cmbOk = evalW(wCmb, [
    row("alpha", "cur", TOTAL, { "kpis.revenue": 1000, "kpis.paid_spend": withNulls(100, 0) }),
    row("bravo", "cur", TOTAL, { "kpis.revenue": [100, 2300], "kpis.paid_spend": [10, 230] }),
    row("charlie", "cur", TOTAL, { "kpis.revenue": 500, "kpis.paid_spend": 50 }),
  ]);
  check("F1: combined MER with no gaps is unchanged", close(cell(cmbOk, "combined", "mer").total, (1000 + 2300 + 500) / (100 + 230 + 50)));
  const split = evalW(widget(["mer"], { split: "client", filters: { clients: { mode: "list", ids: ["alpha", "charlie"] }, compare: "none" } }), [
    row("alpha", "cur", TOTAL, { "kpis.revenue": 1000, "kpis.paid_spend": withNulls(100, 4) }),
    row("charlie", "cur", TOTAL, { "kpis.revenue": 500, "kpis.paid_spend": 50 }),
  ]);
  check("F1: per-client split: only the client with the gap is null", cell(split, "alpha", "mer").status === "no_data" && close(cell(split, "charlie", "mer").total, 10));

  // Day grain stays consistent with week and total.
  const wDay = widget(["mer"], { grain: "day", filters: { clients: { mode: "list", ids: ["alpha"] }, compare: "none" } });
  const day = evalW(wDay, [
    row("alpha", "cur", "2026-09-07", { "kpis.revenue": 1000, "kpis.paid_spend": withNulls(null, 1) }),
    row("alpha", "cur", "2026-09-08", { "kpis.revenue": 1000, "kpis.paid_spend": withNulls(100, 0) }),
  ]);
  check("F1: day grain: NULL-spend day null, next day valued", cell(day, "alpha", "mer").points?.[0] === null && close(cell(day, "alpha", "mer").points?.[1], 10));

  // Native vs display variants: native-per-client ratios read the native count, money metrics in a display currency read the display count.
  const wNative = widget(["mer", "paid_spend"], { grain: "total", filters: { clients: { mode: "list", ids: ["charlie"] }, compare: "none" } });
  const sums: ComponentSum = { nat: 100, disp: 100, natNulls: 0, dispNulls: 2 };
  const nat = evalW(wNative, [row("charlie", "cur", TOTAL, { "kpis.revenue": 1000, "kpis.paid_spend": sums })]);
  check("F1: same-currency client: MER (native) and spend (display, no foreign rows) follow their own count", close(cell(nat, "charlie", "mer").total, 10) && close(cell(nat, "charlie", "paid_spend").total, 100));
  const wNatBravo = widget(["mer", "paid_spend"], { grain: "total", filters: { clients: { mode: "list", ids: ["bravo"] }, compare: "none" } });
  const bv = evalW(wNatBravo, [row("bravo", "cur", TOTAL, { "kpis.revenue": [1000, 23000], "kpis.paid_spend": { nat: 100, disp: 2300, natNulls: 0, dispNulls: 2 } })]);
  check("F1: cross-currency: native MER ignores a display-only count, display spend is a gap", close(cell(bv, "bravo", "mer").total, 10) && cell(bv, "bravo", "paid_spend").status === "no_data");
  const bv2 = evalW(wNatBravo, [row("bravo", "cur", TOTAL, { "kpis.revenue": [1000, 23000], "kpis.paid_spend": { nat: 100, disp: 2300, natNulls: 2, dispNulls: 0 } })]);
  check("F1: cross-currency: native count nulls native MER, not display spend", cell(bv2, "bravo", "mer").status === "no_data" && close(cell(bv2, "bravo", "paid_spend").total, 2300));

  // Components that are NULL by meaning do not make a gap.
  const shopZero = evalW(wkMer, [row("alpha", "cur", "2026-09-07", { "kpis.revenue": withNulls(2000, 3), "kpis.paid_spend": withNulls(200, 0), "kpis.orders": withNulls(8, 3) })]);
  check("F1: shop columns NULL on no-order days (nullMeans zero) keep MER", close(cell(shopZero, "alpha", "mer").points?.[0], 10));
  check("F1: registry nullMeans: shop zero, ad platform gap, cogs gap", COMPONENTS["kpis.revenue"].nullMeans === "zero" && COMPONENTS["kpis.orders"].nullMeans === "zero" && COMPONENTS["kpis.paid_spend"].nullMeans === "gap" && COMPONENTS["kpis.meta_spend"].nullMeans === "gap" && COMPONENTS["kpis.cogs"].nullMeans === "gap");
  check("Gap rule: spend components count their own NULLs", (["kpis.paid_spend", "kpis.meta_spend", "kpis.google_spend"] as const).every((id) => COMPONENTS[id].missingWhenNull === undefined));
  check("Gap rule: ad outcomes are gaps only on days without their platform's spend", (["revenue", "purchases", "impressions", "clicks"] as const).every((c) => COMPONENTS[`kpis.meta_${c}`].missingWhenNull === "kpis.meta_spend" && COMPONENTS[`kpis.google_${c}`].missingWhenNull === "kpis.google_spend"));
  check("Gap rule: only ad outcomes use missingWhenNull (8 KPI view, 7 Meta campaign, 4 Meta ad)", Object.values(COMPONENTS).filter((c) => c.missingWhenNull !== undefined).length === 19);
  // Ethia/venev Sep 2026: meta_revenue NULL on days with Meta spend. The SQL counts only NULL-spend days for it (0 here), so Meta ROAS is a value.
  const ethiaLike = evalW(widget(["meta_roas", "meta_cpa"], { grain: "total", filters: { clients: { mode: "list", ids: ["alpha"] }, compare: "none" } }), [
    row("alpha", "cur", TOTAL, { "kpis.meta_revenue": withNulls(2440, 0), "kpis.meta_spend": withNulls(1000, 0), "kpis.meta_purchases": withNulls(10, 0) }),
  ]);
  check("Gap rule: Meta ROAS with zero-conversion days is a value", close(cell(ethiaLike, "alpha", "meta_roas").total, 2.44) && close(cell(ethiaLike, "alpha", "meta_cpa").total, 100));
  check("F1: every component declares nullMeans", Object.values(COMPONENTS).every((c) => c.nullMeans === "gap" || c.nullMeans === "zero"));

  // Google-only client (RawBark): Meta columns are NULL on every day and must not null MER, spend or CM3 inputs; Meta-only metrics stay not_connected.
  const wRaw = widget(["mer", "paid_spend", "meta_roas", "revenue"], { grain: "total", filters: { clients: { mode: "list", ids: ["charlie"] }, compare: "none" } });
  const raw = evalW(wRaw, [row("charlie", "cur", TOTAL, { "kpis.revenue": 1000, "kpis.paid_spend": withNulls(100, 0), "kpis.meta_spend": withNulls(null, 30), "kpis.meta_revenue": withNulls(null, 30) })]);
  check("F1: Google-only client keeps MER and spend with Meta columns NULL", close(cell(raw, "charlie", "mer").total, 10) && close(cell(raw, "charlie", "paid_spend").total, 100));
  check("F1: Meta ROAS stays not_connected for it", cell(raw, "charlie", "meta_roas").status === "not_connected");
  // A client with Meta connected and Meta NULL days: Meta-only metrics are gaps, MER is not.
  const wMeta = widget(["mer", "meta_roas"], { grain: "total", filters: { clients: { mode: "list", ids: ["alpha"] }, compare: "none" } });
  const mt = evalW(wMeta, [row("alpha", "cur", TOTAL, { "kpis.revenue": 1000, "kpis.paid_spend": withNulls(100, 0), "kpis.meta_revenue": withNulls(300, 5), "kpis.meta_spend": withNulls(60, 5) })]);
  check("F1: Meta NULL days gap Meta ROAS only", cell(mt, "alpha", "meta_roas").status === "no_data" && cell(mt, "alpha", "meta_roas").reason === "Missing days" && close(cell(mt, "alpha", "mer").total, 10));

  // CM3: fulfilment and paid spend are nullAs zero (mart definition), so NULL rows in them do not make a gap; revenue and COGS still do.
  const wCm3 = widget(["cm3"], { grain: "total", filters: { clients: { mode: "list", ids: ["alpha"] }, compare: "none" } });
  const cm3 = evalW(wCm3, [row("alpha", "cur", TOTAL, { "kpis.revenue": 1000, "kpis.cogs": withNulls(300, 0), "kpis.paid_spend": withNulls(100, 5), "kpis.fulfillment_cost": withNulls(null, 5) })]);
  check("F1: CM3 keeps nullAs zero for paid spend and fulfilment (documented residual)", close(cell(cm3, "alpha", "cm3").total, 600));

  // COGS: a NULL on a day with revenue inside a sum is not measured (counted in SQL only where revenue > 0), at bucket and total level.
  const wCogs = widget(["cogs", "cm1_pct", "cm3"], { grain: "week", filters: { clients: { mode: "list", ids: ["alpha"] }, compare: "none" } });
  const cg2 = evalW(wCogs, [
    row("alpha", "cur", "2026-09-07", { "kpis.revenue": 1000, "kpis.cogs": withNulls(300, 0), "kpis.paid_spend": 100 }),
    row("alpha", "cur", "2026-09-14", { "kpis.revenue": 1000, "kpis.cogs": withNulls(300, 2), "kpis.paid_spend": 100 }),
  ]);
  check("F1: partly costed week is not measured, costed week keeps its value", cell(cg2, "alpha", "cogs").points?.[0] === 300 && cell(cg2, "alpha", "cogs").points?.[1] === null);
  check("F1: partly costed week makes the total not measured", ["cogs", "cm1_pct", "cm3"].every((id) => cell(cg2, "alpha", id as MetricId).status === "not_measured" && cell(cg2, "alpha", id as MetricId).reason === "No cost data"));
  const cogsQuiet = evalW(wCogs, [row("alpha", "cur", "2026-09-07", { "kpis.revenue": 1000, "kpis.cogs": withNulls(300, 0), "kpis.paid_spend": 100 })]);
  check("F1: fully costed week unaffected", cell(cogsQuiet, "alpha", "cogs").points?.[0] === 300 && close(cell(cogsQuiet, "alpha", "cm1_pct").points?.[0], 0.7));
  const cmbCogs = evalW(widget(["cm3_pct"], { split: "combined", filters: { clients: { mode: "list", ids: ["alpha", "bravo"] }, compare: "none" } }), [
    row("alpha", "cur", TOTAL, { "kpis.revenue": 1000, "kpis.cogs": withNulls(300, 0), "kpis.paid_spend": 100, "kpis.fulfillment_cost": 0 }),
    row("bravo", "cur", TOTAL, { "kpis.revenue": [100, 2300], "kpis.cogs": { nat: 30, disp: 690, natNulls: 1, dispNulls: 1 }, "kpis.paid_spend": [10, 230], "kpis.fulfillment_cost": [0, 0] }),
  ]);
  check("Gap rule: combined CM3 % leaves the partly costed client out", cell(cmbCogs, "combined", "cm3_pct").status === "ok" && close(cell(cmbCogs, "combined", "cm3_pct").total, 0.6) && cell(cmbCogs, "combined", "cm3_pct").excluded?.[0]?.reason === "No cost data");

  // Old-shape rows (no counts at all, as the fixtures and cached rows from before F1) behave exactly as before.
  const legacy = evalW(wkMer, [row("alpha", "cur", "2026-09-07", { "kpis.revenue": 2000, "kpis.paid_spend": 100 })]);
  check("F1: rows without NULL counts evaluate as before", close(cell(legacy, "alpha", "mer").points?.[0], 20));
  // The status of a gap loses to fx_missing and not_connected.
  check("F1: reason text has no dash", !"Missing days".includes("-"));
}

// 4.13 Meta soft metrics: campaign and ad marts next to the daily KPI view (FX4).
{
  const TOTAL = "1970-01-01";
  const META_SOFT: MetricId[] = [
    "meta_cost_per_lpv", "meta_lpv", "meta_link_ctr", "meta_cpc_link", "meta_add_to_cart", "meta_cost_per_atc", "meta_atc_rate",
    "meta_atc_to_purchase", "meta_initiate_checkout", "meta_cost_per_ic", "meta_hook_rate", "meta_hold_rate", "meta_frequency", "meta_conversion_rate",
  ];
  check("FX4: every Meta soft metric is queryable, in the meta group, requires meta", META_SOFT.every((id) => (METRIC_IDS as readonly string[]).includes(id) && METRICS[id].group === "meta" && METRICS[id].meta.requires === "meta"));
  check("FX4: picker keeps Meta soft metrics in the Meta group", METRIC_LIST.filter((m) => m.group === "meta").length === 21);
  const words = (t: string) => t.trim().split(/\s+/).length;
  check("FX4: descriptions at most 40 words, no dash, tenant-neutral", META_SOFT.every((id) => {
    const d = METRICS[id].description;
    return words(d) <= 40 && ![0x2013, 0x2014].some((cp) => d.includes(String.fromCharCode(cp))) && !/dobias|manami|ethia|venev|rawbark/i.test(d);
  }));
  const f = (id: MetricId) => METRICS[id];
  const termIds = (terms: readonly { c: string }[]) => terms.map((x) => x.c).join();
  const r = (id: MetricId) => f(id) as Extract<(typeof METRICS)[MetricId], { kind: "ratio" }>;
  check("FX4: cost per LPV = spend / LPV", termIds(r("meta_cost_per_lpv").numerator) === "meta_campaign.spend" && termIds(r("meta_cost_per_lpv").denominator) === "meta_campaign.landing_page_views");
  check("FX4: link CTR = link clicks / impressions", termIds(r("meta_link_ctr").numerator) === "meta_campaign.link_clicks" && termIds(r("meta_link_ctr").denominator) === "meta_campaign.impressions");
  check("FX4: ATC rate = ATC / LPV (owner formula, replaces the reserved ATC / link clicks)", termIds(r("meta_atc_rate").numerator) === "meta_campaign.add_to_cart" && termIds(r("meta_atc_rate").denominator) === "meta_campaign.landing_page_views");
  check("FX4: ATC to purchase, conversion rate", termIds(r("meta_atc_to_purchase").numerator) === "meta_campaign.purchases" && termIds(r("meta_atc_to_purchase").denominator) === "meta_campaign.add_to_cart" && termIds(r("meta_conversion_rate").denominator) === "meta_campaign.link_clicks");
  check("QF1: hook = 3-second views (video_views) / video-ad impressions; hold = ThruPlays / video-ad impressions", termIds(r("meta_hook_rate").numerator) === "meta_ad.video_views" && termIds(r("meta_hold_rate").numerator) === "meta_ad.video_thruplays" && termIds(r("meta_hook_rate").denominator) === "meta_ad.video_impressions" && termIds(r("meta_hold_rate").denominator) === "meta_ad.video_impressions");
  check("QF1: video ads decided per ad over the period (plays > 0), numerators and denominator alike", (["meta_ad.video_impressions", "meta_ad.video_views", "meta_ad.video_thruplays"] as const).every((id) => COMPONENTS[id].onlyWhenPositive === "meta_ad.video_play_actions" && COMPONENTS[id].filterScope?.key === "ad_id") && COMPONENTS["meta_ad.video_impressions"].column === "impressions");
  check("FX4: frequency = impressions / reach, neutral, not benchmarkable", termIds(r("meta_frequency").numerator) === "meta_campaign.impressions" && termIds(r("meta_frequency").denominator) === "meta_campaign.reach" && f("meta_frequency").goodWhen === "neutral" && !f("meta_frequency").benchmarkable && /average daily frequency/i.test(f("meta_frequency").description));
  check("FX4: Meta CPM and CPA stay on the KPI view", termIds(r("meta_cpm").numerator) === "kpis.meta_spend" && termIds(r("meta_cpa").denominator) === "kpis.meta_purchases");
  check("FX4: cost metrics are money (display), rates native", f("meta_cost_per_lpv").meta.fxMode === "display" && f("meta_link_ctr").meta.fxMode === "native-per-client");
  check("FX4: benchmarkable where it makes sense", ["meta_cost_per_lpv", "meta_link_ctr", "meta_cpc_link", "meta_cost_per_atc", "meta_atc_rate", "meta_atc_to_purchase", "meta_cost_per_ic", "meta_hook_rate", "meta_hold_rate", "meta_conversion_rate"].every((id) => f(id as MetricId).benchmarkable) && !f("meta_lpv").benchmarkable && !f("meta_add_to_cart").benchmarkable);
  check("FX4: Meta marts in ad account currency", MARTS.meta_campaign.accountCurrency === true && MARTS.meta_ad.accountCurrency === true && !("accountCurrency" in MARTS.kpis) && MARTS.meta_campaign.phase === 1 && MARTS.meta_ad.phase === 1);
  check("FX4: outcomes are gaps only when spend is NULL", ["impressions", "reach", "link_clicks", "landing_page_views", "add_to_cart", "initiate_checkout", "purchases"].every((c) => COMPONENTS[`meta_campaign.${c}` as keyof typeof COMPONENTS].missingWhenNull === "meta_campaign.spend") && COMPONENTS["meta_ad.video_impressions"].missingWhenNull === "meta_ad.spend");
  check("HR3: 'hit rate' is the creative hit rate now, hook rate keeps 'thumbstop rate'", findMetricId("hit rate") === "hit_rate" && findMetricId("thumbstop rate") === "meta_hook_rate" && findMetricId("cost per landing page view") === "meta_cost_per_lpv" && findMetricId("average daily frequency") === "meta_frequency");
  {
    const aliases = METRIC_IDS.flatMap((id) => [...new Set([id, METRICS[id].label.toLowerCase(), ...(METRICS[id].aliases ?? []).map((a) => a.toLowerCase())])]);
    check("FX4: ids, labels and aliases unique", new Set(aliases).size === aliases.length);
  }

  const wm = widget(["meta_cost_per_lpv", "revenue", "meta_hook_rate"], { filters: { clients: { mode: "list", ids: ["alpha"] } } });
  check("FX4: resolve lists the three marts", eqJson(wm.marts, ["kpis", "meta_ad", "meta_campaign"]));
  check("FX4: resolve components", eqJson(wm.components, ["kpis.revenue", "meta_ad.video_impressions", "meta_ad.video_views", "meta_campaign.landing_page_views", "meta_campaign.spend"]));

  type MG = Partial<{ nRows: number; foreignCcyRows: number; fxMissingRows: number; fxMissingMonths: string[] }>;
  const rowM = (clientId: string, bucket: string, guards: Partial<Record<"kpis" | "meta_campaign" | "meta_ad", MG>>, values: Partial<Record<ComponentId, V>>, period: "cur" | "cmp" = "cur"): ComponentRow => {
    const base = row(clientId, period, bucket, values);
    const g: ComponentRow["guards"] = {};
    for (const [m, x] of Object.entries(guards)) {
      g[m as "kpis"] = { nRows: x?.nRows ?? 1, foreignCcyRows: x?.foreignCcyRows ?? 0, fxMissingRows: x?.fxMissingRows ?? 0, fxMissingMonths: x?.fxMissingMonths ?? [] };
    }
    return { ...base, guards: g };
  };

  // delta trades in EUR; its Meta account is in CZK (like an EUR shop with a CZK ad account).
  const wd = widget(["meta_cost_per_lpv", "meta_link_ctr", "revenue", "meta_frequency"], { filters: { clients: { mode: "list", ids: ["delta"] }, currency: "native", compare: "none" } });
  check("FX4: native for one EUR client is EUR", wd.displayCurrency === "EUR");
  const rd = evalW(wd, [
    rowM("delta", TOTAL, { kpis: {}, meta_campaign: { nRows: 30, foreignCcyRows: 30 } }, {
      "kpis.revenue": 10000,
      "meta_campaign.spend": [null, 2000],
      "meta_campaign.landing_page_views": 500,
      "meta_campaign.link_clicks": 800,
      "meta_campaign.impressions": 40000,
      "meta_campaign.reach": 25000,
    }),
  ]);
  check("FX4: Meta money in another account currency reads the converted display sum", close(cell(rd, "delta", "meta_cost_per_lpv").total, 4));
  check("FX4: KPI money of the same client keeps the native shortcut", close(cell(rd, "delta", "revenue").total, 10000));
  check("FX4: link CTR and frequency from summed components", close(cell(rd, "delta", "meta_link_ctr").total, 0.02) && close(cell(rd, "delta", "meta_frequency").total, 1.6));
  check("FX4: account-currency rows raise no foreign currency caveat", !rd.series[0].caveats.includes("foreign_currency_rows"));
  const rdk = evalW(wd, [rowM("delta", TOTAL, { kpis: { foreignCcyRows: 1 }, meta_campaign: { foreignCcyRows: 30 } }, { "kpis.revenue": [9000, 10000], "meta_campaign.spend": [null, 2000], "meta_campaign.landing_page_views": 500 })]);
  check("FX4: a foreign KPI row still raises the caveat", rdk.series[0].caveats.includes("foreign_currency_rows") && close(cell(rdk, "delta", "revenue").total, 10000));

  // FX guards are per mart: no Meta rate nulls only Meta money.
  const rfx = evalW(wd, [
    rowM("delta", TOTAL, { kpis: {}, meta_campaign: { foreignCcyRows: 30, fxMissingRows: 3, fxMissingMonths: ["2026-10-01"] } }, {
      "kpis.revenue": 10000,
      "meta_campaign.spend": [null, 1800],
      "meta_campaign.landing_page_views": 500,
      "meta_campaign.link_clicks": 800,
      "meta_campaign.impressions": 40000,
      "meta_campaign.reach": 25000,
    }),
  ]);
  check("FX4: missing Meta FX nulls Meta money only", cell(rfx, "delta", "meta_cost_per_lpv").status === "fx_missing" && cell(rfx, "delta", "meta_cost_per_lpv").reason === "No FX Oct 2026");
  check("FX4: KPI money and Meta rates unaffected by a Meta FX gap", cell(rfx, "delta", "revenue").status === "ok" && cell(rfx, "delta", "meta_link_ctr").status === "ok");
  check("FX4: Meta FX months reach the widget warning", rfx.warnings.some((x) => x.code === "fx_missing" && eqJson(x.months, ["2026-10-01"])));
  const rfx2 = evalW(wd, [rowM("delta", TOTAL, { kpis: { fxMissingRows: 2, fxMissingMonths: ["2026-09-01"] }, meta_campaign: { foreignCcyRows: 30 } }, { "kpis.revenue": [10000, 10000], "meta_campaign.spend": [null, 2000], "meta_campaign.landing_page_views": 500 })]);
  check("FX4: KPI FX gap does not null Meta money", cell(rfx2, "delta", "meta_cost_per_lpv").status === "ok" && close(cell(rfx2, "delta", "meta_cost_per_lpv").total, 4));

  // Gaps: spend NULL rows make every Meta term a gap; NULL outcomes with spend present are zero.
  const wg = widget(["meta_cost_per_lpv", "meta_lpv", "meta_atc_rate"], { filters: { clients: { mode: "list", ids: ["alpha"] }, compare: "none" } });
  const zeroOutcome = evalW(wg, [rowM("alpha", TOTAL, { meta_campaign: { nRows: 10 } }, { "meta_campaign.spend": withNulls(1000, 0), "meta_campaign.landing_page_views": withNulls(100, 0), "meta_campaign.add_to_cart": withNulls(5, 0) })]);
  check("FX4: NULL outcome with spend is zero (ATC rate ok)", close(cell(zeroOutcome, "alpha", "meta_atc_rate").total, 0.05) && close(cell(zeroOutcome, "alpha", "meta_cost_per_lpv").total, 10));
  const spendGap = evalW(wg, [rowM("alpha", TOTAL, { meta_campaign: { nRows: 10 } }, { "meta_campaign.spend": withNulls(1000, 2), "meta_campaign.landing_page_views": withNulls(100, 2), "meta_campaign.add_to_cart": withNulls(5, 2) })]);
  check("FX4: NULL Meta spend rows are a gap for cost, count and rate", ["meta_cost_per_lpv", "meta_lpv", "meta_atc_rate"].every((id) => cell(spendGap, "alpha", id as MetricId).status === "no_data" && cell(spendGap, "alpha", id as MetricId).reason === "Missing days"));

  // Not connected: a client without Meta, and the rollup "n of m".
  const wc = widget(["meta_link_ctr", "meta_cost_per_lpv", "meta_hook_rate"], { split: "combined", filters: { clients: { mode: "list", ids: ["alpha", "bravo", "charlie"] }, compare: "none" } });
  check("FX4: client without Meta is not queried", !wc.queryClientIds.includes("charlie") && wc.availability.charlie?.meta_link_ctr?.ok === false);
  const rc2 = evalW(wc, [
    rowM("alpha", TOTAL, { meta_campaign: {}, meta_ad: {} }, { "meta_campaign.link_clicks": 100, "meta_campaign.impressions": 10000, "meta_campaign.spend": 2000, "meta_campaign.landing_page_views": 80, "meta_ad.video_views": 300, "meta_ad.video_impressions": 1000 }),
    rowM("bravo", TOTAL, { meta_campaign: {}, meta_ad: {} }, { "meta_campaign.link_clicks": [300, 300], "meta_campaign.impressions": 10000, "meta_campaign.spend": [100, 2200], "meta_campaign.landing_page_views": 120, "meta_ad.video_views": 100, "meta_ad.video_impressions": 1000 }),
  ]);
  const cc = cell(rc2, "combined", "meta_link_ctr");
  check("FX4: combined link CTR from summed components, 2 of 3", close(cc.total, 0.02) && eqJson(cc.coverage, { included: 2, of: 3 }) && cc.excluded?.[0]?.id === "charlie" && cc.excluded?.[0]?.reason === "Meta not connected");
  check("FX4: combined cost per LPV from display sums", close(cell(rc2, "combined", "meta_cost_per_lpv").total, 4200 / 200));
  check("FX4: combined hook rate from the ad mart", close(cell(rc2, "combined", "meta_hook_rate").total, 0.2));
  const wcl = widget(["meta_link_ctr"], { filters: { clients: { mode: "list", ids: ["charlie"] }, compare: "none" } });
  const rcl = evalW(wcl, []);
  check("FX4: no Meta: not_connected cell", cell(rcl, "charlie", "meta_link_ctr").status === "not_connected" && cell(rcl, "charlie", "meta_link_ctr").reason === "Meta not connected");

  // A bucket with KPI rows but no Meta rows (FULL OUTER JOIN gives NULL Meta columns): no data, never 0.
  const wb = widget(["meta_link_ctr", "revenue"], { grain: "week", filters: { clients: { mode: "list", ids: ["alpha"] }, compare: "none" } });
  const rb = evalW(wb, [
    rowM("alpha", "2026-09-07", { kpis: {}, meta_campaign: { nRows: 0 } }, { "kpis.revenue": 500, "meta_campaign.link_clicks": null, "meta_campaign.impressions": null }),
    rowM("alpha", "2026-09-14", { kpis: {}, meta_campaign: { nRows: 7 } }, { "kpis.revenue": 700, "meta_campaign.link_clicks": 50, "meta_campaign.impressions": 2500 }),
  ]);
  const cb = cell(rb, "alpha", "meta_link_ctr");
  check("FX4: week without Meta rows is a null point, the total uses the other week", cb.points?.[0] === null && close(cb.points?.[1], 0.02) && close(cb.total, 0.02) && cell(rb, "alpha", "revenue").total === 1200);
}

// 4.14 Stated per-order costs (QF1, C-01): CM3 and CM1 equal Snapshot.
{
  const TOTAL = "1970-01-01";
  const RATES = { fulfilment: 20.5, otherCm1: null };
  const withRates = (c: ReportClient, rates: ReportClient["costRates"]): ReportClient => ({ ...c, costRates: rates });
  // alpha CZK with a stated fulfilment rate; charlie CZK without one.
  const clients = FIXTURE_CLIENTS.map((c) => (c.id === "alpha" ? withRates(c, { fulfilment: 10, otherCm1: 2 }) : c));
  const w = widget(["cm3", "cm3_pct", "cm1_pct"], { filters: { clients: { mode: "list", ids: ["alpha", "charlie"] }, compare: "none" }, clients });
  const base = { "kpis.revenue": 10000, "kpis.cogs": 4000, "kpis.fulfillment_cost": null, "kpis.paid_spend": 1000 } as const;
  const rows = [
    row("alpha", "cur", TOTAL, { ...base, "kpis.fulfilment_stated": 100, "kpis.other_cm1_stated": 100 }),
    row("charlie", "cur", TOTAL, { ...base, "kpis.fulfilment_stated": 100, "kpis.other_cm1_stated": 100 }),
  ];
  const r = evalW(w, rows);
  check("QF1: a stated rate multiplies only that client (alpha: 10 and 2 per order x 100 orders)", close(cell(r, "alpha", "cm3").total, 10000 - 4000 - 1000 - 1000 - 200));
  check("QF1: a client without stated rates equals mart CM3", close(cell(r, "charlie", "cm3").total, 10000 - 4000 - 1000));
  check("QF1: CM3 % uses the same terms", close(cell(r, "alpha", "cm3_pct").total, 3800 / 10000) && close(cell(r, "charlie", "cm3_pct").total, 0.5));
  check("QF1: CM1 % subtracts only the other CM1 rate", close(cell(r, "alpha", "cm1_pct").total, (10000 - 4000 - 200) / 10000) && close(cell(r, "charlie", "cm1_pct").total, 0.6));
  const rNull = evalW(widget(["cm3"], { filters: { clients: { mode: "list", ids: ["alpha"] }, compare: "none" }, clients: FIXTURE_CLIENTS.map((c) => (c.id === "alpha" ? withRates(c, { fulfilment: null, otherCm1: null }) : c)) }), [rows[0]]);
  check("QF1: null rates equal mart CM3 (unstated counts as 0, like Snapshot)", close(cell(rNull, "alpha", "cm3").total, 5000));
  const wc = widget(["cm3"], { split: "combined", filters: { clients: { mode: "list", ids: ["alpha", "charlie"] }, compare: "none" }, clients });
  check("QF1: rollup sums each client with its own rate", close(cell(evalW(wc, rows), "combined", "cm3").total, 3800 + 5000));

  // bravo trades in USD (Dobias-like). Display CZK: orders converted per month (SQL __disp = SUM(orders x monthly rate)), times the USD rate.
  const usd = FIXTURE_CLIENTS.map((c) => (c.id === "bravo" ? withRates(c, RATES) : c));
  const wu = widget(["cm3", "cm3_pct"], { grain: "month", filters: { clients: { mode: "list", ids: ["bravo"] }, compare: "none", currency: "CZK", period: { kind: "custom", from: "2026-08-01", to: "2026-09-30" } }, clients: usd });
  check("QF1: USD client shown in CZK", wu.displayCurrency === "CZK");
  // Aug: 100 orders at 23 CZK/USD; Sep: 50 orders at 24 CZK/USD.
  const ru = evalW(wu, [
    row("bravo", "cur", "2026-08-01", { "kpis.revenue": [10000, 230000], "kpis.cogs": [3000, 69000], "kpis.paid_spend": [1000, 23000], "kpis.fulfilment_stated": [100, 2300], "kpis.other_cm1_stated": [100, 2300] }, { foreignCcyRows: 0 }),
    row("bravo", "cur", "2026-09-01", { "kpis.revenue": [5000, 120000], "kpis.cogs": [1500, 36000], "kpis.paid_spend": [500, 12000], "kpis.fulfilment_stated": [50, 1200], "kpis.other_cm1_stated": [50, 1200] }, { foreignCcyRows: 0 }),
  ]);
  const cu = cell(ru, "bravo", "cm3");
  const fulfilCzk = 20.5 * (100 * 23 + 50 * 24);
  check("QF1: CZK display of a USD client converts the stated cost per month", close(cu.total, 350000 - 105000 - 35000 - fulfilCzk) && close(cu.points?.[0], 230000 - 69000 - 23000 - 20.5 * 2300) && close(cu.points?.[1], 120000 - 36000 - 12000 - 20.5 * 1200));
  check("QF1: CM3 % of a USD client reads native sums (USD rate x USD orders)", close(cell(ru, "bravo", "cm3_pct").total, (15000 - 4500 - 1500 - 20.5 * 150) / 15000));
  // Snapshot reference, Dobias 2026-07-06..2026-10-03 in CZK (read-only MCP 2026-10-05): SUM(cm3) 9,464,598.48891, SUM(orders x USD/CZK) 87,833.725.
  const rd = evalW(widget(["cm3"], { filters: { clients: { mode: "list", ids: ["bravo"] }, compare: "none", currency: "CZK" }, clients: usd }), [
    row("bravo", "cur", TOTAL, { "kpis.revenue": [null, 13028626.24832], "kpis.cogs": [null, 1], "kpis.fulfillment_cost": [null, 0], "kpis.paid_spend": [null, 13028626.24832 - 9464598.48891 - 1], "kpis.fulfilment_stated": [null, 87833.725], "kpis.other_cm1_stated": [null, 87833.725] }, { foreignCcyRows: 1 }),
  ]);
  check("QF1: Dobias-shaped CZK CM3 = SUM(cm3) - rate x SUM(orders fx) (QA Snapshot 7,664,008 at a 20.5 rate)", close(cell(rd, "bravo", "cm3").total, 9464598.48891 - 20.5 * 87833.725) && Math.abs((cell(rd, "bravo", "cm3").total ?? 0) - 7664008) < 1);
}

// 4.15 Shared query (QF1, C-03): a widget evaluated from the kpis superset equals the same widget from its own components.
{
  const TOTAL = "1970-01-01";
  const KPI_ALL = Object.values(COMPONENTS).filter((c) => c.mart === "kpis").map((c) => c.id);
  const clients = FIXTURE_CLIENTS.map((c) => (c.id === "alpha" ? { ...c, costRates: { fulfilment: 7, otherCm1: 1.5 } } : c));
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 1000;
  const metrics: MetricId[] = ["revenue", "cm3", "cm3_pct", "cm1_pct", "mer", "cac", "aov", "meta_roas"];
  for (const split of ["client", "combined"] as const) {
    for (const grain of ["total", "week"] as const) {
      const w = widget(metrics, { grain, split, filters: { clients: { mode: "list", ids: ["alpha", "bravo", "delta"] } }, clients });
      const buckets = grain === "total" ? [TOTAL] : buildBuckets(w.period.current, "week");
      const cmpBuckets = grain === "total" ? [TOTAL] : buildBuckets(w.period.comparison!, "week");
      const superRows: ComponentRow[] = [];
      for (const id of w.queryClientIds) {
        for (const [period, bs] of [["cur", buckets], ["cmp", cmpBuckets]] as const) {
          for (const b of bs) {
            const values: Partial<Record<ComponentId, V>> = {};
            for (const c of KPI_ALL) values[c] = (COMPONENTS as Record<string, { money: boolean }>)[c].money ? [rnd(), rnd() * 20] : Math.round(rnd());
            superRows.push(row(id, period, b, values));
          }
        }
      }
      const own = new Set(w.components);
      const subsetRows = superRows.map((x) => ({ ...x, values: Object.fromEntries(Object.entries(x.values).filter(([k]) => own.has(k as ComponentId))) }));
      check(`QF1: superset rows evaluate like subset rows (${split}, ${grain})`, eqJson(evalW(w, superRows), evalW(w, subsetRows)));
    }
  }
}

// 4.16 Creative hit rate (HR3): entity mart classified per ad against each client's own thresholds.
{
  const TOTAL = "1970-01-01";
  const T = (targetRoas: number, readPurchases: number): CreativeThresholds => ({
    killRoas: 1.8, targetRoas, targetCpa: 500, grossMargin: null,
    scaleMultiplier: 1.2, aggressiveMultiplier: 2, holdGateX: 1, iterateGateX: 2, killGateX: 3,
    readPurchases, directionalPurchases: Math.max(5, Math.round(readPurchases * 0.4)), maxCiHalfWidth: 0.25,
    hookRateFloor: 0.2, holdRateFloor: 0.05, frequencyWarn: 2, frequencyAct: 3,
    noTouchDays: 14, minAdsetBudgetDaily: null, perAdFloorDaily: null, tier: null,
  });
  type Ad = { p: number; spend: number; rev: number; age: number; prior?: number | null };
  const rowL = (clientId: string, period: "cur" | "cmp", bucket: string, ad: Ad): ComponentRow => ({
    clientId,
    period,
    bucket,
    guards: { ad_launch: { nRows: 1, foreignCcyRows: 0, fxMissingRows: 0, fxMissingMonths: [] } },
    values: {
      "ad_launch.purchases": { nat: ad.p, disp: ad.p, natNulls: 0, dispNulls: 0 },
      "ad_launch.spend": { nat: ad.spend, disp: ad.spend, natNulls: 0, dispNulls: 0 },
      "ad_launch.revenue": { nat: ad.rev, disp: ad.rev, natNulls: 0, dispNulls: 0 },
      "ad_launch.age_days": { nat: ad.age, disp: ad.age, natNulls: 0, dispNulls: 0 },
      "ad_launch.prior_roas": ad.prior === null ? { nat: null, disp: null, natNulls: 1, dispNulls: 1 } : { nat: ad.prior ?? 2, disp: ad.prior ?? 2, natNulls: 0, dispNulls: 0 },
    },
  });
  // Registry.
  const hr = METRICS.hit_rate;
  check("HR3: hit rate = winners / launched, percent, 1 decimal, up, not benchmarkable", hr.kind === "ratio" && eqJson(hr.numerator, [{ c: "ad_launch.winners", sign: 1, nullAs: "gap" }]) && eqJson(hr.denominator, [{ c: "ad_launch.launched", sign: 1, nullAs: "gap" }]) && hr.unit === "percent" && hr.format.decimals === 1 && hr.goodWhen === "up" && !hr.benchmarkable);
  check("HR3: winners and ads launched are sums of the classified counts", METRICS.winners.kind === "sum" && eqJson(METRICS.winners.terms.map((x) => x.c), ["ad_launch.winners"]) && METRICS.ads_launched.kind === "sum" && eqJson(METRICS.ads_launched.terms.map((x) => x.c), ["ad_launch.launched"]));
  check("HR3: the three need Meta and sit in the Creative group", (["hit_rate", "winners", "ads_launched"] as const).every((id) => evalCapExpr(METRICS[id].meta.requires, { ...alpha.capabilities, meta: false }) === false && METRICS[id].group === "creative"));
  check("ME3 C10: no metric carries a fixed reference value (the unsourced ~5% is gone)", hr.reference === undefined && METRICS.winners.reference === undefined && METRICS.ads_launched.reference === undefined);
  check("HR3: caveats maturing and lifetime on hit rate and winners only", eqJson(hr.caveats, ["cohort_maturing", "lifetime_to_date"]) && eqJson(METRICS.winners.caveats, ["cohort_maturing", "lifetime_to_date"]) && METRICS.ads_launched.caveats === undefined);
  check("HR3: cohort_maturing is data-driven, lifetime_to_date always applies", FIXTURE_CLIENTS.every((c) => !CAVEATS.cohort_maturing.applies(c) && CAVEATS.lifetime_to_date.applies(c)));
  check("HR3: ad_launch is an entity mart on first_date, no currency, relaunches and pre-existing ads excluded", MARTS.ad_launch.table === "mart.rpt_ad_launch" && MARTS.ad_launch.dateColumn === "first_date" && MARTS.ad_launch.currencyColumn === null && MARTS.ad_launch.entity.key === "ad_id" && eqJson(MARTS.ad_launch.entity.exclude, ["is_preexisting", "is_relaunch"]));
  check("HR3: classified outputs: launched needs no thresholds, winners is a lower bound", COMPONENTS["ad_launch.launched"].classified?.needsThresholds === false && COMPONENTS["ad_launch.winners"].classified?.needsThresholds === true && COMPONENTS["ad_launch.winners"].classified?.lowerBound === true && COMPONENTS["ad_launch.open"].classified?.lowerBound === false);
  check("HR3: resolve asks only for the classified outputs, the compiler adds the inputs", eqJson(componentsFor(["hit_rate"]), ["ad_launch.launched", "ad_launch.winners"]) && eqJson(componentsFor(["ads_launched"]), ["ad_launch.launched"]));

  // Classifier = launchStatus() of the Creative tile, row for row, across a grid; input rows untouched.
  {
    const t = T(2.25, 15);
    const client = { ...alpha, creativeThresholds: t };
    const grid: Ad[] = [];
    for (const p of [0, 5, 14, 15, 16, 40]) for (const roas of [0, 1.5, 2.2, 2.25, 2.4, 3.5]) for (const age of [10, 59, 60, 200]) grid.push({ p, spend: 1000, rev: 1000 * roas, age, prior: 2.03 });
    grid.push({ p: 50, spend: 1000, rev: 5000, age: 100, prior: null });
    grid.push({ p: 50, spend: 0, rev: 0, age: 100 });
    const rows = grid.map((ad) => rowL("alpha", "cur", TOTAL, ad));
    const before = JSON.stringify(rows);
    const out = classifyEntityRows(rows, new Map([["alpha", client]]));
    let same = 0;
    grid.forEach((ad, i) => {
      const lr: LaunchRow = { adId: "x", adName: "x", firstDate: "2026-09-01", ageDays: ad.age, spend: ad.spend, revenue: ad.rev, purchases: ad.p, isVideo: false, isRelaunch: false, isPreexisting: false, conceptId: null, conceptName: null, priorRoas: ad.prior === undefined ? 2 : ad.prior };
      const s = launchStatus(lr, t);
      const v = out[i].values;
      if (v["ad_launch.launched"]?.nat === 1 && v["ad_launch.winners"]?.nat === (s === "winner" ? 1 : 0) && v["ad_launch.open"]?.nat === (s === "open" ? 1 : 0) && v["ad_launch.purchases"] === undefined) same += 1;
    });
    check("HR3: classifier equals launchStatus() on every grid row (Creative tile parity by construction)", same === grid.length, `${same}/${grid.length}`);
    check("HR3: classifier never mutates the cached rows", JSON.stringify(rows) === before);
    check("HR3: no prior ROAS is never a winner", out[grid.length - 2].values["ad_launch.winners"]?.nat === 0);
    const none = classifyEntityRows([rows[0]], new Map([["alpha", { ...alpha, creativeThresholds: null }]]))[0].values;
    check("HR3: without thresholds only launched is written (no false zero)", none["ad_launch.launched"]?.nat === 1 && none["ad_launch.winners"] === undefined && none["ad_launch.open"] === undefined);
    const kpiRow = row("alpha", "cur", TOTAL, { "kpis.revenue": 5 });
    check("HR3: rows without an entity mart pass through as the same object", classifyEntityRows([kpiRow], new Map())[0] === kpiRow);
  }

  // alpha (Manami-like bar 2.25 / 15): 4 ads, 2 winners, 1 open; delta (bar 3.00 / 25): 3 ads, 1 winner; bravo: no thresholds, 2 ads.
  const clients = FIXTURE_CLIENTS.map((c) => (c.id === "alpha" ? { ...c, creativeThresholds: T(2.25, 15) } : c.id === "delta" ? { ...c, creativeThresholds: T(3, 25) } : c.id === "bravo" ? { ...c, creativeThresholds: null } : c));
  const ids = { clients: { mode: "list" as const, ids: ["alpha", "bravo", "delta"] }, compare: "none" as const };
  const curRows = [
    rowL("alpha", "cur", TOTAL, { p: 20, spend: 1000, rev: 3000, age: 90 }), // winner
    rowL("alpha", "cur", TOTAL, { p: 40, spend: 1000, rev: 2600, age: 90 }), // winner
    rowL("alpha", "cur", TOTAL, { p: 3, spend: 500, rev: 600, age: 20 }), // open
    rowL("alpha", "cur", TOTAL, { p: 3, spend: 500, rev: 600, age: 80 }), // settled
    rowL("delta", "cur", TOTAL, { p: 30, spend: 1000, rev: 4000, age: 100 }), // winner
    rowL("delta", "cur", TOTAL, { p: 20, spend: 1000, rev: 4000, age: 100 }), // n < 25: never a winner
    rowL("delta", "cur", TOTAL, { p: 0, spend: 100, rev: 0, age: 100 }),
    rowL("bravo", "cur", TOTAL, { p: 90, spend: 1000, rev: 9000, age: 100 }),
    rowL("bravo", "cur", TOTAL, { p: 0, spend: 100, rev: 0, age: 100 }),
  ];
  const rc = evalW(widget(["hit_rate", "winners", "ads_launched"], { filters: ids, clients }), curRows);
  check("HR3: per client hit rate, winners, launched", close(cell(rc, "alpha", "hit_rate").total, 0.5) && cell(rc, "alpha", "winners").total === 2 && cell(rc, "alpha", "ads_launched").total === 4 && close(cell(rc, "delta", "hit_rate").total, 1 / 3));
  check("HR4: hit rate carries its counts (winners of launched, ads), winners and ads launched carry none", eqJson(cell(rc, "alpha", "hit_rate").counts, { part: 2, whole: 4, noun: "ads" }) && eqJson(cell(rc, "delta", "hit_rate").counts, { part: 1, whole: 3, noun: "ads" }) && cell(rc, "alpha", "winners").counts === undefined && cell(rc, "alpha", "ads_launched").counts === undefined);
  check("HR3: n < readPurchases is never a winner, whatever the ROAS", cell(rc, "delta", "winners").total === 1);
  const nb = cell(rc, "bravo", "hit_rate");
  check("HR3: no thresholds: not_measured 'No thresholds', never 0", nb.status === "not_measured" && nb.reason === NO_THRESHOLDS && nb.total === null && cell(rc, "bravo", "winners").reason === NO_THRESHOLDS);
  check("HR3: ads launched needs no thresholds", cell(rc, "bravo", "ads_launched").status === "ok" && cell(rc, "bravo", "ads_launched").total === 2);
  check("HR3: maturing caveat on the series with an open launch only", rc.series.find((s) => s.id === "alpha")!.caveats.includes("cohort_maturing") && !rc.series.find((s) => s.id === "delta")!.caveats.includes("cohort_maturing") && visibleCaveats(rc.series.find((s) => s.id === "alpha")!.caveats, METRICS.hit_rate.caveats).includes("cohort_maturing") && !visibleCaveats(rc.series.find((s) => s.id === "alpha")!.caveats, METRICS.ads_launched.caveats).includes("cohort_maturing"));

  const rk = evalW(widget(["hit_rate", "winners", "ads_launched"], { split: "combined", filters: ids, clients }), curRows);
  const ck = cell(rk, "combined", "hit_rate");
  check("HR3: combined = sum of winners / sum of launched (3 of 7), not a mean of rates", close(ck.total, 3 / 7) && !close(ck.total, (0.5 + 1 / 3) / 2));
  check("HR4: combined counts sum the kept clients only (no-threshold client left out)", eqJson(ck.counts, { part: 3, whole: 7, noun: "ads" }) && ck.total !== null && close(ck.total, ck.counts!.part / ck.counts!.whole));
  check("HR3: no-threshold client left out of the combined with a coverage note", eqJson(ck.coverage, { included: 2, of: 3 }) && eqJson(ck.excluded, [{ id: "bravo", name: bravo.name, reason: NO_THRESHOLDS }]));
  check("HR3: combined winners 3 of 3 clients' bars, combined launched sums all 3 clients", cell(rk, "combined", "winners").total === 3 && cell(rk, "combined", "ads_launched").total === 9 && eqJson(cell(rk, "combined", "ads_launched").coverage, { included: 3, of: 3 }));
  check("HR3: combined carries the maturing caveat when a member is maturing", rk.series[0].caveats.includes("cohort_maturing"));

  // Thresholds change the evaluation only (SQL and key are asserted in check:reports).
  const strict = clients.map((c) => (c.id === "alpha" ? { ...c, creativeThresholds: T(2.5, 15) } : c));
  check("HR3: a stricter target changes the result at once (Settings edit, no cache change)", close(cell(evalW(widget(["hit_rate"], { filters: ids, clients: strict }), curRows), "alpha", "hit_rate").total, 0.25));

  // Comparison: a maturing current cohort against a settled previous one has no delta.
  {
    const cmpIds = { clients: { mode: "list" as const, ids: ["alpha"] }, compare: "previous_period" as const };
    const settledCmp = [rowL("alpha", "cmp", TOTAL, { p: 20, spend: 1000, rev: 3000, age: 120 }), rowL("alpha", "cmp", TOTAL, { p: 2, spend: 100, rev: 0, age: 120 })];
    const curSettled = curRows.slice(0, 2).concat(curRows[3]).map((r) => ({ ...r }));
    const rm = evalW(widget(["hit_rate", "winners", "ads_launched"], { filters: cmpIds, clients }), [...curRows.slice(0, 4), ...settledCmp]);
    check("HR3: maturing current vs settled previous: delta suppressed, previous kept", cell(rm, "alpha", "hit_rate").delta === null && close(cell(rm, "alpha", "hit_rate").compareTotal, 0.5) && cell(rm, "alpha", "winners").delta === null);
    check("HR4: a withheld delta is flagged so the 123 view cannot rebuild it", cell(rm, "alpha", "hit_rate").deltaSuppressed === true && cell(rm, "alpha", "winners").deltaSuppressed === true && cell(rm, "alpha", "ads_launched").deltaSuppressed === undefined);
    check("HR3: ads launched keeps its delta (not a lower bound)", close(cell(rm, "alpha", "ads_launched").delta, 1));
    const rs = evalW(widget(["hit_rate"], { filters: cmpIds, clients }), [...curSettled, ...settledCmp]);
    check("HR3: settled vs settled keeps the delta (pp)", close(cell(rs, "alpha", "hit_rate").delta, 2 / 3 - 0.5));
    check("HR4: a kept delta is not flagged, hit rate stays pp and counts stay relative", cell(rs, "alpha", "hit_rate").deltaSuppressed === undefined && cell(rs, "alpha", "hit_rate").deltaKind === "pp" && cell(rm, "alpha", "winners").deltaKind === "relative" && cell(rm, "alpha", "ads_launched").deltaKind === "relative");
    const openCmp = [...settledCmp, rowL("alpha", "cmp", TOTAL, { p: 1, spend: 100, rev: 0, age: 40 })];
    const ro = evalW(widget(["hit_rate"], { filters: cmpIds, clients }), [...curRows.slice(0, 4), ...openCmp]);
    check("HR3: both maturing keeps the delta", close(cell(ro, "alpha", "hit_rate").delta, 0.5 - 1 / 3));
    const rkc = evalW(widget(["hit_rate"], { split: "combined", filters: { ...ids, compare: "previous_period" }, clients }), [...curRows, ...settledCmp, rowL("delta", "cmp", TOTAL, { p: 30, spend: 1000, rev: 4000, age: 150 })]);
    check("HR3: combined delta suppressed too when the kept clients are maturing now and not before", cell(rkc, "combined", "hit_rate").delta === null && close(cell(rkc, "combined", "hit_rate").compareTotal, 2 / 3));
    check("HR4: combined delta flagged too", cell(rkc, "combined", "hit_rate").deltaSuppressed === true);
  }

  // Buckets: launches bucketed by first delivery month; a month without launches is a gap, not 0 %.
  {
    const wmo = widget(["hit_rate", "ads_launched"], { grain: "month", filters: { clients: { mode: "list", ids: ["alpha"] }, compare: "none", period: { kind: "custom", from: "2026-07-01", to: "2026-09-30" } }, clients });
    const r = evalW(wmo, [
      rowL("alpha", "cur", "2026-07-01", { p: 20, spend: 1000, rev: 3000, age: 90 }),
      rowL("alpha", "cur", "2026-07-01", { p: 2, spend: 100, rev: 0, age: 90 }),
      rowL("alpha", "cur", "2026-09-01", { p: 2, spend: 100, rev: 0, age: 20 }),
    ]);
    check("HR3: month points 50 %, gap, 0 % (open) and total 1 of 3", eqJson(cell(r, "alpha", "hit_rate").points, [0.5, null, 0]) && close(cell(r, "alpha", "hit_rate").total, 1 / 3) && eqJson(cell(r, "alpha", "ads_launched").points, [2, null, 1]));
  }

  // Mixed widget: KPI rows and entity rows never meet (SQL joins on entity_key), so revenue is not multiplied by the ad count.
  {
    const wx = widget(["revenue", "hit_rate"], { filters: { clients: { mode: "list", ids: ["alpha"] }, compare: "none" }, clients });
    const kpi = row("alpha", "cur", TOTAL, { "kpis.revenue": 1000 });
    const nullInputs = { "ad_launch.purchases": null, "ad_launch.spend": null, "ad_launch.revenue": null, "ad_launch.age_days": null, "ad_launch.prior_roas": null } as const;
    const kpiJoined: ComponentRow = { ...kpi, guards: { ...kpi.guards, ad_launch: { nRows: 0, foreignCcyRows: 0, fxMissingRows: 0, fxMissingMonths: [] } }, values: { ...kpi.values, ...Object.fromEntries(Object.keys(nullInputs).map((k) => [k, { nat: null, disp: null, natNulls: 0, dispNulls: 0 }])) } };
    const ads = curRows.slice(0, 4).map((r) => ({ ...r, guards: { ...r.guards, kpis: { nRows: 0, foreignCcyRows: 0, fxMissingRows: 0, fxMissingMonths: [] } } }));
    const r = evalW(wx, [kpiJoined, ...ads]);
    check("HR3: mixed widget: revenue once, hit rate from the ads", close(cell(r, "alpha", "revenue").total, 1000) && close(cell(r, "alpha", "hit_rate").total, 0.5));
  }

  // Parity with the Creative tile: random launches, Reports total = hitRate() of lib/creative/hitRate.ts.
  {
    const t = T(2.25, 15);
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const launches: LaunchRow[] = Array.from({ length: 150 }, (_, i) => {
      const p = Math.floor(rnd() * 40);
      const spend = 100 + rnd() * 3000;
      return { adId: `a${i}`, adName: "", firstDate: "2026-09-10", ageDays: Math.floor(rnd() * 120), spend, revenue: spend * rnd() * 4.5, purchases: p, isVideo: false, isRelaunch: false, isPreexisting: false, conceptId: null, conceptName: null, priorRoas: 2.0287 };
    });
    const tile = hitRate(launches, t);
    const r = evalW(widget(["hit_rate", "winners", "ads_launched"], { filters: { clients: { mode: "list", ids: ["alpha"] }, compare: "none" }, clients: clients.map((c) => (c.id === "alpha" ? { ...c, creativeThresholds: t } : c)) }), launches.map((l) => rowL("alpha", "cur", TOTAL, { p: l.purchases, spend: l.spend, rev: l.revenue, age: l.ageDays, prior: l.priorRoas })));
    check("HR3: Reports equals the Creative tile on the same launches (winners, launched, rate)", cell(r, "alpha", "winners").total === tile.winners && cell(r, "alpha", "ads_launched").total === tile.launched && close(cell(r, "alpha", "hit_rate").total, tile.rate ?? -1) && (tile.winners ?? 0) > 0, `${tile.winners}/${tile.launched}`);
  }
}

// ---------------------------------------------------------------------------
// 5. Benchmarks
// ---------------------------------------------------------------------------

function bench(p: Partial<BenchmarkRow> & Pick<BenchmarkRow, "benchmarkId">): BenchmarkRow {
  return {
    vertical: "vertical_a",
    region: "CZ",
    metricId: "mer",
    periodStart: "2026-01-01",
    periodEnd: "2026-06-30",
    stat: "median",
    value: 3,
    valueLow: null,
    valueHigh: null,
    currency: null,
    source: "Fixture",
    sourceUrl: null,
    asOf: "2026-09-01",
    definitionNote: null,
    sampleNote: null,
    note: null,
    ...p,
  };
}

const FX: FxRate[] = [
  { monthStart: "2026-06-01", from: "EUR", to: "CZK", rate: 24.5 },
  { monthStart: "2026-06-01", from: "USD", to: "CZK", rate: 22 },
  { monthStart: "2026-06-01", from: "CAD", to: "USD", rate: 0.7 },
];

{
  // Range 2026-09-07..2026-10-03, so a row ending 2026-06-30 has no overlap but is within 18 months.
  const w = widget(["mer", "revenue", "meta_cpm"], { filters: { clients: { mode: "list", ids: ["alpha"] }, benchmark: true } });
  const pick = (rows: BenchmarkRow[]) => matchBenchmarks({ rows, fx: FX, widget: w, today: TODAY }).filter((m) => m.metricId === "mer");

  check("region preference order", eqJson(regionPreference({ region: "CZ" }), ["CZ", "EU", "GLOBAL"]) && eqJson(regionPreference({ region: null }), ["EU", "GLOBAL"]) && eqJson(regionPreference({ region: "EU" }), ["EU", "GLOBAL"]));
  check("client market first", pick([bench({ benchmarkId: "eu", region: "EU" }), bench({ benchmarkId: "cz" }), bench({ benchmarkId: "gl", region: "GLOBAL" })])[0]?.benchmarkId === "cz");
  check("then EU", pick([bench({ benchmarkId: "eu", region: "EU" }), bench({ benchmarkId: "gl", region: "GLOBAL" })])[0]?.benchmarkId === "eu");
  check("then GLOBAL", pick([bench({ benchmarkId: "gl", region: "GLOBAL" })])[0]?.benchmarkId === "gl");
  check("other regions never apply", pick([bench({ benchmarkId: "us", region: "US" })]).length === 0);
  check("vertical before region", pick([bench({ benchmarkId: "va-eu", region: "EU" }), bench({ benchmarkId: "all-cz", vertical: "all_ecommerce" })])[0]?.benchmarkId === "va-eu");
  check("fallback to all_ecommerce", pick([bench({ benchmarkId: "vb", vertical: "vertical_b" }), bench({ benchmarkId: "all", vertical: "all_ecommerce", region: "GLOBAL" })])[0]?.benchmarkId === "all");
  check("overlap beats recency", pick([bench({ benchmarkId: "old" }), bench({ benchmarkId: "overlap", periodStart: "2026-09-01", periodEnd: "2026-09-30", asOf: "2026-01-01" })])[0]?.benchmarkId === "overlap");
  check("more overlap wins", pick([bench({ benchmarkId: "short", periodStart: "2026-09-25", periodEnd: "2026-12-31" }), bench({ benchmarkId: "long", periodStart: "2026-07-01", periodEnd: "2026-09-30" })])[0]?.benchmarkId === "long");
  check("latest period_end when no overlap", pick([bench({ benchmarkId: "h1", periodEnd: "2026-06-30" }), bench({ benchmarkId: "h2", periodStart: "2025-07-01", periodEnd: "2025-12-31" })])[0]?.benchmarkId === "h1");
  check("outside 18-month lookback ignored", pick([bench({ benchmarkId: "ancient", periodStart: "2024-07-01", periodEnd: "2025-03-01" })]).length === 0);
  check("within lookback kept", pick([bench({ benchmarkId: "recent-ish", periodStart: "2025-01-01", periodEnd: "2025-04-01", asOf: "2026-01-01" })]).length === 1);
  check("future rows ignored", pick([bench({ benchmarkId: "future", periodStart: "2026-11-01", periodEnd: "2026-12-31" })]).length === 0);
  check("ties by latest as_of", pick([bench({ benchmarkId: "a", asOf: "2026-03-01" }), bench({ benchmarkId: "b", asOf: "2026-08-01" })])[0]?.benchmarkId === "b");
  check("ties prefer median", pick([bench({ benchmarkId: "p25", stat: "p25" }), bench({ benchmarkId: "med" })])[0]?.benchmarkId === "med");
  check("stale after 12 months", pick([bench({ benchmarkId: "s", asOf: "2025-09-01" })])[0]?.status === "stale" && pick([bench({ benchmarkId: "f", asOf: "2025-11-01" })])[0]?.status === "ok");

  const all = matchBenchmarks({
    rows: [
      bench({ benchmarkId: "rev", metricId: "revenue" }),
      bench({ benchmarkId: "unknown", metricId: "not_a_metric" }),
      bench({ benchmarkId: "cpm", metricId: "meta_cpm", region: "EU", value: 6, valueLow: 5, valueHigh: 7, currency: "EUR" }),
    ],
    fx: FX,
    widget: w,
    today: TODAY,
  });
  check("non-benchmarkable and unknown metrics skipped", all.length === 1 && all[0].metricId === "meta_cpm");
  check("money converted at period_end month", all[0].status === "ok" && close(all[0].value, 6 * 24.5) && close(all[0].low, 5 * 24.5) && close(all[0].high, 7 * 24.5));
  const noFx = matchBenchmarks({ rows: [bench({ benchmarkId: "cpm-dec", metricId: "meta_cpm", currency: "EUR", periodStart: "2026-07-01", periodEnd: "2026-12-31" })], fx: FX, widget: w, today: TODAY });
  check("no rate: no_fx and hidden", noFx[0]?.status === "no_fx" && noFx[0]?.value === null && noFx[0]?.low === null);
  const noCcy = matchBenchmarks({ rows: [bench({ benchmarkId: "cpm-x", metricId: "meta_cpm", currency: null })], fx: FX, widget: w, today: TODAY });
  check("money row without currency: no_fx", noCcy[0]?.status === "no_fx");
  check("two-hop CAD via USD", close(fxFactor(FX, "CAD", "CZK", "2026-06-15"), 0.7 * 22) && close(fxFactor(FX, "EUR", "USD", "2026-06-30"), 24.5 / 22));
  check("same currency factor 1", fxFactor([], "EUR", "EUR", "2030-01-01") === 1);

  // Several clients: matches merge, not_connected clients get none.
  const wm = widget(["mer", "meta_roas"], { filters: { benchmark: true } });
  const ms = matchBenchmarks({
    rows: [
      bench({ benchmarkId: "va-cz" }),
      bench({ benchmarkId: "va-eu", region: "EU" }),
      bench({ benchmarkId: "all-eu", vertical: "all_ecommerce", region: "EU" }),
      bench({ benchmarkId: "roas-all", metricId: "meta_roas", vertical: "all_ecommerce", region: "GLOBAL" }),
    ],
    fx: FX,
    widget: wm,
    today: TODAY,
  });
  const by = (id: string) => ms.find((m) => m.benchmarkId === id);
  check("alpha (CZ) gets the CZ row", eqJson(by("va-cz")?.appliesTo, ["alpha"]));
  check("bravo (US) falls to EU", eqJson(by("va-eu")?.appliesTo, ["bravo"]));
  check("charlie and delta share all_ecommerce EU", eqJson(by("all-eu")?.appliesTo, ["charlie", "delta"]));
  check("not connected client gets no benchmark", eqJson(by("roas-all")?.appliesTo, ["alpha", "bravo", "delta"]));
  check("output fields", by("va-cz")?.vertical === "vertical_a" && by("va-cz")?.region === "CZ" && eqJson(by("va-cz")?.period, { from: "2026-01-01", to: "2026-06-30" }));
}

// ---------------------------------------------------------------------------
// 6. Copy gate: no em or en dash in the WP1 files
// ---------------------------------------------------------------------------

{
  const root = join(__dirname, "..");
  const files = [
    "lib/reports/registry/components.ts",
    "lib/reports/registry/metrics.ts",
    "lib/reports/registry/caveats.ts",
    "lib/reports/registry/capabilities.ts",
    "lib/reports/resolve.ts",
    "lib/reports/evaluate.ts",
    "lib/reports/benchmarkMatch.ts",
    "scripts/check-reports-eval.ts",
  ];
  const DASHES = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)];
  for (const f of files) {
    const text = readFileSync(join(root, f), "utf8");
    check(`no em or en dash in ${f}`, !DASHES.some((d) => text.includes(d)));
  }
  // Registry files stay pure: no server-only import, no project id.
  for (const f of readdirSync(join(root, "lib/reports/registry"))) {
    const p = join(root, "lib/reports/registry", f);
    if (!statSync(p).isFile()) continue;
    const text = readFileSync(p, "utf8");
    check(`registry/${f} is pure`, !/(from|import)\s+["']server-only["']/.test(text) && !text.includes("oneeighty-warehouse"));
  }
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`check-reports-eval: ${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`check-reports-eval: ${passed}/${passed} passed`);
