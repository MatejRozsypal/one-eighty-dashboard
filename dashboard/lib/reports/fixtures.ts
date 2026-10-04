/**
 * Typed fixtures for the Reports suite.
 *
 * Fictional clients (alpha, bravo, charlie, delta) and fictional figures: none
 * of these numbers describe a real client, and the benchmark rows cite no real
 * source. They exist so that widgets (WP7) can render every state, the
 * evaluator (WP1) has typed inputs, and the contracts are proven to fit
 * together: this file only compiles if the types in types.ts, contracts.ts and
 * registry/types.ts agree.
 *
 * Gap semantics: a value that cannot be computed is null, never 0. It renders
 * as NO_VALUE ("n/a") with the cell's `reason` (or CELL_STATUS_LABEL) beside it.
 *
 * Coverage:
 * - FIXTURE_RESULTS.clientWeekly: split client, every status (ok,
 *   not_connected, no_data, not_measured, fx_missing), week grain, partial
 *   last bucket, comparison, no benchmarks.
 * - FIXTURE_RESULTS.combinedTotalBenchmarks: split combined, grain total,
 *   coverage "1 of 2", not_measured rollup, benchmarks ok / stale / no_fx.
 * - FIXTURE_RESULTS.combinedMonthlyFxMissing: split combined, month grain, no
 *   comparison, fx_missing rollup with the unaffected months kept.
 * - FIXTURE_RESULTS.verticalMonthly: split vertical, pp deltas, unassigned
 *   vertical with no_data.
 *
 * Pure module. Owner: RS0 (contracts). Packages may add fixtures in their own
 * files; edit this one only through the orchestrator.
 */

import type { BenchmarkRow, ComponentRow, FxRate, ResolvedWidget } from "./contracts";
import type { ReportClient } from "./registry/types";
import {
  COMBINED_SERIES_ID,
  UNASSIGNED_VERTICAL,
  verticalSeriesId,
  type BenchmarkMatch,
  type ReportFilters,
  type WidgetConfigInput,
  type WidgetResult,
  type WidgetType,
} from "./types";

/** The "today" every fixture assumes (yesterday = 2026-10-03). */
export const FIXTURE_TODAY = "2026-10-04";

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const ALL_CLIENTS_CAVEATS = ["platform_attributed", "new_flag_window", "period_share_not_rcr"] as const;

/** alpha: Shoptet, CZK, Meta + Google. */
const alpha: ReportClient = {
  id: "alpha",
  name: "Alpha",
  currency: "CZK",
  shopPlatform: "shoptet",
  capabilities: {
    shopify: false,
    shoptet: true,
    woocommerce: false,
    meta: true,
    googleAds: true,
    klaviyo: false,
    ecomail: true,
    ga4: false,
    shop: true,
    email: true,
  },
  vertical: "vertical_a",
  subVertical: null,
  region: "CZ",
  slot: 0,
};

/** bravo: Shopify, USD, Meta + Google. FIXTURE_FX has no rate for Oct 2026. */
const bravo: ReportClient = {
  id: "bravo",
  name: "Bravo",
  currency: "USD",
  shopPlatform: "shopify",
  capabilities: {
    shopify: true,
    shoptet: false,
    woocommerce: false,
    meta: true,
    googleAds: true,
    klaviyo: true,
    ecomail: false,
    ga4: false,
    shop: true,
    email: true,
  },
  vertical: "vertical_a",
  subVertical: null,
  region: "US",
  slot: 1,
};

/** charlie: WooCommerce, CZK, Google only, no cost data (COGS not measured). */
const charlie: ReportClient = {
  id: "charlie",
  name: "Charlie",
  currency: "CZK",
  shopPlatform: "woocommerce",
  capabilities: {
    shopify: false,
    shoptet: false,
    woocommerce: true,
    meta: false,
    googleAds: true,
    klaviyo: false,
    ecomail: false,
    ga4: false,
    shop: true,
    email: false,
  },
  vertical: "vertical_b",
  subVertical: null,
  region: "CZ",
  slot: 2,
};

/** delta: Shopify, EUR, Meta only, no vertical row, no rows in the fixture ranges. */
const delta: ReportClient = {
  id: "delta",
  name: "Delta",
  currency: "EUR",
  shopPlatform: "shopify",
  capabilities: {
    shopify: true,
    shoptet: false,
    woocommerce: false,
    meta: true,
    googleAds: false,
    klaviyo: false,
    ecomail: false,
    ga4: false,
    shop: true,
    email: false,
  },
  vertical: null,
  subVertical: null,
  region: "EU",
  slot: 3,
};

