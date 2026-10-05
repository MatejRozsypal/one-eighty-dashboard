/**
 * Metric registry: every Reports metric as a formula over component sums.
 *
 * - Sum metrics are a signed sum of components.
 * - Ratio metrics are SUM(numerator) / SUM(denominator) * scale, always
 *   recomputed from summed components (per bucket, per total, per rollup),
 *   never averaged.
 * - Ids are permanent (registry/ids.ts). A rename keeps the old id in
 *   `aliases` with `deprecated: true`.
 *
 * CM3 follows the mart definition (owner decision): per mart row
 * cm3 = revenue - cogs - COALESCE(fulfillment_cost, 0) - COALESCE(paid_spend, 0).
 * Here: revenue and cogs are gap terms, fulfilment and paid spend count as 0
 * when null. Checked 2026-10-04 on manami, 2026-07-06 to 2026-10-03: the
 * component formula equals SUM(cm3) exactly (251,049.928669, 0 row mismatches).
 * On top of the mart, CM3 subtracts the per-order costs stated in Settings
 * (fulfilment and other CM1 costs, orders x rate), exactly like Snapshot
 * (lib/queries/pnl.ts), so both pages show the same CM3 (owner decision
 * 2026-10-05, QA C-01). CM1 % subtracts the other CM1 cost likewise. An
 * unstated rate is 0 on both pages. A Woo client with a stated fulfilment
 * rate has both the mart Woo fulfilment and the stated rate subtracted, on
 * both pages.
 *
 * Pure module, safe for the browser bundle.
 *
 * Design: 11_reporting_suite_design.md section 2.4. Owner: WP1 (RS1).
 */

import { allOf } from "./capabilities";
import { COMPONENTS, MARTS, getComponent } from "./components";
import { METRIC_IDS, REGISTRY_METRIC_IDS, type MetricId, type RegistryMetricId } from "./ids";
import {
  METRIC_GROUP_ORDER,
  type CapExpr,
  type CaveatId,
  type CompiledMetricMeta,
  type ComponentId,
  type FormatSpec,
  type GoodWhen,
  type Grain,
  type MetricDef,
  type MetricGroup,
  type MetricRegistry,
  type RegisteredMetric,
  type Term,
  type Unit,
} from "./types";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const t = (c: keyof typeof COMPONENTS, sign: 1 | -1 = 1, nullAs: "gap" | "zero" = "gap"): Term => ({ c, sign, nullAs });

/** Meta campaign mart and Meta ad mart terms. */
const mc = (column: string): Term => t(`meta_campaign.${column}` as keyof typeof COMPONENTS);
const ma = (column: string): Term => t(`meta_ad.${column}` as keyof typeof COMPONENTS);

const F = {
  money: { style: "money", decimals: 0, compact: true },
  unitCost: { style: "money", decimals: 0, smallDecimals: 2 },
  x: { style: "ratio", decimals: 2 },
  pct: { style: "percent", decimals: 1 },
  pct2: { style: "percent", decimals: 2 },
  n: { style: "number", decimals: 0, compact: true },
  num2: { style: "number", decimals: 2 },
} as const satisfies Record<string, FormatSpec>;

interface Opts {
  description: string;
  unit: Unit;
  format: FormatSpec;
  goodWhen: GoodWhen;
  benchmarkable: boolean;
  definitionKey?: string;
  grains?: readonly Grain[];
  requires?: CapExpr;
  aliases?: readonly string[];
  caveats?: readonly CaveatId[];
  minVolume?: { c: ComponentId; shareOfMax: number };
  phase?: 1 | 2;
  deprecated?: boolean;
}

type Spec =
  | (Opts & { kind: "sum"; label: string; group: MetricGroup; terms: readonly Term[] })
  | (Opts & { kind: "ratio"; label: string; group: MetricGroup; numerator: readonly Term[]; denominator: readonly Term[]; scale?: number });

const sum = (label: string, group: MetricGroup, terms: readonly Term[], o: Opts): Spec => ({ kind: "sum", label, group, terms, ...o });
const ratio = (label: string, group: MetricGroup, numerator: readonly Term[], denominator: readonly Term[], o: Opts & { scale?: number }): Spec => ({
  kind: "ratio",
  label,
  group,
  numerator,
  denominator,
  ...o,
});

