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
 * `mart_meta_ad_perf` (added 2026-10-04, semantic version 5). The only ids a
 * widget query accepts.
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

/** A queryable metric id. */
export type MetricId = (typeof METRIC_IDS)[number];
/** A reserved, not yet queryable id. */
export type Phase2MetricId = (typeof PHASE2_METRIC_IDS)[number];
/** Any id the registry may hold a definition for. */
export type RegistryMetricId = MetricId | Phase2MetricId;

const QUERYABLE: ReadonlySet<string> = new Set(METRIC_IDS);
const REGISTERED: ReadonlySet<string> = new Set(REGISTRY_METRIC_IDS);

/** True for a queryable metric id. */
export function isMetricId(value: unknown): value is MetricId {
  return typeof value === "string" && QUERYABLE.has(value);
}

/** True for any id the registry may define, reserved phase 2 ids included. */
export function isRegistryMetricId(value: unknown): value is RegistryMetricId {
  return typeof value === "string" && REGISTERED.has(value);
}