export const FIXTURE_CLIENTS: readonly ReportClient[] = [alpha, bravo, charlie, delta];

// ---------------------------------------------------------------------------
// Filters and widget configs
// ---------------------------------------------------------------------------

export const FIXTURE_FILTERS: ReportFilters = {
  clients: { mode: "list", ids: ["alpha", "bravo", "charlie", "delta"] },
  period: { kind: "custom", from: "2026-09-07", to: "2026-10-03" },
  compare: "previous_period",
  currency: "CZK",
  benchmark: false,
};

/** One valid config per widget type (inputs: `overrides` may be omitted). */
export const FIXTURE_CONFIGS: Readonly<Record<WidgetType, WidgetConfigInput>> = {
  kpi: {
    v: 1,
    query: { metrics: ["mer"], grain: "total", split: "combined" },
    view: { type: "kpi" },
  },
  line: {
    v: 1,
    query: { metrics: ["mer", "cm3", "meta_roas"], grain: "week", split: "client" },
    view: { type: "line", title: "MER by client, weekly" },
  },
  bar: {
    v: 1,
    query: { metrics: ["revenue"], grain: "month", split: "client", overrides: { currency: "EUR" } },
    view: { type: "bar", stacked: true },
  },
  table: {
    v: 1,
    query: { metrics: ["revenue", "mer", "cac", "cm3_pct", "meta_roas", "google_roas"], grain: "total", split: "client" },
    view: { type: "table", sort: "desc" },
  },
  ranked: {
    v: 1,
    query: { metrics: ["mer"], grain: "total", split: "client" },
    view: { type: "ranked", sort: "desc", limit: 10 },
  },
  scatter: {
    v: 1,
    query: { metrics: ["paid_spend", "mer", "revenue"], grain: "total", split: "client" },
    view: { type: "scatter", scatter: { x: "paid_spend", y: "mer", size: "revenue" } },
  },
};

// ---------------------------------------------------------------------------
// Pipeline inputs: resolved widget and component rows (for clientWeekly)
// ---------------------------------------------------------------------------

export const FIXTURE_RESOLVED: ResolvedWidget = {
  query: { metrics: ["mer", "cm3", "meta_roas"], grain: "week", split: "client", overrides: {} },
  filters: FIXTURE_FILTERS,
  clients: [alpha, bravo, charlie, delta],
  queryClientIds: ["alpha", "bravo", "charlie", "delta"],
  period: {
    current: { from: "2026-09-07", to: "2026-10-03" },
    comparison: { from: "2026-08-11", to: "2026-09-06" },
    mode: "previous_period",
  },
  scan: { from: "2026-08-11", to: "2026-10-03" },
  grain: "week",
  displayCurrency: "CZK",
  components: ["kpis.cogs", "kpis.meta_revenue", "kpis.meta_spend", "kpis.paid_spend", "kpis.revenue"],
  marts: ["kpis"],
  availability: {
    alpha: { mer: { ok: true, missing: [] }, cm3: { ok: true, missing: [] }, meta_roas: { ok: true, missing: [] } },
    bravo: { mer: { ok: true, missing: [] }, cm3: { ok: true, missing: [] }, meta_roas: { ok: true, missing: [] } },
    charlie: { mer: { ok: true, missing: [] }, cm3: { ok: true, missing: [] }, meta_roas: { ok: false, missing: ["meta"] } },
    delta: { mer: { ok: true, missing: [] }, cm3: { ok: true, missing: [] }, meta_roas: { ok: true, missing: [] } },
  },
  warnings: [],
};

const noGuards = { nRows: 7, foreignCcyRows: 0, fxMissingRows: 0, fxMissingMonths: [] };

