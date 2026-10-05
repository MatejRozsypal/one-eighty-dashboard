/**
 * Semantic layer types: marts, components, metrics, caveats, capabilities.
 *
 * Pure module: type declarations plus one constant. No `server-only`, no
 * project id, no BigQuery. The metric and client pickers import the registry
 * in the browser, so everything under `lib/reports/registry/` stays pure.
 *
 * Design: 11_reporting_suite_design.md section 2.2. Owner: RS0 (contracts).
 * Implementations: registry/components.ts, metrics.ts, caveats.ts,
 * capabilities.ts (WP1).
 */

import type { CreativeThresholds } from "@/lib/creative/stats";
import type { RegistryMetricId } from "./ids";

export type { MetricId, Phase2MetricId, RegistryMetricId } from "./ids";

/**
 * Part of every cache key. Bump it whenever a formula, a component column or
 * an evaluation rule changes, so no cached result outlives its definition.
 */
export const SEMANTIC_VERSION = 9;

export type MartId = "kpis" | "meta_campaign" | "meta_ad" | "email_campaign" | "ad_launch" | "customer_entry";
export type Grain = "day" | "week" | "month";
export type QueryGrain = Grain | "total";
export type Unit = "money" | "count" | "ratio" | "percent";
export type GoodWhen = "up" | "down" | "neutral";
export type MetricGroup = "profitability" | "acquisition" | "retention" | "meta" | "creative" | "google" | "email";

/** Picker order of the groups. */
export const METRIC_GROUP_ORDER: readonly MetricGroup[] = [
  "profitability",
  "acquisition",
  "retention",
  "meta",
  "creative",
  "google",
  "email",
];

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/** Registry flags (has_*), plus two derived ones. */
export type Capability =
  | "shopify"
  | "shoptet"
  | "woocommerce"
  | "meta"
  | "googleAds"
  | "klaviyo"
  | "ecomail"
  | "ga4"
  /** shopify || shoptet || woocommerce */
  | "shop"
  /** klaviyo || ecomail */
  | "email";

export type CapExpr = Capability | { all: CapExpr[] } | { any: CapExpr[] };

/**
 * Capability flags of one report client. NULL registry flags are false.
 * `shop` and `email` are derived by `lib/reports/clients.ts`, never stored.
 */
export type ReportCapabilities = Readonly<Record<Capability, boolean>>;

export type ShopPlatform = "shopify" | "shoptet" | "woocommerce";

/**
 * One client as Reports sees it. Built by `getReportClients()` from
 * `ref.clients` (active, non-demo) joined to the open row of
 * `ref.client_verticals`. Never built from `resolveClient()`.
 */
export interface ReportClient {
  /** `ref.clients.client_id`, matches /^[a-z0-9_]{1,40}$/. */
  id: string;
  name: string;
  /** Trading currency per the registry; the "native" currency of its series. */
  currency: string;
  shopPlatform: ShopPlatform | null;
  capabilities: ReportCapabilities;
  /** Open `ref.client_verticals` row; null when the client has none yet. */
  vertical: string | null;
  subVertical: string | null;
  /**
   * Primary market for benchmark matching: `ref.client_verticals.region`,
   * falling back to `ref.clients.country`, null when neither is set.
   */
  region: string | null;
  /** Colour slot: index in the alphabetical list of all active clients, mod SERIES_SLOTS. */
  slot: number;
  /**
   * Per-order costs the client stated in Settings (Postgres `client_settings`),
   * in the client's trading currency. Merged in per request by the query route,
   * never part of SQL or a cache key, so a Settings edit applies at once.
   * Absent or null means unstated and counts as 0, exactly like Snapshot.
   */
  costRates?: Readonly<Partial<Record<CostRateKey, number | null>>>;
  /**
   * Creative thresholds the client set in Settings (Postgres
   * `creative_settings`, `toThresholds()`), the bar a launched ad must clear
   * to be a winner. Merged in per request by the query route like
   * `costRates`, never part of SQL or a cache key, so a Settings edit applies
   * at once. Absent or null: no thresholds, and every hit-rate cell of the
   * client is not_measured "No thresholds".
   */
  creativeThresholds?: CreativeThresholds | null;
}