const MONEY_UP = { unit: "money", format: F.money, goodWhen: "up" } as const;
const COST = { unit: "money", format: F.unitCost, goodWhen: "down" } as const;
const X_UP = { unit: "ratio", format: F.x, goodWhen: "up" } as const;
const PCT_UP = { unit: "percent", format: F.pct, goodWhen: "up" } as const;
const PCT_N = { unit: "percent", format: F.pct, goodWhen: "neutral" } as const;
const COUNT_UP = { unit: "count", format: F.n, goodWhen: "up" } as const;

/** woo_fees_not_netted is obsolete (migration 228), so it is not listed. */
const SHOP_CAV: CaveatId[] = ["revenue_incl_vat", "returns_not_netted"];
const PAID_CAV: CaveatId[] = [...SHOP_CAV, "google_only_paid"];

/** CM3 terms: mart definition, then the stated per-order costs (Snapshot parity). */
const CM3_TERMS: readonly Term[] = [
  t("kpis.revenue"),
  t("kpis.cogs", -1),
  t("kpis.fulfillment_cost", -1, "zero"),
  t("kpis.paid_spend", -1, "zero"),
  t("kpis.fulfilment_stated", -1, "zero"),
  t("kpis.other_cm1_stated", -1, "zero"),
];

/** CM1 terms: revenue - COGS - other CM1 costs stated in Settings (Snapshot cm1). */
const CM1_TERMS: readonly Term[] = [t("kpis.revenue"), t("kpis.cogs", -1), t("kpis.other_cm1_stated", -1, "zero")];

function termsOf(def: MetricDef): readonly Term[] {
  return def.kind === "sum" ? def.terms : [...def.numerator, ...def.denominator];
}

/** True when the formula touches a money component. */
export function usesMoney(def: MetricDef): boolean {
  return termsOf(def).some((term) => getComponent(term.c).money);
}