/** A sample of what run.ts returns for FIXTURE_RESOLVED (not every bucket). */
export const FIXTURE_ROWS: readonly ComponentRow[] = [
  // alpha, first week: MER 310000 / 100000 = 3.1; CM3 310000 - 28000 - 100000 = 182000; Meta ROAS 144000 / 60000 = 2.4.
  {
    clientId: "alpha",
    period: "cur",
    bucket: "2026-09-07",
    guards: { kpis: noGuards },
    values: {
      "kpis.revenue": { nat: 310000, disp: 310000 },
      "kpis.cogs": { nat: 28000, disp: 28000 },
      "kpis.paid_spend": { nat: 100000, disp: 100000 },
      "kpis.meta_revenue": { nat: 144000, disp: 144000 },
      "kpis.meta_spend": { nat: 60000, disp: 60000 },
    },
  },
  // bravo, first week: one row in a foreign currency -> caveat foreign_currency_rows.
  {
    clientId: "bravo",
    period: "cur",
    bucket: "2026-09-07",
    guards: { kpis: { nRows: 7, foreignCcyRows: 1, fxMissingRows: 0, fxMissingMonths: [] } },
    values: {
      "kpis.revenue": { nat: 26000, disp: 601000 },
      "kpis.cogs": { nat: 7800, disp: 180300 },
      "kpis.paid_spend": { nat: 5000, disp: 115600 },
      "kpis.meta_revenue": { nat: 9000, disp: 208000 },
      "kpis.meta_spend": { nat: 3000, disp: 69300 },
    },
  },
  // bravo, last (partial) week: Oct 1 to 3 have no USD rate. disp is a partial SUM and must be nulled by the evaluator.
  {
    clientId: "bravo",
    period: "cur",
    bucket: "2026-09-28",
    guards: { kpis: { nRows: 6, foreignCcyRows: 0, fxMissingRows: 3, fxMissingMonths: ["2026-10-01"] } },
    values: {
      "kpis.revenue": { nat: 20000, disp: 231000 },
      "kpis.cogs": { nat: 6000, disp: 69300 },
      "kpis.paid_spend": { nat: 4000, disp: 46200 },
      "kpis.meta_revenue": { nat: 6200, disp: 71600 },
      "kpis.meta_spend": { nat: 2000, disp: 23100 },
    },
  },
  // charlie, first week: COGS 0 on positive revenue -> not_measured (a NULL COGS sum means the same). No Meta, so Meta components are null.
  {
    clientId: "charlie",
    period: "cur",
    bucket: "2026-09-07",
    guards: { kpis: noGuards },
    values: {
      "kpis.revenue": { nat: 194000, disp: 194000 },
      "kpis.cogs": { nat: 0, disp: 0 },
      "kpis.paid_spend": { nat: 20000, disp: 20000 },
      "kpis.meta_revenue": { nat: null, disp: null },
      "kpis.meta_spend": { nat: null, disp: null },
    },
  },
  // delta has no rows at all: the evaluator yields no_data from the absence, never zeros.
];

// ---------------------------------------------------------------------------
// Benchmark inputs (fictional rows; no real source)
// ---------------------------------------------------------------------------

export const FIXTURE_BENCHMARK_ROWS: readonly BenchmarkRow[] = [
  {
    benchmarkId: "fixture-vertical_a-mer-cz",
    vertical: "vertical_a",
    region: "CZ",
    metricId: "mer",
    periodStart: "2026-01-01",
    periodEnd: "2026-06-30",
    stat: "median",
    value: 3.1,
    valueLow: 2.4,
    valueHigh: 4.0,
    currency: null,
    source: "Fixture (not a real source)",
    sourceUrl: null,
    asOf: "2026-09-15",
    definitionNote: "Revenue ex VAT; blended paid",
    sampleNote: null,
    note: null,
  },
  {
    benchmarkId: "fixture-all-mer-eu",
    vertical: "all_ecommerce",
    region: "EU",
    metricId: "mer",
    periodStart: "2024-07-01",
    periodEnd: "2024-12-31",
    stat: "median",
    value: 4.5,
    valueLow: null,
    valueHigh: null,
    currency: null,
    source: "Fixture (not a real source)",
    sourceUrl: "https://example.com/fixture",
    asOf: "2025-02-01",
    definitionNote: null,
    sampleNote: null,
    note: null,
  },
  {
    benchmarkId: "fixture-vertical_a-meta_cpm-eu",
    vertical: "vertical_a",
    region: "EU",
    metricId: "meta_cpm",
    periodStart: "2026-07-01",
    periodEnd: "2026-12-31",
    stat: "median",
    value: 6.2,
    valueLow: null,
    valueHigh: null,
    currency: "EUR",
    source: "Fixture (not a real source)",
    sourceUrl: null,
    asOf: "2026-09-15",
    definitionNote: null,
    sampleNote: null,
    note: null,
  },
];

/** Fixture rates stop at 2026-09, so every Oct 2026 bucket lacks a rate. */
export const FIXTURE_FX: readonly FxRate[] = [
  { monthStart: "2026-08-01", from: "EUR", to: "CZK", rate: 24.4 },
  { monthStart: "2026-08-01", from: "USD", to: "CZK", rate: 23.1 },
  { monthStart: "2026-09-01", from: "EUR", to: "CZK", rate: 24.3 },
  { monthStart: "2026-09-01", from: "USD", to: "CZK", rate: 23.1 },
];

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