/** Stated per-order costs (Settings): fulfilment (CM2 and CM3) and other CM1 costs. */
export type CostRateKey = "fulfilment" | "otherCm1";

// ---------------------------------------------------------------------------
// Marts and components
// ---------------------------------------------------------------------------

export interface MartDef {
  id: MartId;
  /** dataset.table. PROJECT_ID is prefixed server-side in compile.ts only. */
  table: string;
  /** Always filtered with BETWEEN; the partition proxy. */
  dateColumn: string;
  /** Row currency column used for FX; null = no money columns. */
  currencyColumn: string | null;
  grains: readonly Grain[];
  phase: 1 | 2;
  /**
   * Money is in the ad account's currency, which may differ from the client's
   * trading currency by design (an EUR shop with a CZK Meta account). Such
   * rows are converted per month like any other row, but they are expected,
   * so they do not raise the `foreign_currency_rows` caveat. The row count is
   * still returned: the evaluator needs it to know the native sum is partial.
   */
  accountCurrency?: true;
  /**
   * Shared query: the compiler selects every component of this mart, not only
   * the widget's, so widgets with the same clients, period, grain and currency
   * compile to byte-identical SQL and share one cache entry and one in-flight
   * BigQuery job. Evaluation reads only the metric's components.
   */
  selectAll?: true;
  /**
   * Entity mart (one row per entity, an ad): rows are classified one by one
   * before they are summed, because a per-ad verdict cannot be expressed as a
   * component sum. The compiler groups by the entity key as well, selects
   * every input component of the mart with ANY_VALUE and leaves out rows
   * where any `exclude` column is TRUE. The evaluator maps each entity row
   * through the classifier into its `classified` components (plain 0/1
   * counts), so bucketing, rollups, comparisons and coverage apply unchanged.
   * Thresholds never reach SQL or the cache key.
   */
  entity?: EntityDef;
  /**
   * Row filter on BOOL columns: rows where any `excludeTrue` column is TRUE are
   * left out of every sum (`AND t.<col> IS NOT TRUE` in the CTE, asserted with
   * the date predicate). The customer entry mart leaves out early customers,
   * whose first order may predate the data start (retention design 1.7).
   */
  rowFilter?: { excludeTrue: readonly string[] };
}

/** Classifiers of entity marts, implemented in evaluate.ts. */
export type EntityClassifier = "creative_hit";

export interface EntityDef {
  /** Entity key column (`ad_id`). */
  key: string;
  classifier: EntityClassifier;
  /** BOOL columns: a row where any is TRUE is not an entity of this mart (pre-existing ads, relaunches). */
  exclude: readonly string[];
}

export type ComponentId = `${MartId}.${string}`;

