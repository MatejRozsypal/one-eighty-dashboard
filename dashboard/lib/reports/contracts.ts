/**
 * Cross-package contracts of the Reports suite: the function signatures each
 * work package implements and the intermediate types that flow between them.
 *
 *   route:  gate -> parse -> getReportClients -> resolveWidget -> compileWidget
 *           -> runCached -> getBenchmarks -> evaluateWidget -> Response.json
 *
 * Pure module. Type-only imports (erased at build), plus a few constants and
 * one error class, so a browser component may import it without pulling in a
 * server module.
 *
 * How implementers conform: declare each export with its contract type, e.g.
 *     export const resolveWidget: ResolveWidget = (input) => { ... };
 * or check the whole module where it is integrated:
 *     import * as resolve from "@/lib/reports/resolve";
 *     const _conforms: ResolveModule = resolve;
 *
 * Design: 11_reporting_suite_design.md sections 2.7 to 2.11, 3.1 to 3.5, 4.1.
 * Owner: RS0 (contracts). The owning package of each signature is named in its
 * section header and in lib/reports/README.md.
 */

import type { Access } from "@/lib/authz";
import type { ClientCapabilities } from "@/lib/clients";
import type { DateRange, ResolvedPeriod } from "@/lib/period";
import type { Role } from "@/lib/users/store";
import type { MetricId } from "./registry/ids";
import type {
  CapExpr,
  Capability,
  ComponentId,
  MartId,
  QueryGrain,
  ReportCapabilities,
  ReportClient,
} from "./registry/types";
import type {
  BenchmarkMatch,
  BenchmarkStat,
  LayoutItem,
  ReportErrorCode,
  ReportFilters,
  ResultWarning,
  Visibility,
  WidgetConfig,
  WidgetQuery,
  WidgetResult,
  WidgetType,
} from "./types";

// ===========================================================================
// Access gate (WP3, lib/authz.ts)
// ===========================================================================

/**
 * Roles allowed into Reports. Owner decision: all internal staff (admin and
 * agency) with an internal email domain; never the client role. lib/authz.ts
 * imports this constant rather than restating it, and so does the rail (WP5).
 */
export const REPORTS_ROLES = ["admin", "agency"] as const satisfies readonly Role[];

/** True only for a REPORTS_ROLES role AND an email in ALLOWED_EMAIL_DOMAIN (default oneeighty.cz). */
export type CanUseReports = (access: Access | null) => access is Access;
/** Pages and layouts: redirect("/snapshot") plus a console.warn "[authz]" on failure. */
export type RequireReportsAccess = () => Promise<Access>;
/** Route handlers: null on failure, the caller answers 404 with an empty body. */
export type ReportsAccessOrNull = () => Promise<Access | null>;
/** Server actions and lib functions: throws Error("Not authorised.") on failure. */
export type AssertReportsAccess = () => Promise<Access>;

export interface ReportsAuthzModule {
  canUseReports: CanUseReports;
  requireReportsAccess: RequireReportsAccess;
  reportsAccessOrNull: ReportsAccessOrNull;
  assertReportsAccess: AssertReportsAccess;
}

// ===========================================================================
// Errors (thrown by WP2 and WP4, mapped by WP3 and the actions)
// ===========================================================================

/**
 * The one error type that crosses package boundaries. `message` is a short,
 * user-safe line; the underlying BigQuery or Postgres error goes in `cause`
 * and is logged, never returned.
 */
export class ReportsError extends Error {
  readonly code: ReportErrorCode;
  readonly suggestion?: string;