const WEEKS = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"];
const NULL4: Array<number | null> = [null, null, null, null];

/** Split client, week grain, every cell status, no benchmarks. */
const clientWeekly: WidgetResult = {
  key: "fixture-client-weekly",
  generatedAt: "2026-10-04T08:00:00.000Z",
  cached: false,
  currency: "CZK",
  grain: "week",
  current: { from: "2026-09-07", to: "2026-10-03" },
  comparison: { from: "2026-08-11", to: "2026-09-06" },
  buckets: WEEKS,
  partialBuckets: [3],
  series: [
    {
      id: "alpha",
      label: "Alpha",
      slot: 0,
      kind: "client",
      caveats: ["revenue_incl_vat", "google_all_conversions", ...ALL_CLIENTS_CAVEATS],
      cells: {
        mer: {
          status: "ok",
          total: 3.15,
          compareTotal: 3.0,
          delta: 0.05,
          deltaKind: "relative",
          points: [3.1, 3.4, 2.9, 3.2],
          comparePoints: [2.8, 3.1, 3.0, 3.1],
        },
        cm3: {
          status: "ok",
          total: 654200,
          compareTotal: 610000,
          delta: 0.0725,
          deltaKind: "relative",
          points: [182000, 201500, 174300, 96400],
          comparePoints: [98000, 172000, 168000, 172000],
        },
        meta_roas: {
          status: "ok",
          total: 2.45,
          compareTotal: 2.6,
          delta: -0.0577,
          deltaKind: "relative",
          points: [2.4, 2.7, 2.2, 2.5],
          comparePoints: [2.5, 2.6, 2.7, 2.6],
        },
      },
    },
    {
      id: "bravo",
      label: "Bravo",
      slot: 1,
      kind: "client",
      caveats: ["returns_not_netted", "google_all_conversions", ...ALL_CLIENTS_CAVEATS, "foreign_currency_rows"],
      cells: {
        // Ratio metric, per-client series: reads native sums, so missing FX does not touch it.
        mer: {
          status: "ok",
          total: 5.1,
          compareTotal: 4.9,
          delta: 0.0408,
          deltaKind: "relative",
          points: [5.2, 4.8, 5.5, 5.0],
          comparePoints: [4.7, 5.0, 4.9, 5.0],
        },
        // Money metric in display currency: the October bucket has no rate.
        cm3: {
          status: "fx_missing",
          reason: "No FX Oct 2026",
          fxMonths: ["2026-10-01"],
          total: null,
          compareTotal: null,
          delta: null,
          deltaKind: "relative",
          points: [305100, 298700, 321900, null],
          comparePoints: [389000, 402000, 395500, 401200],
        },
        meta_roas: {
          status: "ok",
          total: 3.05,
          compareTotal: 3.2,
          delta: -0.0469,
          deltaKind: "relative",
          points: [3.0, 3.3, 2.8, 3.1],
          comparePoints: [3.1, 3.3, 3.2, 3.2],
          lowVolume: true,
        },
      },
    },
    {
      id: "charlie",
      label: "Charlie",
      slot: 2,
      kind: "client",
      caveats: ["google_only_paid", "google_all_conversions", ...ALL_CLIENTS_CAVEATS],
      cells: {
        mer: {
          status: "ok",
          total: 9.7,
          compareTotal: 9.2,
          delta: 0.0543,
          deltaKind: "relative",
          points: [9.7, 10.4, 9.1, 9.6],
          comparePoints: [9.0, 9.4, 9.1, 9.3],
        },
        cm3: {
          status: "not_measured",
          reason: "No cost data",
          total: null,
          compareTotal: null,
          delta: null,
          deltaKind: "relative",
          points: NULL4,
          comparePoints: NULL4,
        },
        meta_roas: {
          status: "not_connected",
          reason: "Meta not connected",
          missing: ["meta"],
          total: null,
          compareTotal: null,
          delta: null,
          deltaKind: "relative",
        },
      },
    },
    {
      id: "delta",
      label: "Delta",
      slot: 3,
      kind: "client",
      caveats: ["returns_not_netted", ...ALL_CLIENTS_CAVEATS],
      cells: {
        mer: { status: "no_data", reason: "No data", total: null, compareTotal: null, delta: null, deltaKind: "relative", points: NULL4, comparePoints: NULL4 },
        cm3: { status: "no_data", reason: "No data", total: null, compareTotal: null, delta: null, deltaKind: "relative", points: NULL4, comparePoints: NULL4 },
        meta_roas: { status: "no_data", reason: "No data", total: null, compareTotal: null, delta: null, deltaKind: "relative", points: NULL4, comparePoints: NULL4 },
      },
    },
  ],
  benchmarks: [],
  warnings: [{ code: "fx_missing", months: ["2026-10-01"] }],
};