export interface ComponentDef {
  id: ComponentId;
  mart: MartId;
  /**
   * Physical column. Must match /^[a-z_][a-z0-9_]*$/ (checked at module load).
   * Equals the part of the id after the dot unless the spec names another
   * column (a filtered variant such as `meta_ad.video_impressions`).
   */
  column: string;
  /** Money components are emitted twice: native (client currency) and display currency. */
  money: boolean;
  requires: CapExpr;
  /**
   * What a NULL in this column on a mart row means. The daily KPI view
   * FULL OUTER JOINs the shop side and the ad platforms, so a row exists for a
   * day when either side has data.
   * - "gap": the value is missing (ad rows absent for that day, uncosted order
   *   lines). A bucket, total or rollup that contains such a row has no value
   *   for any term that treats the component as a gap, never a partial sum.
   * - "zero": nothing happened (no orders that day, a campaign with no events).
   *   NULL adds 0 and is never a gap.
   * Components with `zeroIsMissingWhen` count a NULL only on rows where the
   * guard component is > 0 (COGS on a day with revenue).
   */
  nullMeans: "gap" | "zero";
  /**
   * Ad-platform outcomes (purchase value, purchases, clicks, impressions): the
   * spend component of the same platform and mart whose NULL marks a day as
   * missing. Only those rows are counted as gaps for this component; a NULL in
   * this column itself on a day with spend is zero (no conversions or no
   * delivery that day, which is how the mart encodes it). Owner rule
   * 2026-10-04: a gap is only ever triggered by missing spend.
   */
  missingWhenNull?: ComponentId;
  /** A summed 0 is "not measured" when this guard component is > 0 (COGS on positive revenue). */
  zeroIsMissingWhen?: ComponentId;
  /**
   * Row filter: only rows where this component's column is > 0 are summed
   * (and counted for NULLs). Same mart. Used for impressions of video ads
   * (rows with video plays), the denominator of hook and hold rate.
   */
  onlyWhenPositive?: ComponentId;
  /**
   * Scope of the row filter. Absent: each row is tested on its own. With a key
   * (`ad_id`), the filter is decided once per client, period and key over the
   * whole period (LOGICAL_OR of filter > 0), and every row of a qualifying key
   * is summed, including its days with no plays. Video ads per ad, as on the
   * Paid Meta tab. Requires onlyWhenPositive.
   */
  filterScope?: { key: string };
  /**
   * Money component whose summed column (orders) is multiplied, per client, by
   * the stated rate `ReportClient.costRates[perClientRate]` in evaluate.ts.
   * The compiler emits it like any money column (native rows and per-month
   * FX), so rate x the sum equals Snapshot's SUM(orders x rate) converted per
   * row. Must be money with nullMeans "zero" and may rename its column.
   */
  perClientRate?: CostRateKey;
  /**
   * Output of an entity mart's classifier (`ad_launch.winners`): a virtual
   * 0/1 count per entity row, written by evaluate.ts and never emitted in SQL.
   * `column` repeats the id part and is not a physical column. Every other
   * component of an entity mart is a classifier input, selected with
   * ANY_VALUE per entity and never read by a metric.
   * - needsThresholds: the client's `creativeThresholds` decide the value;
   *   without them a metric reading it is not_measured "No thresholds".
   * - lowerBound: the value can still grow while entities are open (an ad
   *   under 60 days old may still become a winner). Metrics reading it carry
   *   the maturing caveat, and their delta is suppressed when the current
   *   period is maturing and the comparison is not.
   */
  classified?: { needsThresholds: boolean; lowerBound: boolean };
  /**
   * The column is BOOL: summed as COUNTIF(column), the number of rows where it
   * is TRUE. Counts only (no money, nullMeans "zero", no filter or guard).
   */
  bool?: true;
}

/** Identifier rule for marts, tables and columns. Enforced when the registry loads. */
export const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/;

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface Term {
  c: ComponentId;
  sign: 1 | -1;
  /** "gap": a null term nulls the metric. "zero": a null term counts as 0 (paid_spend inside CM3). */
  nullAs: "gap" | "zero";
}

export interface FormatSpec {
  style: "money" | "number" | "percent" | "ratio";
  decimals: number;
  /** Used when |value| < 10 (CPC, CPM in USD). */
  smallDecimals?: number;
  compact?: boolean;
}

export type CaveatId =
  | "revenue_incl_vat"
  | "returns_not_netted"
  /**
   * Obsolete since migration 228 (deployed 2026-10-05) nets Woo fee lines.
   * Kept because ids are append-only; its rule should return false.
   */
  | "woo_fees_not_netted"
  | "google_only_paid"
  | "google_all_conversions"
  | "platform_attributed"
  | "new_flag_window"
  | "period_share_not_rcr"
  /** Added by RS0: set by the evaluator when foreign_ccy_rows > 0 (design 2.9 step 2). */
  | "foreign_currency_rows"
  /** Hit rate (HR3): set by the evaluator when a launch in the current period is still open (under 60 days old). */
  | "cohort_maturing"
  /** Hit rate (HR3): winners are judged on lifetime-to-date totals, not on the period alone. */
  | "lifetime_to_date"
  /** Cohort retention (WR5): set by the evaluator when the summed denominator is 30 to 99 customers. */
  | "low_n"
  /** Cohort retention (WR5): set by the evaluator when the period has customers who have not yet had the metric's horizon. */
  | "cohort_partial";

export interface CaveatDef {
  /** Hover text. Short, no em dash. */
  short: string;
  /** Decided from registry fields only, never from a hardcoded client id. */
  applies: (client: ReportClient) => boolean;
}