  constructor(code: ReportErrorCode, message?: string, options?: { suggestion?: string; cause?: unknown }) {
    super(message ?? code, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ReportsError";
    this.code = code;
    this.suggestion = options?.suggestion;
  }
}

export function isReportsError(error: unknown): error is ReportsError {
  return error instanceof ReportsError;
}

// ===========================================================================
// Capabilities (WP1, lib/reports/registry/capabilities.ts)
// ===========================================================================

/** ClientCapabilities (lib/clients.ts) plus the derived shop and email flags. */
export type ToReportCapabilities = (caps: ClientCapabilities) => ReportCapabilities;
export type EvalCapExpr = (expr: CapExpr, caps: ReportCapabilities) => boolean;
/** The leaf capabilities that make `expr` false, deduplicated, for "Meta not connected". */
export type MissingCapabilities = (expr: CapExpr, caps: ReportCapabilities) => Capability[];

export interface CapabilitiesModule {
  toReportCapabilities: ToReportCapabilities;
  evalCapExpr: EvalCapExpr;
  missingCapabilities: MissingCapabilities;
}

// ===========================================================================
// Clients (WP3, lib/reports/clients.ts)
// ===========================================================================

/**
 * Active, non-demo clients from ref.clients (has_woocommerce NULL = false)
 * joined to the open ref.client_verticals row. Sorted by id, `slot` assigned.
 * Calls assertReportsAccess() first. Cached 5 minutes, tag "reports-ref".
 */
export type GetReportClients = () => Promise<ReportClient[]>;

export interface ClientsModule {
  getReportClients: GetReportClients;
}

// ===========================================================================
// Resolve (WP1, lib/reports/resolve.ts)
// ===========================================================================

/** Widget override where set, else the report filter. Pure; the UI uses it for override chips too. */
export type MergeFilters = (report: ReportFilters, overrides: Partial<ReportFilters>) => ReportFilters;

export interface ResolveInput {
  /** Report-level filters (URL overrides already applied). */
  filters: ReportFilters;
  query: WidgetQuery;
  /** From getReportClients(). */
  clients: readonly ReportClient[];
  /** `YYYY-MM-DD`, UTC. Defaults to todayUtc(); injectable for tests. */
  today?: string;
}

export interface ClientMetricAvailability {
  ok: boolean;
  /** Empty when ok. */
  missing: Capability[];
}

export interface ResolvedWidget {
  query: WidgetQuery;
  /** Merged filters (mergeFilters(report, query.overrides)). */
  filters: ReportFilters;
  /** Selected clients after list/vertical/all resolution, unknown ids dropped, sorted by id. */
  clients: ReportClient[];
  /** Clients with at least one connected metric, sorted. The only ids sent to BigQuery. */
  queryClientIds: string[];
  /** Clamped current range and its comparison (null when compare is none). */
  period: ResolvedPeriod;
  /** scanBounds(period): the outer dates the query reads. */
  scan: DateRange;
  grain: QueryGrain;
  /** ISO code, never "native". */
  displayCurrency: string;
  /** Union of the metrics' components, sorted. */
  components: ComponentId[];
  /** Marts touched, sorted. Phase 1: always ["kpis"]. */
  marts: MartId[];
  /** availability[clientId][metricId]: false marks the cell not_connected. */
  availability: Record<string, Partial<Record<MetricId, ClientMetricAvailability>>>;
  /** range_clamped and currency_coerced, if they happened. */
  warnings: ResultWarning[];
}

/** A broken limit (lib/reports/limits.ts). Route answers 413 too_large. */
export interface LimitViolation {
  code: "too_large";
  limit: "span" | "points" | "metrics" | "widgets";
  message: string;
  /** e.g. "Use week grain". */
  suggestion?: string;
}

export type ResolveOutcome = { ok: true; widget: ResolvedWidget } | { ok: false; error: LimitViolation };

/** Pure. Never touches BigQuery or the session. */
export type ResolveWidget = (input: ResolveInput) => ResolveOutcome;

export interface ResolveModule {
  mergeFilters: MergeFilters;
  resolveWidget: ResolveWidget;
}

// ===========================================================================
// Compile (WP2, lib/reports/compile.ts)
// ===========================================================================

export type BqParamType = "STRING" | "DATE" | "INT64" | "BOOL" | ["STRING"];

/** Bucket value the SQL emits for grain "total". */
export const TOTAL_BUCKET = "1970-01-01";

export interface CompiledQuery {
  /** sha256 hex of JSON {sv: SEMANTIC_VERSION, sql, params}. Deterministic: sorted ids and components. */
  key: string;
  /** Built only from registry constants; every user value is a param. */
  sql: string;
  /** clientIds: string[]; curFrom, curTo, cmpFrom, cmpTo, scanFrom, scanTo: `YYYY-MM-DD`; displayCurrency. */
  params: Record<string, string | string[]>;
  types: Record<string, BqParamType>;
  marts: MartId[];
  components: ComponentId[];
  /** False compiles the variant without the comparison clause. */
  hasComparison: boolean;
}

/** Pure apart from hashing. Throws if any mart CTE lacks its date predicate. */
export type CompileWidget = (widget: ResolvedWidget) => CompiledQuery;

export interface CompileModule {
  compileWidget: CompileWidget;
}

// ===========================================================================
// Run (WP2, lib/reports/run.ts)
// ===========================================================================

/** One component's raw SUM for a (client, period, bucket). For non-money components nat === disp. */
export interface ComponentSum {
  /** Rows whose currency equals the client's registry currency only. */
  nat: number | null;
  /** Every row converted per month into the display currency. Raw: the evaluator nulls it on fx_missing. */
  disp: number | null;
}

/** Per-mart row guards from the SQL (design 2.8). */
export interface MartGuards {
  nRows: number;
  foreignCcyRows: number;
  fxMissingRows: number;
  /** `YYYY-MM-01`. */
  fxMissingMonths: string[];
}

/**
 * One SQL result row, normalised by run.ts so the evaluator never depends on
 * column aliases: BigQuery NUMERIC and BIGNUMERIC become number, DATE becomes
 * `YYYY-MM-DD`, and components are keyed by ComponentId.
 */
export interface ComponentRow {
  clientId: string;
  period: "cur" | "cmp";
  /** Bucket start `YYYY-MM-DD`; TOTAL_BUCKET for grain "total". */
  bucket: string;
  guards: Partial<Record<MartId, MartGuards>>;
  values: Partial<Record<ComponentId, ComponentSum>>;
}

export interface RunContext {
  /** Chooses the TTL: 15 min within 2 days of yesterday, 1 h within 7 days, 6 h older. */
  rangeTo: string;
  /** Job label `user` = sha1(email).slice(0, 8). */
  userEmail: string;
  /** Job label `widget_type`. */
  widgetType?: WidgetType;
}

export interface RunResult {
  rows: ComponentRow[];
  cached: boolean;
  /** ISO timestamp of the BigQuery run that produced the rows. */
  generatedAt: string;
}

/**
 * unstable_cache wrapper with in-flight dedupe, maximumBytesBilled, a 20 s job
 * timeout and labels. Calls assertReportsAccess() before any cache read.
 * Throws ReportsError with code over_budget, timeout or warehouse_error.
 */
export type RunCached = (query: CompiledQuery, ctx: RunContext) => Promise<RunResult>;

export interface RunModule {
  runCached: RunCached;
}

// ===========================================================================
// Benchmarks (WP3 loads, lib/reports/benchmarks.ts; WP1 matches, lib/reports/benchmarkMatch.ts)
// ===========================================================================

/** One active row of ref.industry_benchmarks (migration 250), camelCased. */
export interface BenchmarkRow {
  benchmarkId: string;
  vertical: string;
  /** "CZ" | "CEE" | "EU" | "US" | "GLOBAL". */
  region: string;
  /** Raw string: unknown ids are skipped by the matcher and flagged on Data Health. */
  metricId: string;
  periodStart: string;
  periodEnd: string;
  stat: BenchmarkStat;
  /** Percent as a fraction, ratio as x, money in `currency`. */
  value: number;
  valueLow: number | null;
  valueHigh: number | null;
  /** Required for money metrics, null otherwise. */
  currency: string | null;
  source: string;
  sourceUrl: string | null;
  asOf: string;
  definitionNote: string | null;
  sampleNote: string | null;
  note: string | null;
}

/** One row of ref.fx_rates. */
export interface FxRate {
  /** `YYYY-MM-01`. */
  monthStart: string;
  from: string;
  to: string;
  rate: number;
}

/** Active rows only. Cached 6 h, tags "reports-ref" and "benchmarks". Starts empty (owner decision). */
export type GetBenchmarkRows = () => Promise<BenchmarkRow[]>;
/** Cached 6 h, tag "reports-ref". */
export type GetFxRates = () => Promise<FxRate[]>;
/** [] when widget.filters.benchmark is false; otherwise loads rows and FX and calls matchBenchmarks. */
export type GetBenchmarks = (widget: ResolvedWidget) => Promise<BenchmarkMatch[]>;

export interface BenchmarksModule {
  getBenchmarkRows: GetBenchmarkRows;
  getFxRates: GetFxRates;
  getBenchmarks: GetBenchmarks;
}

export interface MatchBenchmarksInput {
  rows: readonly BenchmarkRow[];
  fx: readonly FxRate[];
  widget: ResolvedWidget;
  /** For staleness. Defaults to todayUtc(). */
  today?: string;
}

/**
 * Pure. For each benchmarkable metric and each vertical among the widget's
 * clients: candidates by (vertical, metric_id), falling back to
 * BENCHMARK_POLICY.allVertical; region = the client's region, then EU, then
 * GLOBAL; most overlapping days with the current range, else the latest
 * period_end within 18 months before it; ties by latest as_of. Money rows are
 * converted to the display currency at the period_end month (no rate: status
 * "no_fx").
 */
export type MatchBenchmarks = (input: MatchBenchmarksInput) => BenchmarkMatch[];

export interface BenchmarkMatchModule {
  matchBenchmarks: MatchBenchmarks;
}

// ===========================================================================
// Evaluate (WP1, lib/reports/evaluate.ts)
// ===========================================================================

export interface EvaluateInput {
  widget: ResolvedWidget;
  rows: readonly ComponentRow[];
  benchmarks: readonly BenchmarkMatch[];
  run: Pick<RunResult, "cached" | "generatedAt"> & { key: string };
}

/**
 * Pure. Builds buckets in TypeScript, applies row guards (FX nulling, foreign
 * currency caveat, COGS zero guard), picks native or display sums per fxMode,
 * evaluates terms from summed components, rolls up, computes deltas and sets
 * each cell's status by CELL_STATUS_PRECEDENCE.
 */
export type EvaluateWidget = (input: EvaluateInput) => WidgetResult;

export interface EvaluateModule {
  evaluateWidget: EvaluateWidget;
}

// ===========================================================================
// Persistence (WP4, lib/reports/store.ts, templates.ts, app/(app)/reports/actions.ts)
// ===========================================================================

export const TEMPLATE_KEYS = ["blank", "portfolio_overview", "paid_efficiency", "retention_mix"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface TemplateWidget {
  type: WidgetType;
  config: WidgetConfig;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Code-defined starting points (lib/reports/templates.ts). */
export interface ReportTemplate {
  key: TemplateKey;
  name: string;
  filters: ReportFilters;
  widgets: TemplateWidget[];
}

export interface ReportMeta {
  id: string;
  name: string;
  /** Lower-cased. */
  ownerEmail: string;
  visibility: Visibility;
  filters: ReportFilters;
  /** Optimistic concurrency token, bumped on every write. */
  version: number;
  templateKey: TemplateKey | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  deletedAt: string | null;
}

export interface ReportPermissions {
  /** Owner, or visibility is not private. */
  canView: boolean;
  /** Owner, or visibility is team_edit. */
  canEdit: boolean;
  /** Only the owner changes visibility or deletes. */
  isOwner: boolean;
}

export interface ReportListItem extends ReportMeta {
  widgetCount: number;
  pinned: boolean;
  pinPosition: number;
  lastOpenedAt: string | null;
  permissions: ReportPermissions;
}

export interface StoredWidget {
  id: string;
  reportId: string;
  type: WidgetType;
  /** Null when the stored JSON fails WidgetConfig: render "Widget outdated" with Remove and Reset. */
  config: WidgetConfig | null;
  /** The stored JSON as read, for Reset and diagnostics. */
  rawConfig: unknown;
  x: number;
  y: number;
  w: number;
  h: number;
  updatedAt: string;
}

export interface ReportWithWidgets {
  report: ReportMeta;
  widgets: StoredWidget[];
  permissions: ReportPermissions;
  pinned: boolean;
  lastOpenedAt: string | null;
}

export type StoreFailureCode = "conflict" | "not_found" | "forbidden" | "invalid";

/**
 * Result of every write. `version` is the report's version after the write.
 * A conflict also returns the current server version so the client can reload.
 */
export type StoreResult<T extends object = Record<never, never>> =
  | ({ ok: true; version: number } & T)
  | { ok: false; code: StoreFailureCode; message?: string; version?: number };

export interface NewWidget {
  /**
   * Optional client-chosen uuid. The canvas creates a widget (or restores one
   * after an undo) before the save returns, so the page supplies the id and the
   * layout save that follows can name it. Absent: the database picks one.
   */
  id?: string;
  type: WidgetType;
  config: WidgetConfig;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pure: canView / canEdit / isOwner for an email (compared lower-cased). */
export type ReportPermissionsFor = (report: Pick<ReportMeta, "ownerEmail" | "visibility">, email: string) => ReportPermissions;

/**
 * lib/reports/store.ts. Every function calls assertReportsAccess() itself and
 * acts as that user; none takes the actor as a parameter. Lazy DDL with its own
 * ensureTable(), never in the shared ensureSchema. Multi-row writes run in
 * withTransaction() and start with the versioned UPDATE on reports.
 */
export interface ReportStore {
  reportPermissions: ReportPermissionsFor;
  /** "mine": owned by the caller. "team": visibility not private. Pinned first, then last opened, then updated_at. */
  listReports(scope: "mine" | "team"): Promise<ReportListItem[]>;
  /** Null when missing, deleted, or not visible to the caller. */
  getReport(id: string): Promise<ReportWithWidgets | null>;
  createReport(input: { name: string; templateKey?: TemplateKey; filters?: ReportFilters }): Promise<StoreResult<{ id: string }>>;
  renameReport(id: string, name: string): Promise<StoreResult>;
  duplicateReport(id: string): Promise<StoreResult<{ id: string }>>;
  /** Soft delete, owner only. */
  deleteReport(id: string): Promise<StoreResult>;
  restoreReport(id: string): Promise<StoreResult>;
  /** Owner only. */
  setVisibility(id: string, visibility: Visibility): Promise<StoreResult>;
  saveReportFilters(id: string, expectedVersion: number, filters: ReportFilters): Promise<StoreResult>;
  /** One transaction for all items. */
  saveLayout(id: string, expectedVersion: number, items: LayoutItem[]): Promise<StoreResult>;
  addWidget(id: string, expectedVersion: number, widget: NewWidget): Promise<StoreResult<{ widgetId: string }>>;
  updateWidget(id: string, expectedVersion: number, widgetId: string, config: WidgetConfig): Promise<StoreResult>;
  removeWidget(id: string, expectedVersion: number, widgetId: string): Promise<StoreResult>;
  pinReport(id: string, pinned: boolean): Promise<StoreResult>;
  /** Fire and forget. Also writes the access_log row "report:<id> clients=<ids>". */
  touchOpened(id: string): Promise<void>;
}

/** Shape server actions return to the client (design 3.3). */
export type ActionResult<T extends object = Record<never, never>> = StoreResult<T>;

/**
 * app/(app)/reports/actions.ts. Each action: assertReportsAccess(), zod parse
 * of every argument (the inputs are untrusted), permission check, store call,
 * revalidatePath("/reports") when the list changes.
 */
export interface ReportActions {
  createReport(input: { name: string; templateKey?: TemplateKey }): Promise<ActionResult<{ id: string }>>;
  renameReport(id: string, name: string): Promise<ActionResult>;
  duplicateReport(id: string): Promise<ActionResult<{ id: string }>>;
  deleteReport(id: string): Promise<ActionResult>;
  restoreReport(id: string): Promise<ActionResult>;
  setVisibility(id: string, visibility: Visibility): Promise<ActionResult>;
  saveReportFilters(id: string, expectedVersion: number, filters: ReportFilters): Promise<ActionResult>;
  saveLayout(id: string, expectedVersion: number, items: LayoutItem[]): Promise<ActionResult>;
  addWidget(id: string, expectedVersion: number, widget: NewWidget): Promise<ActionResult<{ widgetId: string }>>;
  updateWidget(id: string, expectedVersion: number, widgetId: string, config: WidgetConfig): Promise<ActionResult>;
  removeWidget(id: string, expectedVersion: number, widgetId: string): Promise<ActionResult>;
  pinReport(id: string, pinned: boolean): Promise<ActionResult>;
  touchOpened(id: string): Promise<void>;
  /** revalidateTag("reports"), at most once per REFRESH_RATE_LIMIT_MS per user. */
  refreshReportData(): Promise<ActionResult>;
}
