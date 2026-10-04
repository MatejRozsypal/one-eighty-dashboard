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
import { evaluateWidget } from "@/lib/reports/evaluate";
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
const LIVE_META_CAMPAIGN_COLUMNS = ["date", "currency", "link_clicks", "add_to_cart"];
const LIVE_EMAIL_CAMPAIGN_COLUMNS = ["send_date", "currency", "sent", "delivered", "unique_opens", "unique_clicks", "revenue"];
const LIVE = { kpis: LIVE_KPIS_COLUMNS, meta_campaign: LIVE_META_CAMPAIGN_COLUMNS, email_campaign: LIVE_EMAIL_CAMPAIGN_COLUMNS } as const;

for (const c of Object.values(COMPONENTS)) {
  check(`component ${c.id} column is an identifier`, IDENTIFIER_RE.test(c.column));
  check(`component ${c.id} exists in the live view`, (LIVE[c.mart] as readonly string[]).includes(c.column));
}
for (const m of Object.values(MARTS)) {
  check(`mart ${m.id} date column live`, (LIVE[m.id] as readonly string[]).includes(m.dateColumn));
  check(`mart ${m.id} currency column live`, m.currencyColumn === null || (LIVE[m.id] as readonly string[]).includes(m.currencyColumn));
}
check("excluded columns are not components", !["unique_customers", "cm1", "cm2", "cm3", "frequency_per_day"].some((c) => Object.values(COMPONENTS).some((d) => d.column === c)));
check("cogs guard is revenue", COMPONENTS["kpis.cogs"].zeroIsMissingWhen === "kpis.revenue");

check("every registry id defined", REGISTRY_METRIC_IDS.every((id) => METRICS[id]?.id === id));
check("30 phase-1 metrics", METRIC_IDS.length === 30 && METRIC_IDS.every((id) => METRICS[id].phase === 1));
check("5 phase-2 metrics", PHASE2_METRIC_IDS.every((id) => METRICS[id].phase === 2));
check("picker list holds the 30 queryable metrics", METRIC_LIST.length === 30);
check("cm3 = revenue - cogs - fulfillment - paid (mart definition)", METRICS.cm3.kind === "sum" && eqJson(METRICS.cm3.terms, [
  { c: "kpis.revenue", sign: 1, nullAs: "gap" },
  { c: "kpis.cogs", sign: -1, nullAs: "gap" },
  { c: "kpis.fulfillment_cost", sign: -1, nullAs: "zero" },
  { c: "kpis.paid_spend", sign: -1, nullAs: "zero" },
]));
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
  check("components sorted incl. fulfilment", eqJson(w.components, ["kpis.cogs", "kpis.fulfillment_cost", "kpis.meta_revenue", "kpis.meta_spend", "kpis.paid_spend", "kpis.revenue"]));
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
  check("Gap rule: only ad outcomes use missingWhenNull", Object.values(COMPONENTS).filter((c) => c.missingWhenNull !== undefined).length === 8);
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
