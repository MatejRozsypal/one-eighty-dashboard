/**
 * Metric ids: a permanent contract.
 *
 * `ref.industry_benchmarks.metric_id` and every saved widget config refer to
 * these strings. Rules:
 * - Append only. Never reorder, never remove, never rename.
 * - A rename adds the new id here and keeps the old one in the metric's
 *   `aliases` with `deprecated: true` (registry/metrics.ts).
 * - Phase 2 ids are reserved below. When a phase 2 metric ships, move its id
 *   from PHASE2_METRIC_IDS to the end of METRIC_IDS in the same commit that
 *   adds its mart to the compiler.
 *
 * Pure module: no imports, safe for the browser bundle.
 */

/**
 * Queryable metrics: the 30 phase-1 metrics read from `mart_daily_kpis`, then
 * the Meta soft metrics read from `mart_meta_campaign_perf` and
 * `mart_meta_ad_perf` (added 2026-10-04, semantic version 5), then the
 * creative hit rate read from `mart.rpt_ad_launch` (2026-10-05, version 7),
 * then the cohort retention rates read from `mart.rpt_customer_entry`
 * (2026-10-05, version 8).
 * The only ids a widget query accepts.
 */
export const METRIC_IDS = [
  // Profitability
  "revenue",
  "net_sales",
  "orders",
  "aov",
  "cogs",
  "cm1_pct",
  "cm3",
  "cm3_pct",
  // Acquisition
  "paid_spend",
  "mer",
  "amer",
  "cac",
  "new_customers",
  "aov_new",
  "new_revenue_share",
  // Retention (period based)
  "returning_orders",
  "returning_order_share",
  "returning_revenue_share",
  "aov_returning",
  // Meta
  "meta_spend",
  "meta_roas",
  "meta_ctr",
  "meta_cpc",
  "meta_cpm",
  "meta_cpa",
  "meta_spend_share",
  // Google
  "google_spend",
  "google_roas",
  "google_ctr",
  "google_cpc",
  // Meta soft metrics (campaign and ad marts). meta_atc_rate was reserved in phase 2 and never queryable.
  "meta_cost_per_lpv",
  "meta_lpv",
  "meta_link_ctr",
  "meta_cpc_link",
  "meta_add_to_cart",
  "meta_cost_per_atc",
  "meta_atc_rate",
  "meta_atc_to_purchase",
  "meta_initiate_checkout",
  "meta_cost_per_ic",
  "meta_hook_rate",
  "meta_hold_rate",
  "meta_frequency",
  "meta_conversion_rate",
  // Creative hit rate (launch cohorts, mart.rpt_ad_launch), added 2026-10-05, semantic version 7.
  "hit_rate",
  "winners",
  "ads_launched",
  // Cohort retention (customer entry, mart.rpt_customer_entry), added 2026-10-05, semantic version 8.
  "repeat_rate_90",
  "repeat_rate_180",
  "repeat_rate_365",
  "third_order_rate_180",
  "discovery_upgrade_90",
  "discovery_upgrade_180",
  "discovery_entry_share",
] as const;

/** Phase 2, reserved: defined in the registry, not yet queryable. */
export const PHASE2_METRIC_IDS = [
  "email_revenue",
  "email_open_rate",
  "email_click_rate",
  "email_rev_per_email",
] as const;

/** Every id the registry may define (phase 1 and reserved phase 2). */
export const REGISTRY_METRIC_IDS = [...METRIC_IDS, ...PHASE2_METRIC_IDS] as const;

/**
 * Benchmark-only ids (added 2026-10-15, migration 295 seed). Known to
 * `ref.industry_benchmarks` and the Markets page, but Reports has no metric
 * that computes them (no sessions, payment method or returns component in any
 * mart), so they are neither queryable nor in the metric registry and can
 * never be benchmarked in a widget. Registering them here only stops Data
 * Health from listing them as unknown ids. Definitions: BENCHMARK_ONLY_METRICS
 * in registry/metrics.ts. To make one benchmarkable, add the mart component and
 * a metric, then move the id to the end of METRIC_IDS (append only).
 */
export const BENCHMARK_ONLY_METRIC_IDS = ["cvr", "cod_share", "return_rate"] as const;

/** Every metric_id a row of `ref.industry_benchmarks` may carry without being unknown. */
export const KNOWN_BENCHMARK_METRIC_IDS = [...REGISTRY_METRIC_IDS, ...BENCHMARK_ONLY_METRIC_IDS] as const;

/** A queryable metric id. */
export type MetricId = (typeof METRIC_IDS)[number];
/** A reserved, not yet queryable id. */
export type Phase2MetricId = (typeof PHASE2_METRIC_IDS)[number];
/** Any id the registry may hold a definition for. */
export type RegistryMetricId = MetricId | Phase2MetricId;
/** An id known to the benchmark table only: not queryable, no registry metric. */
export type BenchmarkOnlyMetricId = (typeof BENCHMARK_ONLY_METRIC_IDS)[number];

const QUERYABLE: ReadonlySet<string> = new Set(METRIC_IDS);
const REGISTERED: ReadonlySet<string> = new Set(REGISTRY_METRIC_IDS);
const KNOWN_BENCHMARK: ReadonlySet<string> = new Set(KNOWN_BENCHMARK_METRIC_IDS);

/** True for a queryable metric id. */
export function isMetricId(value: unknown): value is MetricId {
  return typeof value === "string" && QUERYABLE.has(value);
}

/** True for any id the registry may define, reserved phase 2 ids included. */
export function isRegistryMetricId(value: unknown): value is RegistryMetricId {
  return typeof value === "string" && REGISTERED.has(value);
}

/**
 * True for any metric_id that is not "unknown" on Data Health: queryable,
 * reserved phase 2, or benchmark-only. Reports itself still only uses
 * `isMetricId` (the matcher skips everything else).
 */
export function isKnownBenchmarkMetricId(value: unknown): value is RegistryMetricId | BenchmarkOnlyMetricId {
  return typeof value === "string" && KNOWN_BENCHMARK.has(value);
}