const benchmarks: BenchmarkMatch[] = [
  {
    metricId: "mer",
    vertical: "vertical_a",
    region: "CZ",
    stat: "median",
    status: "ok",
    value: 3.1,
    low: 2.4,
    high: 4.0,
    source: "Fixture (not a real source)",
    sourceUrl: null,
    asOf: "2026-09-15",
    period: { from: "2026-01-01", to: "2026-06-30" },
    note: "Revenue ex VAT; blended paid",
    appliesTo: ["alpha"],
    benchmarkId: "fixture-vertical_a-mer-cz",
  },
  {
    // vertical_b has no row: fell back to all_ecommerce, region EU. as_of is more than 12 months old.
    metricId: "mer",
    vertical: "all_ecommerce",
    region: "EU",
    stat: "median",
    status: "stale",
    value: 4.5,
    low: null,
    high: null,
    source: "Fixture (not a real source)",
    sourceUrl: "https://example.com/fixture",
    asOf: "2025-02-01",
    period: { from: "2024-07-01", to: "2024-12-31" },
    note: null,
    appliesTo: ["charlie"],
    benchmarkId: "fixture-all-mer-eu",
  },
  {
    // Money benchmark in EUR with no EUR rate for its period_end month (2026-12): hidden, hover says why.
    metricId: "meta_cpm",
    vertical: "vertical_a",
    region: "EU",
    stat: "median",
    status: "no_fx",
    value: null,
    low: null,
    high: null,
    source: "Fixture (not a real source)",
    sourceUrl: null,
    asOf: "2026-09-15",
    period: { from: "2026-07-01", to: "2026-12-31" },
    note: null,
    appliesTo: ["alpha"],
    benchmarkId: "fixture-vertical_a-meta_cpm-eu",
  },
];

/** Split combined (alpha + charlie), grain total, KPI-style, with benchmarks. */
const combinedTotalBenchmarks: WidgetResult = {
  key: "fixture-combined-total-benchmarks",
  generatedAt: "2026-10-04T08:00:00.000Z",
  cached: true,
  currency: "CZK",
  grain: "total",
  current: { from: "2026-08-01", to: "2026-08-31" },
  comparison: { from: "2025-08-02", to: "2025-09-01" },
  buckets: [],
  partialBuckets: [],
  series: [
    {
      id: COMBINED_SERIES_ID,
      label: "All clients",
      slot: 0,
      kind: "combined",
      caveats: ["revenue_incl_vat", "google_only_paid", "google_all_conversions", ...ALL_CLIENTS_CAVEATS],
      clientIds: ["alpha", "charlie"],
      cells: {
        mer: { status: "ok", total: 4.2, compareTotal: 3.9, delta: 0.0769, deltaKind: "relative", coverage: { included: 2, of: 2 } },
        // charlie has no Meta: left out of the rollup, not counted as zero.
        meta_cpm: { status: "ok", total: 142.5, compareTotal: 151.0, delta: -0.0563, deltaKind: "relative", coverage: { included: 1, of: 2 } },
        // charlie's COGS is not measured, so the rollup is null, never a partial total.
        cm3_pct: { status: "not_measured", reason: "No cost data", total: null, compareTotal: null, delta: null, deltaKind: "pp", coverage: { included: 2, of: 2 } },
      },
    },
  ],
  benchmarks,
  warnings: [],
};

