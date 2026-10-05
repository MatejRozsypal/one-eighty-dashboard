/**
 * Reports request contracts (zod) and the result shape.
 *
 * Pure module: zod plus type-only imports, safe for the browser bundle. The
 * builder, the URL helpers, the query route, the server actions and the store
 * all validate against the schemas here, so a config that passes in one place
 * passes everywhere.
 *
 * Every schema is exported twice under one name: the zod value and its output
 * type (`ReportFilters` the schema, `ReportFilters` the parsed type).
 *
 * Gaps are never zero. A value that cannot be computed is `null` and renders
 * as NO_VALUE ("n/a", lib/format.ts) with the cell's status as the reason.
 *
 * Design: 11_reporting_suite_design.md sections 2.6, 2.9, 2.12, 3.2.
 * Owner: RS0 (contracts).
 */

import { z } from "zod";
import type { ComparisonMode, DateRange, PresetKey } from "@/lib/period";
import { METRIC_IDS, type MetricId } from "./registry/ids";
import type { Capability, CaveatId, QueryGrain } from "./registry/types";
import {
  GRID,
  MAX_CLIENT_IDS,
  MAX_METRICS_PER_WIDGET,
  MAX_RANKED_LIMIT,
  MAX_REPORT_NAME,
  MAX_VERTICALS,
  MAX_WIDGET_TITLE,
} from "./limits";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD`, a real calendar date. */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Invalid date");

/** Client ids and vertical keys share the registry identifier rule. */
const Slug = z.string().regex(/^[a-z0-9_]{1,40}$/);

export const REPORT_PRESETS = ["7d", "28d", "30d", "90d", "mtd", "ytd", "12m", "all"] as const satisfies readonly PresetKey[];
export type ReportPreset = (typeof REPORT_PRESETS)[number];

export const COMPARE_MODES = ["previous_period", "previous_year", "none"] as const satisfies readonly ComparisonMode[];

export const DISPLAY_CURRENCIES = ["CZK", "EUR", "USD"] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];
export const REPORT_CURRENCIES = ["native", ...DISPLAY_CURRENCIES] as const;
export type ReportCurrency = (typeof REPORT_CURRENCIES)[number];

export const WIDGET_TYPES = ["kpi", "line", "bar", "table", "ranked", "scatter"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const WIDGET_SPLITS = ["client", "combined", "vertical"] as const;
export type WidgetSplit = (typeof WIDGET_SPLITS)[number];

export const QUERY_GRAINS = ["total", "day", "week", "month"] as const satisfies readonly QueryGrain[];

export const VISIBILITIES = ["private", "team_view", "team_edit"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

// ---------------------------------------------------------------------------
// Filters (design 2.6)
// ---------------------------------------------------------------------------

export const ClientSelection = z.discriminatedUnion("mode", [
  /** Every active client, including ones added after the report was saved. */
  z.object({ mode: z.literal("all") }),
  z.object({ mode: z.literal("list"), ids: z.array(Slug).min(1).max(MAX_CLIENT_IDS) }),
  /** Resolved through ref.client_verticals. */
  z.object({ mode: z.literal("vertical"), verticals: z.array(Slug).min(1).max(MAX_VERTICALS) }),
]);
export type ClientSelection = z.infer<typeof ClientSelection>;

export const PeriodSpec = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("preset"), preset: z.enum(REPORT_PRESETS) }),
    /** Clamped by resolve.ts to `to <= yesterday` and the warehouse window, with a range_clamped warning. */
    z.object({ kind: z.literal("custom"), from: IsoDate, to: IsoDate }),
  ])
  .refine((p) => p.kind !== "custom" || p.from <= p.to, { message: "from must not be after to", path: ["to"] });
export type PeriodSpec = z.infer<typeof PeriodSpec>;

export const ReportFilters = z.object({
  clients: ClientSelection,
  period: PeriodSpec,
  compare: z.enum(COMPARE_MODES),
  /** "native" resolves to the shared currency, or CZK with a currency_coerced warning when mixed. */
  currency: z.enum(REPORT_CURRENCIES),
  benchmark: z.boolean(),
});
export type ReportFilters = z.infer<typeof ReportFilters>;

/** Filters of a new report. Owner decision: CZK by default. */
export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  clients: { mode: "all" },
  period: { kind: "preset", preset: "90d" },
  compare: "previous_period",
  currency: "CZK",
  benchmark: false,
};

// ---------------------------------------------------------------------------
// Widget config (design 2.6)
// ---------------------------------------------------------------------------

const QueryMetric = z.enum(METRIC_IDS);

export const WidgetQuery = z.object({
  /** Display order is the array order. */
  metrics: z
    .array(QueryMetric)
    .min(1)
    .max(MAX_METRICS_PER_WIDGET)
    .refine((m) => new Set(m).size === m.length, "Duplicate metric"),
  grain: z.enum(QUERY_GRAINS),
  split: z.enum(WIDGET_SPLITS),
  /** Absent key = inherit the report filter. */
  overrides: ReportFilters.partial().default({}),
});
export type WidgetQuery = z.infer<typeof WidgetQuery>;

/** Display-only. Changing it re-renders locally and never refetches. */
export const WidgetView = z.object({
  type: z.enum(WIDGET_TYPES),
  title: z.string().max(MAX_WIDGET_TITLE).optional(),
  sort: z.enum(["desc", "asc"]).optional(),
  limit: z.number().int().min(1).max(MAX_RANKED_LIMIT).optional(),
  stacked: z.boolean().optional(),
  scatter: z.object({ x: QueryMetric, y: QueryMetric, size: QueryMetric.optional() }).optional(),
});
export type WidgetView = z.infer<typeof WidgetView>;

/**
 * Stored in report_widgets.config. RS0 adds two cross-field rules the design
 * states in prose (1.6): a scatter names X and Y (and optional Size) from its
 * query metrics; a ranked widget has exactly one metric.
 */
export const WidgetConfig = z
  .object({ v: z.literal(1), query: WidgetQuery, view: WidgetView })
  .superRefine((cfg, ctx) => {
    if (cfg.view.type === "scatter") {
      const s = cfg.view.scatter;
      if (!s) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["view", "scatter"], message: "Scatter needs X and Y" });
        return;
      }
      for (const m of [s.x, s.y, s.size]) {
        if (m && !cfg.query.metrics.includes(m)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["view", "scatter"], message: `${m} is not in query.metrics` });
        }
      }
    }
    if (cfg.view.type === "ranked" && cfg.query.metrics.length !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["query", "metrics"], message: "Ranked takes one metric" });
    }
  });
export type WidgetConfig = z.infer<typeof WidgetConfig>;
/** What a caller may pass before defaults are applied (overrides optional). */
export type WidgetConfigInput = z.input<typeof WidgetConfig>;

// ---------------------------------------------------------------------------
// Layout and report metadata (design 4.1)
// ---------------------------------------------------------------------------

/** One grid item. Mirrors the report_widgets CHECK constraints. */
export const LayoutItem = z
  .object({
    id: z.string().uuid(),
    x: z.number().int().min(0).max(GRID.cols - 1),
    y: z.number().int().min(0).max(GRID.maxY),
    w: z.number().int().min(1).max(GRID.cols),
    h: z.number().int().min(GRID.minH).max(GRID.maxH),
  })
  .refine((i) => i.x + i.w <= GRID.cols, { message: "Item exceeds the grid", path: ["w"] });
export type LayoutItem = z.infer<typeof LayoutItem>;

export const ReportName = z.string().trim().min(1).max(MAX_REPORT_NAME);

export const Visibility = z.enum(VISIBILITIES);

// ---------------------------------------------------------------------------
// Query route (design 3.2)
// ---------------------------------------------------------------------------

/** Body of POST /api/reports/query. */
export const ReportQueryRequest = z.object({
  /** When present, view permission on that report is checked too. */
  reportId: z.string().uuid().optional(),
  filters: ReportFilters,
  query: WidgetQuery,
  /** Used for job labels only. */
  widgetType: z.enum(WIDGET_TYPES).optional(),
});
export type ReportQueryRequest = z.infer<typeof ReportQueryRequest>;

export type ReportErrorCode = "invalid" | "not_found" | "too_large" | "over_budget" | "timeout" | "warehouse_error" | "conflict" | "forbidden";

/** HTTP status per error code. `not_found` covers "not authorised" too (the route never says 403). */
export const REPORT_ERROR_STATUS: Readonly<Record<ReportErrorCode, number>> = {
  invalid: 400,
  not_found: 404,
  forbidden: 404,
  too_large: 413,
  over_budget: 422,
  timeout: 504,
  warehouse_error: 500,
  conflict: 409,
};

/** JSON body of a non-200 query response. A 404 has an empty body. */
export interface ReportErrorBody {
  code: ReportErrorCode;
  /** One short line, safe to show. Never a BigQuery message. */
  message?: string;
  /** too_large only, e.g. "Use week grain". */
  suggestion?: string;
  /** invalid only: zod issue paths and messages. */
  issues?: Array<{ path: Array<string | number>; message: string }>;
}

// ---------------------------------------------------------------------------
// Result shape (design 2.12)
// ---------------------------------------------------------------------------

/**
 * - not_connected: the client lacks a capability the metric requires (registry flags).
 * - fx_missing: a display-currency sum covers a month with no FX rate.
 * - not_measured: a cost component is not measured: COGS summed to NULL, or to 0 on positive revenue.
 * - no_data: capability present, but the sum is null (no rows in range).
 */
export type CellStatus = "ok" | "not_connected" | "no_data" | "not_measured" | "fx_missing";

/** Highest first. A cell takes the first status that applies (design 2.9 step 7). */
export const CELL_STATUS_PRECEDENCE: readonly CellStatus[] = ["not_connected", "fx_missing", "not_measured", "no_data", "ok"];

/** Default status text. `MetricCell.reason` is more specific when set ("Meta not connected", "No FX Oct 2026"). */
export const CELL_STATUS_LABEL: Readonly<Record<Exclude<CellStatus, "ok">, string>> = {
  not_connected: "Not connected",
  fx_missing: "No FX",
  not_measured: "No cost data",
  no_data: "No data",
};

export interface MetricCell {
  status: CellStatus;
  /** Two or three words for the status line and hover. Absent when ok. */
  reason?: string;
  /** not_connected only: the capabilities the client lacks for this metric. */
  missing?: Capability[];
  /** fx_missing only: months (`YYYY-MM-01`) with no rate. */
  fxMonths?: string[];
  /** Null whenever status is not ok, and never 0 in place of a gap. */
  total: number | null;
  /** Null when status is not ok, when there is no comparison, or when the comparison cannot be computed. */
  compareTotal: number | null;
  /** Fraction for "relative", percentage points as a fraction (0.021 = 2.1 pp) for "pp". Null when status is not ok or on a zero or null baseline. */
  delta: number | null;
  /** "pp" for percent units, "relative" for everything else. */
  deltaKind: "relative" | "pp";
  /**
   * True when the delta was withheld on purpose (a maturing cohort against a
   * settled one), so no view may rebuild it from the two totals ("123" mode).
   */
  deltaSuppressed?: boolean;
  /**
   * Metrics with `showCounts` (hit rate): the summed numerator and
   * denominator of the current total, over the clients summed in it. The KPI
   * tile shows "W of n noun" under the value.
   */
  counts?: { part: number; whole: number; noun: string };
  /**
   * Aligned with WidgetResult.buckets. Absent for grain "total" and for
   * not_connected cells (no line at all). Other non-ok cells keep the values
   * of unaffected buckets (fx_missing nulls only the months without a rate),
   * so a line breaks exactly where the gap is.
   */
  points?: Array<number | null>;
  /** Aligned with buckets by position. Absent without a comparison, for grain "total" and for not_connected cells. */
  comparePoints?: Array<number | null>;
  /** Below the metric's minVolume share of the largest series. */
  lowVolume?: boolean;
  /**
   * Rollups only: clients summed into the current total vs selected ("4 of 5
   * clients"). A client is left out when it is not connected for the metric
   * or when its own cell for the period is a gap, fx_missing or not_measured.
   */
  coverage?: { included: number; of: number };
  /** Rollups only: the clients left out of the current total, with their own status words ("Missing days"). Absent when none. */
  excluded?: Array<{ id: string; name: string; reason: string }>;
  /** Rollups with buckets only: clients summed into each current point (out of `coverage.of`), aligned with `points`. */
  pointCoverage?: number[];
}

export type SeriesKind = "client" | "combined" | "vertical";

/** Series id of a combined rollup. Client series use the client id. */
export const COMBINED_SERIES_ID = "combined";
/** Vertical key for clients without an open ref.client_verticals row. */
export const UNASSIGNED_VERTICAL = "unassigned";
/** Series id of a vertical rollup. */
export function verticalSeriesId(vertical: string): string {
  return `vertical:${vertical}`;
}

export interface ResultSeries {
  /** Client id, COMBINED_SERIES_ID, or verticalSeriesId(vertical). */
  id: string;
  /** Client name, "All clients", or the vertical key. */
  label: string;
  /** Colour slot 0..SERIES_SLOTS-1. Client: ReportClient.slot. Combined: 0. Vertical: sorted index mod SERIES_SLOTS. */
  slot: number;
  kind: SeriesKind;
  /** Caveats that apply to this client (union over included clients for rollups). Render intersects with the metric's caveats. */
  caveats: CaveatId[];
  /** Rollups only: the client ids included. */
  clientIds?: string[];
  /** One entry per requested metric. */
  cells: Partial<Record<MetricId, MetricCell>>;
}

export type BenchmarkStat = "median" | "mean" | "p25" | "p75";

export interface BenchmarkMatch {
  metricId: MetricId;
  vertical: string;
  region: string;
  stat: BenchmarkStat;
  /**
   * "ok": draw it. "stale": as_of older than 12 months, draw muted with "Stale".
   * "no_fx": money benchmark with no rate for the period_end month; hidden, the hover says why.
   */
  status: "ok" | "stale" | "no_fx";
  /** Percent as a fraction, ratio as x, money in WidgetResult.currency. Null only when status is no_fx. */
  value: number | null;
  low: number | null;
  high: number | null;
  source: string;
  sourceUrl: string | null;
  /** `YYYY-MM-DD`. */
  asOf: string;
  period: DateRange;
  /** definition_note, e.g. "Revenue ex VAT; blended paid". */
  note: string | null;
  /** Client ids whose vertical and region this row was matched for. */
  appliesTo: string[];
  benchmarkId: string;
}

export type ResultWarning = { code: "fx_missing"; months: string[] } | { code: "range_clamped" } | { code: "currency_coerced" };

export interface WidgetResult {
  /** Compiled query key; the browser LRU key. */
  key: string;
  /** ISO timestamp of the BigQuery run (or of the cached run). */
  generatedAt: string;
  cached: boolean;
  /** ISO code actually used, never "native": a DisplayCurrency, or the shared trading currency when "native" resolved to it. */
  currency: string;
  grain: QueryGrain;
  current: DateRange;
  comparison: DateRange | null;
  /** Bucket start dates `YYYY-MM-DD`, built in TypeScript so a missing bucket is a gap. Empty for grain "total". */
  buckets: string[];
  /** Indexes into buckets that are partial weeks or months. */
  partialBuckets: number[];
  series: ResultSeries[];
  /** Empty when the benchmark switch is off or nothing matched. */
  benchmarks: BenchmarkMatch[];
  warnings: ResultWarning[];
}