function defineMetrics(specs: Record<RegistryMetricId, Spec>): MetricRegistry {
  const queryable = new Set<string>(METRIC_IDS);
  const out: Record<string, RegisteredMetric> = {};
  for (const id of REGISTRY_METRIC_IDS) {
    const s = specs[id];
    if (!s) throw new Error(`Reports registry: metric ${id} is not defined`);
    const phase = s.phase ?? 1;
    if (queryable.has(id) !== (phase === 1)) throw new Error(`Reports registry: metric ${id} phase does not match ids.ts`);
    const { kind: _k, ...rest } = s;
    void _k;
    const base = { ...rest, id, phase, grains: s.grains ?? (["day", "week", "month"] as const) };
    const def: MetricDef =
      s.kind === "sum"
        ? { ...base, kind: "sum", terms: s.terms }
        : { ...base, kind: "ratio", numerator: s.numerator, denominator: s.denominator, ...(s.scale !== undefined ? { scale: s.scale } : {}) };
    const terms = termsOf(def);
    if (terms.length === 0) throw new Error(`Reports registry: metric ${id} has no terms`);
    if (def.kind === "ratio" && (def.numerator.length === 0 || def.denominator.length === 0)) {
      throw new Error(`Reports registry: ratio ${id} needs a numerator and a denominator`);
    }
    const comps = [...new Set(terms.map((x) => x.c))].sort();
    const defs = comps.map(getComponent);
    for (const c of defs) {
      const mart = MARTS[c.mart];
      if (mart.phase > phase) throw new Error(`Reports registry: phase ${phase} metric ${id} reads phase ${mart.phase} mart ${mart.id}`);
      for (const g of def.grains) if (!(mart.grains as readonly Grain[]).includes(g)) throw new Error(`Reports registry: ${id} grain ${g} not in mart ${mart.id}`);
    }
    if (def.minVolume) getComponent(def.minVolume.c);
    // Native sums exclude rows in another currency, display sums convert them: either way the marker belongs on every money-based metric.
    const caveats = usesMoney(def) ? [...(def.caveats ?? []), "foreign_currency_rows" as const] : def.caveats;
    const meta: CompiledMetricMeta = {
      components: comps,
      fxMode: def.unit === "money" ? "display" : "native-per-client",
      requires: allOf([...defs.map((c) => c.requires), ...(def.requires ? [def.requires] : [])]),
    };
    out[id] = Object.freeze({ ...def, ...(caveats ? { caveats } : {}), meta }) as RegisteredMetric;
  }
  for (const id of Object.keys(specs)) {
    if (!(REGISTRY_METRIC_IDS as readonly string[]).includes(id)) throw new Error(`Reports registry: metric ${id} is not in ids.ts`);
  }
  return Object.freeze(out) as unknown as MetricRegistry;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export const METRICS: MetricRegistry = defineMetrics({
  // Profitability
  revenue: sum("Revenue", "profitability", [t("kpis.revenue")], {
    ...MONEY_UP,
    description: "Order revenue including shipping, before costs.",
    benchmarkable: false,
    caveats: SHOP_CAV,
    definitionKey: "Revenue",
  }),
  net_sales: sum("Net sales", "profitability", [t("kpis.net_sales")], {
    ...MONEY_UP,
    description: "Product revenue after discounts, without shipping.",
    benchmarkable: false,
    caveats: SHOP_CAV,
    definitionKey: "Net sales",
  }),
  orders: sum("Orders", "profitability", [t("kpis.orders")], { ...COUNT_UP, description: "Number of orders.", benchmarkable: false }),
  aov: ratio("AOV", "profitability", [t("kpis.net_sales")], [t("kpis.orders")], {
    ...MONEY_UP,
    format: F.unitCost,
    description: "Net sales per order.",
    benchmarkable: true,
    caveats: SHOP_CAV,
    definitionKey: "AOV (net)",
  }),
  cogs: sum("COGS", "profitability", [t("kpis.cogs")], {
    unit: "money",
    format: F.money,
    goodWhen: "down",
    description: "Cost of goods sold.",
    benchmarkable: false,
  }),
  cm1_pct: ratio("CM1 %", "profitability", CM1_TERMS, [t("kpis.revenue")], {
    ...PCT_UP,
    description: "Revenue minus COGS and stated other CM1 costs, as a share of revenue.",
    benchmarkable: true,
    caveats: SHOP_CAV,
    aliases: ["gross margin"],
    definitionKey: "Gross margin",
  }),
  cm3: sum("CM3", "profitability", CM3_TERMS, {
    ...MONEY_UP,
    description: "Revenue minus COGS, fulfilment, stated per-order costs and paid spend.",
    benchmarkable: false,
    caveats: PAID_CAV,
    definitionKey: "CM3",
  }),
  cm3_pct: ratio("CM3 %", "profitability", CM3_TERMS, [t("kpis.revenue")], {
    ...PCT_UP,
    description: "CM3 as a share of revenue.",
    benchmarkable: true,
    caveats: PAID_CAV,
    definitionKey: "CM3 %",
  }),

  // Acquisition
  paid_spend: sum("Paid spend", "acquisition", [t("kpis.paid_spend")], {
    unit: "money",
    format: F.money,
    goodWhen: "neutral",
    description: "Meta and Google ad spend.",
    benchmarkable: false,
    caveats: ["google_only_paid"],
    definitionKey: "Paid spend",
  }),
  mer: ratio("MER", "acquisition", [t("kpis.revenue")], [t("kpis.paid_spend")], {
    ...X_UP,
    description: "Revenue per unit of paid spend.",
    benchmarkable: true,
    caveats: PAID_CAV,
    aliases: ["roas"],
    definitionKey: "MER",
    minVolume: { c: "kpis.paid_spend", shareOfMax: 0.02 },
  }),
  amer: ratio("aMER", "acquisition", [t("kpis.new_customer_revenue")], [t("kpis.paid_spend")], {
    ...X_UP,
    description: "New-customer revenue per unit of paid spend.",
    benchmarkable: true,
    caveats: [...PAID_CAV, "new_flag_window"],
    definitionKey: "aMER",
  }),
  cac: ratio("CAC", "acquisition", [t("kpis.paid_spend")], [t("kpis.new_customer_orders")], {
    ...COST,
    description: "Paid spend per new customer.",
    benchmarkable: true,
    caveats: ["google_only_paid", "new_flag_window"],
    definitionKey: "CAC",
  }),
  new_customers: sum("New customers", "acquisition", [t("kpis.new_customer_orders")], {
    ...COUNT_UP,
    description: "First orders in the period.",
    benchmarkable: false,
    caveats: ["new_flag_window"],
    aliases: ["first orders"],
  }),
  aov_new: ratio("AOV new", "acquisition", [t("kpis.new_customer_net_sales")], [t("kpis.new_customer_orders")], {
    ...MONEY_UP,
    format: F.unitCost,
    description: "Net sales per first order.",
    benchmarkable: false,
    caveats: ["new_flag_window"],
  }),
  new_revenue_share: ratio("New revenue share", "acquisition", [t("kpis.new_customer_revenue")], [t("kpis.revenue")], {
    ...PCT_N,
    description: "Share of revenue from first orders.",
    benchmarkable: false,
    caveats: ["new_flag_window"],
  }),

  // Retention (period based; cohort RCR and LTV come later)
  returning_orders: sum("Returning orders", "retention", [t("kpis.returning_customer_orders")], {
    ...COUNT_UP,
    description: "Orders from returning customers.",
    benchmarkable: false,
    caveats: ["new_flag_window"],
  }),
  returning_order_share: ratio("Returning order share", "retention", [t("kpis.returning_customer_orders")], [t("kpis.orders")], {
    ...PCT_N,
    description: "Share of orders from returning customers.",
    benchmarkable: false,
    caveats: ["period_share_not_rcr", "new_flag_window"],
  }),
  returning_revenue_share: ratio("Returning revenue share", "retention", [t("kpis.returning_customer_revenue")], [t("kpis.revenue")], {
    ...PCT_N,
    description: "Share of revenue from returning customers.",
    benchmarkable: false,
    caveats: ["new_flag_window"],
  }),
  aov_returning: ratio("AOV returning", "retention", [t("kpis.returning_customer_net_sales")], [t("kpis.returning_customer_orders")], {
    ...MONEY_UP,
    format: F.unitCost,
    description: "Net sales per returning order.",
    benchmarkable: false,
  }),

  // Meta (client currency via the daily KPI view)
  meta_spend: sum("Meta spend", "meta", [t("kpis.meta_spend")], {
    unit: "money",
    format: F.money,
    goodWhen: "neutral",
    description: "Meta ad spend.",
    benchmarkable: false,
  }),
  meta_roas: ratio("Meta ROAS", "meta", [t("kpis.meta_revenue")], [t("kpis.meta_spend")], {
    ...X_UP,
    description: "Meta-attributed revenue per unit of Meta spend.",
    benchmarkable: true,
    caveats: ["platform_attributed"],
    minVolume: { c: "kpis.meta_spend", shareOfMax: 0.02 },
  }),
  meta_ctr: ratio("Meta CTR", "meta", [t("kpis.meta_clicks")], [t("kpis.meta_impressions")], {
    unit: "percent",
    format: F.pct2,
    goodWhen: "up",
    description: "Clicks per impression.",
    benchmarkable: true,
  }),
  meta_cpc: ratio("Meta CPC", "meta", [t("kpis.meta_spend")], [t("kpis.meta_clicks")], { ...COST, description: "Spend per click.", benchmarkable: true }),
  meta_cpm: ratio("Meta CPM", "meta", [t("kpis.meta_spend")], [t("kpis.meta_impressions")], {
    ...COST,
    scale: 1000,
    description: "Spend per 1,000 impressions.",
    benchmarkable: true,
  }),
  meta_cpa: ratio("Meta CPA", "meta", [t("kpis.meta_spend")], [t("kpis.meta_purchases")], {
    ...COST,
    description: "Spend per Meta-attributed purchase.",
    benchmarkable: true,
    caveats: ["platform_attributed"],
  }),
  meta_spend_share: ratio("Meta share of spend", "meta", [t("kpis.meta_spend")], [t("kpis.paid_spend")], {
    ...PCT_N,
    description: "Meta spend as a share of paid spend.",
    benchmarkable: false,
  }),

  // Google
  google_spend: sum("Google spend", "google", [t("kpis.google_spend")], {
    unit: "money",
    format: F.money,
    goodWhen: "neutral",
    description: "Google Ads spend.",
    benchmarkable: false,
  }),
  google_roas: ratio("Google ROAS", "google", [t("kpis.google_revenue")], [t("kpis.google_spend")], {
    ...X_UP,
    description: "Google-attributed conversion value per unit of Google spend.",
    benchmarkable: true,
    caveats: ["platform_attributed", "google_all_conversions"],
  }),
  google_ctr: ratio("Google CTR", "google", [t("kpis.google_clicks")], [t("kpis.google_impressions")], {
    unit: "percent",
    format: F.pct2,
    goodWhen: "up",
    description: "Clicks per impression.",
    benchmarkable: true,
  }),
  google_cpc: ratio("Google CPC", "google", [t("kpis.google_spend")], [t("kpis.google_clicks")], { ...COST, description: "Spend per click.", benchmarkable: true }),

  // Meta soft metrics: campaign and ad marts, money in the ad account currency
  // converted per row and month like the KPI view. Every ratio is a sum over
  // a sum. Meta CPM and Meta CPA stay on the daily KPI view above.
  meta_cost_per_lpv: ratio("Cost per LPV", "meta", [mc("spend")], [mc("landing_page_views")], {
    ...COST,
    description: "Meta spend per landing page view. A view counts only once the page has loaded after an ad click.",
    benchmarkable: true,
    aliases: ["cost per landing page view", "cplpv"],
    definitionKey: "Cost / LPV",
  }),
  meta_lpv: sum("Landing page views", "meta", [mc("landing_page_views")], {
    ...COUNT_UP,
    description: "Landing page loads after a Meta ad click.",
    benchmarkable: false,
    aliases: ["lpv"],
  }),
  meta_link_ctr: ratio("Link CTR", "meta", [mc("link_clicks")], [mc("impressions")], {
    unit: "percent",
    format: F.pct2,
    goodWhen: "up",
    description: "Meta link clicks per impression. Only clicks to a destination count, not reactions or comments.",
    benchmarkable: true,
    aliases: ["link click-through rate"],
    definitionKey: "Link CTR",
  }),
  meta_cpc_link: ratio("CPC (link)", "meta", [mc("spend")], [mc("link_clicks")], {
    ...COST,
    description: "Meta spend per link click.",
    benchmarkable: true,
    aliases: ["cpc link", "cost per link click"],
  }),
  meta_add_to_cart: sum("Add to carts", "meta", [mc("add_to_cart")], {
    ...COUNT_UP,
    description: "Add-to-cart events Meta attributes to its ads.",
    benchmarkable: false,
    caveats: ["platform_attributed"],
    aliases: ["add to cart", "atc"],
  }),
  meta_cost_per_atc: ratio("Cost per ATC", "meta", [mc("spend")], [mc("add_to_cart")], {
    ...COST,
    description: "Meta spend per Meta-attributed add to cart. A pixel tracking gap inflates it.",
    benchmarkable: true,
    caveats: ["platform_attributed"],
    aliases: ["cost per add to cart"],
    definitionKey: "Cost / ATC",
  }),
  meta_atc_rate: ratio("ATC rate", "meta", [mc("add_to_cart")], [mc("landing_page_views")], {
    ...PCT_UP,
    description: "Meta-attributed adds to cart per landing page view.",
    benchmarkable: true,
    caveats: ["platform_attributed"],
    aliases: ["add to cart rate", "meta add-to-cart rate"],
  }),
  meta_atc_to_purchase: ratio("ATC to purchase", "meta", [mc("purchases")], [mc("add_to_cart")], {
    ...PCT_UP,
    description: "Meta-attributed purchases per add to cart. Both counts are platform-reported.",
    benchmarkable: true,
    caveats: ["platform_attributed"],
    aliases: ["add to cart to purchase"],
    definitionKey: "ATC to purchase",
  }),
  meta_initiate_checkout: sum("Initiate checkouts", "meta", [mc("initiate_checkout")], {
    ...COUNT_UP,
    description: "Checkout starts Meta attributes to its ads.",
    benchmarkable: false,
    caveats: ["platform_attributed"],
    aliases: ["initiate checkout", "checkouts"],
  }),
  meta_cost_per_ic: ratio("Cost per checkout", "meta", [mc("spend")], [mc("initiate_checkout")], {
    ...COST,
    description: "Meta spend per Meta-attributed checkout start.",
    benchmarkable: true,
    caveats: ["platform_attributed"],
    aliases: ["cost per initiate checkout"],
  }),
  meta_hook_rate: ratio("Hook rate", "meta", [ma("video_views")], [ma("video_impressions")], {
    ...PCT_UP,
    description: "3-second video plays per impression of video ads (ads with plays in the period, all their days).",
    benchmarkable: true,
    aliases: ["hit rate", "thumbstop rate"],
    definitionKey: "Hook rate",
  }),
  meta_hold_rate: ratio("Hold rate", "meta", [ma("video_thruplays")], [ma("video_impressions")], {
    ...PCT_UP,
    description: "ThruPlays per impression of video ads. A ThruPlay is 15 seconds watched, or the whole video if shorter.",
    benchmarkable: true,
    aliases: ["thruplay rate"],
    definitionKey: "Hold rate",
  }),
  meta_frequency: ratio("Frequency", "meta", [mc("impressions")], [mc("reach")], {
    unit: "ratio",
    format: F.num2,
    goodWhen: "neutral",
    description: "Average daily frequency: impressions over reach, summed over campaign days. A person reached on several days counts again, so it reads below true period frequency.",
    benchmarkable: false,
    aliases: ["average daily frequency"],
    definitionKey: "Avg daily frequency",
  }),
  meta_conversion_rate: ratio("Meta conversion rate", "meta", [mc("purchases")], [mc("link_clicks")], {
    unit: "percent",
    format: F.pct2,
    goodWhen: "up",
    description: "Meta-attributed purchases per link click.",
    benchmarkable: true,
    caveats: ["platform_attributed"],
    aliases: ["conversion rate", "meta cvr"],
  }),

  // Phase 2: email campaigns (flows are cumulative snapshots)
  email_revenue: sum("Email campaign revenue", "email", [t("email_campaign.revenue")], {
    ...MONEY_UP,
    description: "Revenue attributed to email campaigns.",
    benchmarkable: false,
    caveats: ["platform_attributed"],
    phase: 2,
    grains: ["week", "month"],
  }),
  email_open_rate: ratio("Open rate", "email", [t("email_campaign.unique_opens")], [t("email_campaign.delivered")], {
    ...PCT_UP,
    description: "Unique opens per delivered email.",
    benchmarkable: true,
    phase: 2,
    grains: ["week", "month"],
  }),
  email_click_rate: ratio("Click rate", "email", [t("email_campaign.unique_clicks")], [t("email_campaign.delivered")], {
    unit: "percent",
    format: F.pct2,
    goodWhen: "up",
    description: "Unique clicks per delivered email.",
    benchmarkable: true,
    phase: 2,
    grains: ["week", "month"],
  }),
  email_rev_per_email: ratio("Revenue per email", "email", [t("email_campaign.revenue")], [t("email_campaign.sent")], {
    ...MONEY_UP,
    format: F.unitCost,
    description: "Campaign revenue per email sent.",
    benchmarkable: false,
    phase: 2,
    grains: ["week", "month"],
  }),
});

// ---------------------------------------------------------------------------
// Lookups for the pickers and the evaluator
// ---------------------------------------------------------------------------

export function getMetric(id: RegistryMetricId): RegisteredMetric {
  return METRICS[id];
}

/** Queryable metrics in picker order (group order, then ids.ts order). */
export const METRIC_LIST: readonly RegisteredMetric[] = METRIC_GROUP_ORDER.flatMap((g) =>
  METRIC_IDS.map((id) => METRICS[id] as RegisteredMetric).filter((m) => m.group === g && !m.deprecated),
);

/** Resolve an id, a label or an alias (case-insensitive) to a queryable metric id. */
export function findMetricId(text: string): MetricId | null {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  for (const id of METRIC_IDS) {
    const m = METRICS[id];
    if (id === q || m.label.toLowerCase() === q || (m.aliases ?? []).some((a) => a.toLowerCase() === q)) return id;
  }
  return null;
}

/** Components a widget must fetch for these metrics: formula components, COGS guards and low-volume components, sorted. */
export function componentsFor(metricIds: readonly RegistryMetricId[]): ComponentId[] {
  const out = new Set<ComponentId>();
  for (const id of metricIds) {
    const m = METRICS[id];
    for (const c of m.meta.components) {
      out.add(c);
      const guard = getComponent(c).zeroIsMissingWhen;
      if (guard) out.add(guard);
    }
    if (m.minVolume) out.add(m.minVolume.c);
  }
  return [...out].sort();
}