/** Split combined (alpha + bravo), month grain, no comparison, display EUR, Oct 2026 without FX. */
const combinedMonthlyFxMissing: WidgetResult = {
  key: "fixture-combined-monthly-fx",
  generatedAt: "2026-10-04T08:00:00.000Z",
  cached: false,
  currency: "EUR",
  grain: "month",
  current: { from: "2026-08-01", to: "2026-10-03" },
  comparison: null,
  buckets: ["2026-08-01", "2026-09-01", "2026-10-01"],
  partialBuckets: [2],
  series: [
    {
      id: COMBINED_SERIES_ID,
      label: "All clients",
      slot: 0,
      kind: "combined",
      caveats: ["revenue_incl_vat", "returns_not_netted", "google_all_conversions", ...ALL_CLIENTS_CAVEATS],
      clientIds: ["alpha", "bravo"],
      cells: {
        revenue: {
          status: "fx_missing",
          reason: "No FX Oct 2026",
          fxMonths: ["2026-10-01"],
          total: null,
          compareTotal: null,
          delta: null,
          deltaKind: "relative",
          points: [151200, 148900, null],
          coverage: { included: 2, of: 2 },
        },
        // Rollups always read display sums, so a ratio is affected too.
        mer: {
          status: "fx_missing",
          reason: "No FX Oct 2026",
          fxMonths: ["2026-10-01"],
          total: null,
          compareTotal: null,
          delta: null,
          deltaKind: "relative",
          points: [3.9, 4.1, null],
          coverage: { included: 2, of: 2 },
        },
      },
    },
  ],
  benchmarks: [],
  warnings: [{ code: "fx_missing", months: ["2026-10-01"] }],
};

/** Split vertical, month grain, previous year, pp deltas on a percent metric. */
const verticalMonthly: WidgetResult = {
  key: "fixture-vertical-monthly",
  generatedAt: "2026-10-04T08:00:00.000Z",
  cached: false,
  currency: "CZK",
  grain: "month",
  current: { from: "2026-06-01", to: "2026-08-31" },
  comparison: { from: "2025-06-02", to: "2025-09-01" },
  buckets: ["2026-06-01", "2026-07-01", "2026-08-01"],
  partialBuckets: [],
  series: [
    {
      id: verticalSeriesId("vertical_a"),
      label: "vertical_a",
      slot: 0,
      kind: "vertical",
      caveats: ["revenue_incl_vat", "returns_not_netted", "google_all_conversions", ...ALL_CLIENTS_CAVEATS],
      clientIds: ["alpha", "bravo"],
      cells: {
        mer: { status: "ok", total: 4.13, compareTotal: 3.8, delta: 0.0868, deltaKind: "relative", points: [4.0, 4.3, 4.1], comparePoints: [3.7, 3.9, 3.8], coverage: { included: 2, of: 2 } },
        returning_order_share: { status: "ok", total: 0.32, compareTotal: 0.29, delta: 0.03, deltaKind: "pp", points: [0.31, 0.33, 0.32], comparePoints: [0.28, 0.29, 0.3], coverage: { included: 2, of: 2 } },
      },
    },
    {
      id: verticalSeriesId("vertical_b"),
      label: "vertical_b",
      slot: 1,
      kind: "vertical",
      caveats: ["google_only_paid", "google_all_conversions", ...ALL_CLIENTS_CAVEATS],
      clientIds: ["charlie"],
      cells: {
        mer: { status: "ok", total: 9.67, compareTotal: 8.8, delta: 0.0989, deltaKind: "relative", points: [9.5, 9.9, 9.6], comparePoints: [8.7, 8.9, 8.8], coverage: { included: 1, of: 1 } },
        returning_order_share: { status: "ok", total: 0.23, compareTotal: 0.25, delta: -0.02, deltaKind: "pp", points: [0.22, 0.24, 0.23], comparePoints: [0.25, 0.25, 0.24], coverage: { included: 1, of: 1 } },
      },
    },
    {
      id: verticalSeriesId(UNASSIGNED_VERTICAL),
      label: UNASSIGNED_VERTICAL,
      slot: 2,
      kind: "vertical",
      caveats: ["returns_not_netted", ...ALL_CLIENTS_CAVEATS],
      clientIds: ["delta"],
      cells: {
        mer: { status: "no_data", reason: "No data", total: null, compareTotal: null, delta: null, deltaKind: "relative", points: [null, null, null], comparePoints: [null, null, null], coverage: { included: 1, of: 1 } },
        returning_order_share: { status: "no_data", reason: "No data", total: null, compareTotal: null, delta: null, deltaKind: "pp", points: [null, null, null], comparePoints: [null, null, null], coverage: { included: 1, of: 1 } },
      },
    },
  ],
  benchmarks: [],
  warnings: [],
};

export const FIXTURE_RESULTS = {
  clientWeekly,
  combinedTotalBenchmarks,
  combinedMonthlyFxMissing,
  verticalMonthly,
} as const satisfies Record<string, WidgetResult>;

export type FixtureResultKey = keyof typeof FIXTURE_RESULTS;
