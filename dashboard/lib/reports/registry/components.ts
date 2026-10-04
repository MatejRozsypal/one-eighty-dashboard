/**
 * Marts and components: the only physical columns the Reports compiler may
 * read. A component is one summable column; metrics are formulas over
 * component sums (registry/metrics.ts), evaluated in TypeScript.
 *
 * Every column below was checked against the LIVE views on 2026-10-04
 * (INFORMATION_SCHEMA.COLUMNS of mart.mart_daily_kpis,
 * mart.mart_meta_campaign_perf, mart.mart_email_campaign_perf).
 *
 * Deliberately left out:
 * - unique_customers: a sum over days is not a count of unique customers.
 * - *_per_day columns: already divided, cannot be re-aggregated.
 * - cm1, cm2, cm3: CM3 is rebuilt from components so the COGS guard applies.
 *   The mart defines, per row, cm3 = revenue - cogs - cm1_other_costs (always
 *   0) - COALESCE(fulfillment_cost, 0) - COALESCE(paid_spend, 0); the metric
 *   uses the same columns (see metrics.ts `cm3`).
 * - cm1_other_costs: a constant 0 in the live view.
 * - mart_email_flow_perf: a cumulative snapshot, not safe over a period.
 *
 * Pure module, safe for the browser bundle. No project id: compile.ts
 * prefixes the table server-side.
 *
 * Design: 11_reporting_suite_design.md section 2.3. Owner: WP1 (RS1).
 */

import {
  IDENTIFIER_RE,
  type CapExpr,
  type ComponentDef,
  type ComponentId,
  type ComponentRegistry,
  type MartId,
  type MartRegistry,
} from "./types";

export const MARTS = {
  kpis: { id: "kpis", table: "mart.mart_daily_kpis", dateColumn: "date", currencyColumn: "currency", grains: ["day", "week", "month"], phase: 1 },
  meta_campaign: { id: "meta_campaign", table: "mart.mart_meta_campaign_perf", dateColumn: "date", currencyColumn: "currency", grains: ["day", "week", "month"], phase: 2 },
  email_campaign: { id: "email_campaign", table: "mart.mart_email_campaign_perf", dateColumn: "send_date", currencyColumn: "currency", grains: ["week", "month"], phase: 2 },
} as const satisfies MartRegistry;

// nullMeans (see ComponentDef): shop columns are NULL on a day without orders
// (zero); ad-platform columns are NULL when no ad rows exist for the day (gap,
// for example Dobias Meta before April 2026); COGS is a gap only on days with
// revenue; phase 2 campaign marts have one row per campaign, where NULL means
// the platform reported nothing (zero). Checked live 2026-10-04.
const PAID: CapExpr = { any: ["meta", "googleAds"] };

type ComponentSpec = Omit<ComponentDef, "id" | "mart" | "column">;

function defineComponents<K extends ComponentId>(specs: Record<K, ComponentSpec>): Readonly<Record<K, ComponentDef>> {
  const out = {} as Record<K, ComponentDef>;
  for (const id of Object.keys(specs) as K[]) {
    const dot = id.indexOf(".");
    const mart = id.slice(0, dot) as MartId;
    const column = id.slice(dot + 1);
    if (!(mart in MARTS)) throw new Error(`Reports registry: component ${id} names an unknown mart`);
    if (!IDENTIFIER_RE.test(column)) throw new Error(`Reports registry: component ${id} has an invalid column name`);
    const def: ComponentDef = { id, mart, column, ...specs[id] };
    out[id] = Object.freeze(def);
  }
  for (const def of Object.values(out) as ComponentDef[]) {
    const guard = def.zeroIsMissingWhen;
    if (guard === undefined) continue;
    const g = (out as Record<string, ComponentDef | undefined>)[guard];
    if (!g) throw new Error(`Reports registry: ${def.id} guard ${guard} is not a component`);
    if (g.mart !== def.mart) throw new Error(`Reports registry: ${def.id} guard ${guard} is in another mart`);
  }
  for (const m of Object.values(MARTS)) {
    for (const ident of [...m.table.split("."), m.dateColumn, ...(m.currencyColumn ? [m.currencyColumn] : [])]) {
      if (!IDENTIFIER_RE.test(ident)) throw new Error(`Reports registry: mart ${m.id} has an invalid identifier`);
    }
  }
  return Object.freeze(out);
}

