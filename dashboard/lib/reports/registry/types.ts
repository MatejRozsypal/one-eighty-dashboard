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

import type { RegistryMetricId } from "./ids";

export type { MetricId, Phase2MetricId, RegistryMetricId } from "./ids";

/**
 * Part of every cache key. Bump it whenever a formula, a component column or
 * an evaluation rule changes, so no cached result outlives its definition.
 */
export const SEMANTIC_VERSION = 1;

export type MartId = "kpis" | "meta_campaign" | "email_campaign";
export type Grain = "day" | "week" | "month";
export type QueryGrain = Grain | "total";
export type Unit = "money" | "count" | "ratio" | "percent";
export type GoodWhen = "up" | "down" | "neutral";
export type MetricGroup = "profitability" | "acquisition" | "retention" | "meta" | "google" | "email";

/** Picker order of the groups. */
export const METRIC_GROUP_ORDER: readonly MetricGroup[] = [
  "profitability",
  "acquisition",
  "retention",
  "meta",
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
}

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
}

export type ComponentId = `${MartId}.${string}`;

export interface ComponentDef {
  id: ComponentId;
  mart: MartId;
  /** Physical column. Must match /^[a-z_][a-z0-9_]*$/ (checked at module load). */
  column: string;
  /** Money components are emitted twice: native (client currency) and display currency. */
  money: boolean;
  requires: CapExpr;
  /** A summed 0 is "not measured" when this guard component is > 0 (COGS on positive revenue). */
  zeroIsMissingWhen?: ComponentId;
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
  | "foreign_currency_rows";

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