export interface MetricBase {
  id: RegistryMetricId;
  label: string;
  group: MetricGroup;
  /** One line, shown on hover in the picker. */
  description: string;
  /** Key into lib/metrics.ts METRIC_DEFINITIONS, when one exists. */
  definitionKey?: string;
  unit: Unit;
  format: FormatSpec;
  goodWhen: GoodWhen;
  grains: readonly Grain[];
  /** Extra requirement on top of the components' own. */
  requires?: CapExpr;
  benchmarkable: boolean;
  aliases?: readonly string[];
  caveats?: readonly CaveatId[];
  /** Low-volume marker for ranked lists and tables (DB2 rule). */
  minVolume?: { c: ComponentId; shareOfMax: number };
  phase: 1 | 2;
  deprecated?: boolean;
  /**
   * A fixed reference value (not an industry benchmark, never stale, not in
   * ref.industry_benchmarks): the KPI tile names it on hover, Line and Bar
   * draw it as a dashed line. Same unit as the metric's value.
   */
  reference?: MetricReference;
  /**
   * Ratio metrics only: the KPI tile shows the summed numerator and
   * denominator under the value ("22 of 322 ads"). Both must be a single
   * positive term. `noun` is what the denominator counts.
   */
  showCounts?: { noun: string };
  /**
   * Cohort retention metrics (customer entry mart, WR5): rules the evaluator
   * applies to the summed counts of every cell (client, bucket, total,
   * rollup), in this order:
   * 1. needsClasses and no product classes for the client (sum of
   *    `classes_configured` is 0): not_measured "Products not classified";
   *    rollups leave the client out with a coverage note.
   * 2. Denominator 0 while the population is above 0: not_measured "Not mature yet".
   * 3. Denominator below minN: not_measured "Too few customers".
   * 4. Denominator below lowN: data-driven caveat `low_n`.
   * 5. Population above the denominator: data-driven caveat `cohort_partial`.
   * Rules 2 to 5 apply to the pooled counts of a rollup, never to one member,
   * so small clients are pooled instead of dropped. Ratio metrics only, with
   * a single positive denominator term in the population's mart.
   */
  cohort?: MetricCohort;
}

export interface MetricCohort {
  /** Customers the rate is about (all entrants, discovery entrants, customers with a 2nd order). */
  population: ComponentId;
  minN: number;
  lowN: number;
  needsClasses?: true;
}

export interface MetricReference {
  value: number;
  /** Two or three words, "Reference ~5%". */
  label: string;
}

/** Signed sum of components: revenue, CM3 = revenue - cogs - paid_spend. */
export interface SumMetric extends MetricBase {
  kind: "sum";
  terms: readonly Term[];
}

/** Always recomputed from summed components, never averaged. */
export interface RatioMetric extends MetricBase {
  kind: "ratio";
  numerator: readonly Term[];
  denominator: readonly Term[];
  /** 1000 for CPM. */
  scale?: number;
}

export type MetricDef = SumMetric | RatioMetric;

/** Derived at load time, never hand-written. */
export interface CompiledMetricMeta {
  /** Every component the formula touches, sorted. */
  components: readonly ComponentId[];
  /** "display" when unit is money; otherwise "native" for per-client series and "display" for combined rollups. */
  fxMode: "display" | "native-per-client";
  /** Components' requirements AND metric.requires. */
  requires: CapExpr;
}

/** What `defineMetrics()` produces per entry. */
export type RegisteredMetric = MetricDef & { meta: CompiledMetricMeta };

/** Shape of `METRICS` in registry/metrics.ts. */
export type MetricRegistry = { readonly [K in RegistryMetricId]: RegisteredMetric & { id: K } };

/** Shape of `COMPONENTS` in registry/components.ts. */
export type ComponentRegistry = Readonly<Record<ComponentId, ComponentDef>>;

/** Shape of `MARTS` in registry/components.ts. */
export type MartRegistry = { readonly [K in MartId]: MartDef & { id: K } };

/** Shape of `CAVEATS` in registry/caveats.ts. */
export type CaveatRegistry = Readonly<Record<CaveatId, CaveatDef>>;