export const COMPONENTS = defineComponents({
  "kpis.revenue": { money: true, requires: "shop", nullMeans: "zero" },
  "kpis.net_sales": { money: true, requires: "shop", nullMeans: "zero" },
  "kpis.new_customer_revenue": { money: true, requires: "shop", nullMeans: "zero" },
  "kpis.returning_customer_revenue": { money: true, requires: "shop", nullMeans: "zero" },
  "kpis.new_customer_net_sales": { money: true, requires: "shop", nullMeans: "zero" },
  "kpis.returning_customer_net_sales": { money: true, requires: "shop", nullMeans: "zero" },
  /** NULL (Woo without costed lines) or 0 on positive revenue: not measured. NULL counts as a gap only on days with revenue. */
  "kpis.cogs": { money: true, requires: "shop", nullMeans: "gap", zeroIsMissingWhen: "kpis.revenue" },
  /** Part of the mart's CM3 (owner decision: CM3 = mart definition). COALESCEd to 0 in the view. */
  "kpis.fulfillment_cost": { money: true, requires: "shop", nullMeans: "zero" },
  "kpis.orders": { money: false, requires: "shop", nullMeans: "zero" },
  "kpis.new_customer_orders": { money: false, requires: "shop", nullMeans: "zero" },
  "kpis.returning_customer_orders": { money: false, requires: "shop", nullMeans: "zero" },
  "kpis.paid_spend": { money: true, requires: PAID, nullMeans: "gap" },
  "kpis.meta_spend": { money: true, requires: "meta", nullMeans: "gap" },
  "kpis.meta_revenue": { money: true, requires: "meta", nullMeans: "gap" },
  "kpis.meta_purchases": { money: false, requires: "meta", nullMeans: "gap" },
  "kpis.meta_impressions": { money: false, requires: "meta", nullMeans: "gap" },
  "kpis.meta_clicks": { money: false, requires: "meta", nullMeans: "gap" },
  "kpis.google_spend": { money: true, requires: "googleAds", nullMeans: "gap" },
  "kpis.google_revenue": { money: true, requires: "googleAds", nullMeans: "gap" },
  "kpis.google_purchases": { money: false, requires: "googleAds", nullMeans: "gap" },
  "kpis.google_impressions": { money: false, requires: "googleAds", nullMeans: "gap" },
  "kpis.google_clicks": { money: false, requires: "googleAds", nullMeans: "gap" },
  // phase 2
  "meta_campaign.link_clicks": { money: false, requires: "meta", nullMeans: "zero" },
  "meta_campaign.add_to_cart": { money: false, requires: "meta", nullMeans: "zero" },
  "email_campaign.sent": { money: false, requires: "email", nullMeans: "zero" },
  "email_campaign.delivered": { money: false, requires: "email", nullMeans: "zero" },
  "email_campaign.unique_opens": { money: false, requires: "email", nullMeans: "zero" },
  "email_campaign.unique_clicks": { money: false, requires: "email", nullMeans: "zero" },
  "email_campaign.revenue": { money: true, requires: "email", nullMeans: "zero" },
});

export type KnownComponentId = keyof typeof COMPONENTS;

/** Lookup typed as the contract's registry shape. */
export const COMPONENT_REGISTRY: ComponentRegistry = COMPONENTS as ComponentRegistry;

export function isComponentId(value: unknown): value is KnownComponentId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(COMPONENTS, value);
}

export function getComponent(id: ComponentId): ComponentDef {
  const def = (COMPONENTS as Record<string, ComponentDef | undefined>)[id];
  if (!def) throw new Error(`Reports registry: unknown component ${id}`);
  return def;
}

/** Components of one mart, sorted by id. */
export function componentsOfMart(mart: MartId): ComponentDef[] {
  return (Object.values(COMPONENTS) as ComponentDef[]).filter((c) => c.mart === mart).sort((a, b) => (a.id < b.id ? -1 : 1));
}
