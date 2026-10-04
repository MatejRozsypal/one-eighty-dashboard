/**
 * Every numeric limit and policy constant of the Reports suite, in one place.
 *
 * Pure module (type-only imports). The zod contracts in `types.ts`, the
 * resolver, the runner, the grid and the browser data hook all read from here
 * so a limit can never differ between the client and the server.
 *
 * Design: 11_reporting_suite_design.md sections 1.12, 1.13, 2.7, 2.11, 3.4,
 * 3.5, 4.1. Owner: RS0 (contracts).
 */

import type { QueryGrain } from "./registry/types";
import type { WidgetType } from "./types";

// ---------------------------------------------------------------------------
// Request size (resolve.ts returns 413 too_large when broken)
// ---------------------------------------------------------------------------

/**
 * Longest allowed current range per grain. Unit follows the grain: days for
 * `day`, ISO weeks for `week`, calendar months for `month` and `total`.
 */
export const MAX_SPAN: Readonly<Record<QueryGrain, number>> = {
  day: 400,
  week: 160,
  month: 60,
  total: 60,
};

/** Buckets x series per widget. */
export const MAX_POINTS = 1_500;
export const MAX_METRICS_PER_WIDGET = 8;
export const MAX_WIDGETS_PER_REPORT = 24;
export const MAX_CLIENT_IDS = 30;
export const MAX_VERTICALS = 10;
export const MAX_RANKED_LIMIT = 30;
export const MAX_WIDGET_TITLE = 80;
export const MAX_REPORT_NAME = 120;

/**
 * How far back the marts reach. Custom ranges are clamped to
 * `from >= yesterday - WAREHOUSE_MONTHS` with a `range_clamped` warning.
 * Same window as `presetRange("all")` in lib/period.ts.
 */
export const WAREHOUSE_MONTHS = 60;

// ---------------------------------------------------------------------------
// BigQuery cost guardrails (run.ts)
// ---------------------------------------------------------------------------

/** Default for env REPORTS_MAX_BYTES_BILLED: 2 GiB. Exceeding it maps to 422 over_budget. */
export const DEFAULT_MAX_BYTES_BILLED = 2 * 1024 ** 3;
/** Job timeout. Exceeding it maps to 504 timeout. */
export const JOB_TIMEOUT_MS = 20_000;
/** `maxDuration` of the query route, seconds. */
export const ROUTE_MAX_DURATION_S = 30;
/** check:reports dry runs fail above this share of the byte budget. */
export const DRY_RUN_BUDGET_SHARE = 0.5;

// ---------------------------------------------------------------------------
// Caching (run.ts, clients.ts, benchmarks.ts, browser hook)
// ---------------------------------------------------------------------------

export const CACHE_TTL_S = {
  /** Range ends within 2 days of yesterday. */
  recent: 15 * 60,
  /** Range ends within the last 7 days. */
  lastWeek: 60 * 60,
  /** Anything older. */
  older: 6 * 60 * 60,
  /** getReportClients(). */
  clients: 5 * 60,
  /** Benchmark rows and FX rates. */
  reference: 6 * 60 * 60,
} as const;

export const CACHE_TAGS = {
  data: "reports",
  bigquery: "bq",
  reference: "reports-ref",
  benchmarks: "benchmarks",
} as const;

/** Browser: module-level LRU of WidgetResult by key. */
export const BROWSER_RESULT_CACHE_SIZE = 100;
/** Browser: concurrent widget requests per tab. */
export const MAX_CONCURRENT_WIDGET_REQUESTS = 6;
/** refreshReportData(): one call per user per window. */
export const REFRESH_RATE_LIMIT_MS = 60_000;

// ---------------------------------------------------------------------------
// Benchmarks (benchmarkMatch.ts)
// ---------------------------------------------------------------------------

export const BENCHMARK_POLICY = {
  /** Fallback vertical when the client's vertical has no candidate. */
  allVertical: "all_ecommerce",
  /** Region preference after the client's own market (owner decision). */
  regionFallback: ["EU", "GLOBAL"],
  /** With no overlap, take the latest period_end within this many months before the range. */
  lookbackMonths: 18,
  /** as_of older than this renders muted with "Stale". */
  staleAfterMonths: 12,
} as const;

// ---------------------------------------------------------------------------
// Grid and editing (canvas, store DDL checks)
// ---------------------------------------------------------------------------

export const GRID = {
  cols: 12,
  rowHeight: 40,
  gutter: 16,
  /** Matches the report_widgets CHECK constraints. */
  maxY: 999,
  minH: 2,
  maxH: 24,
  /** Editing is enabled at this width and up. */
  editMinWidth: 1200,
  /** 768 to 1199px: display-only grid with this many columns. Below: read-only stack. */
  tabletMinWidth: 768,
  tabletCols: 6,
} as const;

export interface WidgetSize {
  w: number;
  h: number;
  minW: number;
  minH: number;
}

/** Default and minimum size per widget type (design 1.13). */
export const WIDGET_SIZE: Readonly<Record<WidgetType, WidgetSize>> = {
  kpi: { w: 3, h: 3, minW: 2, minH: 3 },
  line: { w: 6, h: 7, minW: 4, minH: 5 },
  bar: { w: 6, h: 7, minW: 4, minH: 5 },
  table: { w: 12, h: 8, minW: 6, minH: 5 },
  ranked: { w: 4, h: 7, minW: 3, minH: 5 },
  scatter: { w: 6, h: 8, minW: 4, minH: 6 },
};

/** Series colour slots (--series-1 .. --series-6). Beyond this, dash patterns. */
export const SERIES_SLOTS = 6;

export const AUTOSAVE_DEBOUNCE_MS = 800;
export const UNDO_HISTORY_STEPS = 50;
