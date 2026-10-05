/**
 * Marts and components: the only physical columns the Reports compiler may
 * read. A component is one summable column; metrics are formulas over
 * component sums (registry/metrics.ts), evaluated in TypeScript.
 *
 * Every column below was checked against the LIVE views on 2026-10-04
 * (INFORMATION_SCHEMA.COLUMNS of mart.mart_daily_kpis,
 * mart.mart_meta_campaign_perf, mart.mart_meta_ad_perf,
 * mart.mart_email_campaign_perf).
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
 * - Meta ad level outbound_clicks, unique_outbound_clicks and the video
 *   quartile / 30s columns: 100 percent NULL live (not requested by the
 *   ad-insights ingest), so no metric can be built on them yet.
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
  // selectAll: every KPI widget selects all kpis components, so widgets over the same filters share one query and one cache entry.
  kpis: { id: "kpis", table: "mart.mart_daily_kpis", dateColumn: "date", currencyColumn: "currency", grains: ["day", "week", "month"], phase: 1, selectAll: true },
  // Meta marts: one row per campaign (ad) and day, money in the ad account currency (`currency`).
  meta_campaign: { id: "meta_campaign", table: "mart.mart_meta_campaign_perf", dateColumn: "date", currencyColumn: "currency", grains: ["day", "week", "month"], phase: 1, accountCurrency: true },
  meta_ad: { id: "meta_ad", table: "mart.mart_meta_ad_perf", dateColumn: "date", currencyColumn: "currency", grains: ["day", "week", "month"], phase: 1, accountCurrency: true },
  email_campaign: { id: "email_campaign", table: "mart.mart_email_campaign_perf", dateColumn: "send_date", currencyColumn: "currency", grains: ["week", "month"], phase: 2 },
  // Launch cohorts (HR1, migration 254): one row per Meta ad, lifetime to date, bucketed by the day of first delivery.
  // Entity mart: each ad is classified (winner, open) in evaluate.ts against the client's own thresholds.
  // No currency column: spend and revenue only enter the ad's own ROAS, which has no currency.
  ad_launch: {
    id: "ad_launch",
    table: "mart.rpt_ad_launch",
    dateColumn: "first_date",
    currencyColumn: null,
    grains: ["day", "week", "month"],
    phase: 1,
    entity: { key: "ad_id", classifier: "creative_hit", exclude: ["is_preexisting", "is_relaunch"] },
  },
  // Customer entry (WR1, migration 258): one row per client and customer, bucketed by the first order date (the
  // acquisition cohort). Every per-customer verdict is already a 0/1 column, so this is a plain sum mart. Early
  // customers (first order inside the client's history guard) are left out of every sum (retention design 1.7).
  // Day grain is allowed although the design names week and month: neither resolve nor the builder checks a
  // metric's grains, so a day widget would otherwise fail in the compiler. Daily cohorts are mostly under 30
  // customers, so their points read "Too few customers".
  customer_entry: {
    id: "customer_entry",
    table: "mart.rpt_customer_entry",
    dateColumn: "first_order_date",
    currencyColumn: null,
    grains: ["day", "week", "month"],
    phase: 1,
    selectAll: true,
    rowFilter: { excludeTrue: ["is_early"] },
  },
} as const satisfies MartRegistry;

/** Customer entry component whose sum is 0 when the client has no product classes (`ref.product_classes`). */
export const CLASSES_COMPONENT: ComponentId = "customer_entry.classes_configured";

// nullMeans (see ComponentDef): shop columns are NULL on a day without orders
// (zero); ad spend columns are NULL when no ad rows exist for the day (gap,
// for example Dobias Meta before April 2026, RawBark Google 2026-09-17); ad
// outcome columns (purchase value, purchases, clicks, impressions) are a gap
// only on days whose spend is NULL (missingWhenNull): the mart leaves them
// NULL on a day with spend and no conversions (Ethia 4 and venev 26 Meta days
// in Sep 2026, meta_revenue is never 0), which is zero. COGS is a gap only on
// days with revenue; phase 2 email campaign rows: NULL means the platform
// reported nothing (zero). Meta campaign and ad marts follow the ad rule:
// spend counts its own NULLs, every outcome counts the rows whose spend is
// NULL (missingWhenNull) and its own NULL is zero (live Sep 2026: spend never
// NULL; add_to_cart, initiate_checkout, purchases NULL on campaign days
// without the event; video plays NULL on static ads). A day without any Meta
// row is absent from these marts, so it adds nothing (no_data when a whole
// bucket is empty). Checked live 2026-10-04.
const PAID: CapExpr = { any: ["meta", "googleAds"] };

/** Video ads: ads with video plays on any day of the period (per ad, not per row). */
const VIDEO_ADS = { onlyWhenPositive: "meta_ad.video_play_actions", filterScope: { key: "ad_id" } } as const;

type ComponentSpec = Omit<ComponentDef, "id" | "mart" | "column"> & { column?: string };

function defineComponents<K extends ComponentId>(specs: Record<K, ComponentSpec>): Readonly<Record<K, ComponentDef>> {
  const out = {} as Record<K, ComponentDef>;
  for (const id of Object.keys(specs) as K[]) {
    const dot = id.indexOf(".");
    const mart = id.slice(0, dot) as MartId;
    const { column: columnOverride, ...spec } = specs[id];
    const column = columnOverride ?? id.slice(dot + 1);
    if (!(mart in MARTS)) throw new Error(`Reports registry: component ${id} names an unknown mart`);
    if (!IDENTIFIER_RE.test(id.slice(dot + 1))) throw new Error(`Reports registry: component ${id} has an invalid id`);
    if (!IDENTIFIER_RE.test(column)) throw new Error(`Reports registry: component ${id} has an invalid column name`);
    // An entity mart input may read a differently named column (ad_launch purchases from
    // purchases_7dc_1dv, ME5): its value is a plain ANY_VALUE per entity, no filter or rate involved.
    const entityRename = (MARTS[mart] as { entity?: unknown }).entity !== undefined && spec.classified === undefined;
    if (columnOverride !== undefined && spec.onlyWhenPositive === undefined && spec.perClientRate === undefined && !entityRename) {
      throw new Error(`Reports registry: component ${id} renames its column without a row filter or a stated rate`);
    }
    if (spec.perClientRate !== undefined) {
      if (!spec.money || spec.nullMeans !== "zero") throw new Error(`Reports registry: ${id} stated-rate components are money with nullMeans "zero"`);
      if (spec.onlyWhenPositive !== undefined || spec.missingWhenNull !== undefined || spec.zeroIsMissingWhen !== undefined) {
        throw new Error(`Reports registry: ${id} stated-rate components take no filter or guard`);
      }
    }
    const entity = (MARTS[mart] as { entity?: { key: string; exclude: readonly string[] } }).entity;
    if (spec.classified !== undefined) {
      if (!entity) throw new Error(`Reports registry: ${id} classified components belong to an entity mart`);
      if (spec.money || spec.nullMeans !== "zero" || columnOverride !== undefined) throw new Error(`Reports registry: ${id} classified components are counts with nullMeans "zero" and no column`);
    }
    if (entity && spec.classified === undefined) {
      if (spec.money || spec.nullMeans !== "zero") throw new Error(`Reports registry: ${id} entity inputs are non-money with nullMeans "zero" (no FX, ANY_VALUE per entity)`);
    }
    if (entity && (spec.onlyWhenPositive !== undefined || spec.missingWhenNull !== undefined || spec.zeroIsMissingWhen !== undefined || spec.perClientRate !== undefined)) {
      throw new Error(`Reports registry: ${id} entity mart components take no filter, guard or rate`);
    }
    if (spec.bool === true) {
      if (spec.money || spec.nullMeans !== "zero" || columnOverride !== undefined || spec.onlyWhenPositive !== undefined || spec.missingWhenNull !== undefined || spec.zeroIsMissingWhen !== undefined || spec.perClientRate !== undefined || spec.classified !== undefined) {
        throw new Error(`Reports registry: ${id} BOOL components are counts with nullMeans "zero" and no column, filter, guard or rate`);
      }
    }
    if (spec.filterScope !== undefined) {
      if (spec.onlyWhenPositive === undefined) throw new Error(`Reports registry: ${id} filterScope needs onlyWhenPositive`);
      if (!IDENTIFIER_RE.test(spec.filterScope.key)) throw new Error(`Reports registry: ${id} filterScope key is not an identifier`);
    }
    const def: ComponentDef = { id, mart, column, ...spec };
    out[id] = Object.freeze(def);
  }
  for (const def of Object.values(out) as ComponentDef[]) {
    const guard = def.zeroIsMissingWhen;
    if (guard === undefined) continue;
    const g = (out as Record<string, ComponentDef | undefined>)[guard];
    if (!g) throw new Error(`Reports registry: ${def.id} guard ${guard} is not a component`);
    if (g.mart !== def.mart) throw new Error(`Reports registry: ${def.id} guard ${guard} is in another mart`);
  }
  for (const def of Object.values(out) as ComponentDef[]) {
    const spend = def.missingWhenNull;
    if (spend === undefined) continue;
    const g = (out as Record<string, ComponentDef | undefined>)[spend];
    if (!g) throw new Error(`Reports registry: ${def.id} missingWhenNull ${spend} is not a component`);
    if (g.mart !== def.mart) throw new Error(`Reports registry: ${def.id} missingWhenNull ${spend} is in another mart`);
    if (def.nullMeans !== "gap") throw new Error(`Reports registry: ${def.id} has missingWhenNull but nullMeans is not "gap"`);
    if (def.zeroIsMissingWhen !== undefined) throw new Error(`Reports registry: ${def.id} cannot combine missingWhenNull and zeroIsMissingWhen`);
  }
  for (const def of Object.values(out) as ComponentDef[]) {
    const filter = def.onlyWhenPositive;
    if (filter === undefined) continue;
    const g = (out as Record<string, ComponentDef | undefined>)[filter];
    if (!g) throw new Error(`Reports registry: ${def.id} onlyWhenPositive ${filter} is not a component`);
    if (g.mart !== def.mart) throw new Error(`Reports registry: ${def.id} onlyWhenPositive ${filter} is in another mart`);
    if (g.money || def.money) throw new Error(`Reports registry: ${def.id} row filters are for counts only`);
    if (def.zeroIsMissingWhen !== undefined) throw new Error(`Reports registry: ${def.id} cannot combine onlyWhenPositive and zeroIsMissingWhen`);
  }
  for (const m of Object.values(MARTS)) {
    const entity = (m as { entity?: { key: string; exclude: readonly string[] } }).entity;
    const rowFilter = (m as { rowFilter?: { excludeTrue: readonly string[] } }).rowFilter;
    if (rowFilter && rowFilter.excludeTrue.length === 0) throw new Error(`Reports registry: mart ${m.id} has an empty row filter`);
    for (const ident of [...m.table.split("."), m.dateColumn, ...(m.currencyColumn ? [m.currencyColumn] : []), ...(entity ? [entity.key, ...entity.exclude] : []), ...(rowFilter?.excludeTrue ?? [])]) {
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
  /**
   * Stated per-order costs (Settings), as on Snapshot: orders summed as money
   * (native rows, per-month FX), multiplied by the client's stated rate in
   * evaluate.ts. An unstated rate is 0. Snapshot: m("(k.orders * @rate)").
   */
  "kpis.fulfilment_stated": { money: true, requires: "shop", nullMeans: "zero", column: "orders", perClientRate: "fulfilment" },
  "kpis.other_cm1_stated": { money: true, requires: "shop", nullMeans: "zero", column: "orders", perClientRate: "otherCm1" },
  "kpis.orders": { money: false, requires: "shop", nullMeans: "zero" },
  "kpis.new_customer_orders": { money: false, requires: "shop", nullMeans: "zero" },
  "kpis.returning_customer_orders": { money: false, requires: "shop", nullMeans: "zero" },
  "kpis.paid_spend": { money: true, requires: PAID, nullMeans: "gap" },
  "kpis.meta_spend": { money: true, requires: "meta", nullMeans: "gap" },
  "kpis.meta_revenue": { money: true, requires: "meta", nullMeans: "gap", missingWhenNull: "kpis.meta_spend" },
  "kpis.meta_purchases": { money: false, requires: "meta", nullMeans: "gap", missingWhenNull: "kpis.meta_spend" },
  "kpis.meta_impressions": { money: false, requires: "meta", nullMeans: "gap", missingWhenNull: "kpis.meta_spend" },
  "kpis.meta_clicks": { money: false, requires: "meta", nullMeans: "gap", missingWhenNull: "kpis.meta_spend" },
  "kpis.google_spend": { money: true, requires: "googleAds", nullMeans: "gap" },
  "kpis.google_revenue": { money: true, requires: "googleAds", nullMeans: "gap", missingWhenNull: "kpis.google_spend" },
  "kpis.google_purchases": { money: false, requires: "googleAds", nullMeans: "gap", missingWhenNull: "kpis.google_spend" },
  "kpis.google_impressions": { money: false, requires: "googleAds", nullMeans: "gap", missingWhenNull: "kpis.google_spend" },
  "kpis.google_clicks": { money: false, requires: "googleAds", nullMeans: "gap", missingWhenNull: "kpis.google_spend" },
  // Meta campaign mart (money in the ad account currency)
  "meta_campaign.spend": { money: true, requires: "meta", nullMeans: "gap" },
  "meta_campaign.impressions": { money: false, requires: "meta", nullMeans: "gap", missingWhenNull: "meta_campaign.spend" },
  "meta_campaign.reach": { money: false, requires: "meta", nullMeans: "gap", missingWhenNull: "meta_campaign.spend" },
  "meta_campaign.link_clicks": { money: false, requires: "meta", nullMeans: "gap", missingWhenNull: "meta_campaign.spend" },
  "meta_campaign.landing_page_views": { money: false, requires: "meta", nullMeans: "gap", missingWhenNull: "meta_campaign.spend" },
  "meta_campaign.add_to_cart": { money: false, requires: "meta", nullMeans: "gap", missingWhenNull: "meta_campaign.spend" },
  "meta_campaign.initiate_checkout": { money: false, requires: "meta", nullMeans: "gap", missingWhenNull: "meta_campaign.spend" },
  "meta_campaign.purchases": { money: false, requires: "meta", nullMeans: "gap", missingWhenNull: "meta_campaign.spend" },
  // Meta ad mart: video metrics live only here. video_play_actions is Meta's
  // video starts (about 3x the 3-second plays, so it is not the hook
  // numerator); it only classifies video ads. video_views (actions[video_view])
  // is the 3-second play count, the hook numerator (owner decision D2,
  // 2026-10-05). A video ad is one with plays on any day of the period, per
  // ad (VIDEO_ADS), the same rule as the Paid Meta tab; all its days count,
  // including days without plays.
  "meta_ad.spend": { money: true, requires: "meta", nullMeans: "gap" },
  "meta_ad.video_play_actions": { money: false, requires: "meta", nullMeans: "gap", missingWhenNull: "meta_ad.spend" },
  /** 3-second video plays of video ads: hook numerator. */
  "meta_ad.video_views": { money: false, requires: "meta", nullMeans: "gap", missingWhenNull: "meta_ad.spend", ...VIDEO_ADS },
  /** ThruPlays of video ads: hold numerator. */
  "meta_ad.video_thruplays": { money: false, requires: "meta", nullMeans: "gap", missingWhenNull: "meta_ad.spend", ...VIDEO_ADS },
  /** Impressions of video ads: hook and hold denominator, as on the Meta tab. */
  "meta_ad.video_impressions": { money: false, requires: "meta", nullMeans: "gap", missingWhenNull: "meta_ad.spend", column: "impressions", ...VIDEO_ADS },
  // Launch cohorts (entity mart). Inputs: one value per ad, lifetime to date
  // (ANY_VALUE per ad). Outputs: written per ad by the creative_hit
  // classifier in evaluate.ts, which reuses launchStatus() from
  // lib/creative/hitRate.ts, the function behind the Creative tile.
  // ME5: purchases, revenue and the prior are the 7-day click + 1-day view columns of the launch table (the standard
  // basis; migration 256). The ids are unchanged, so the classifier input map in evaluate.ts needs no edit.
  "ad_launch.purchases": { money: false, requires: "meta", nullMeans: "zero", column: "purchases_7dc_1dv" },
  "ad_launch.spend": { money: false, requires: "meta", nullMeans: "zero" },
  "ad_launch.revenue": { money: false, requires: "meta", nullMeans: "zero", column: "revenue_7dc_1dv" },
  "ad_launch.age_days": { money: false, requires: "meta", nullMeans: "zero" },
  /** The client's trailing 365-day Meta ROAS on the same basis, the shrinkage anchor. NULL: the ad cannot be judged, never a winner. */
  "ad_launch.prior_roas": { money: false, requires: "meta", nullMeans: "zero", column: "prior_roas_7dc_1dv" },
  /** 1 per ad first delivered in the bucket (pre-existing ads and relaunches are not in the rows at all). */
  "ad_launch.launched": { money: false, requires: "meta", nullMeans: "zero", classified: { needsThresholds: false, lowerBound: false } },
  /** 1 per ad that is a winner on its lifetime totals: purchases >= readPurchases and shrunk ROAS >= targetRoas. */
  "ad_launch.winners": { money: false, requires: "meta", nullMeans: "zero", classified: { needsThresholds: true, lowerBound: true } },
  /** 1 per ad that is not a winner and under 60 days old: it may still qualify. */
  "ad_launch.open": { money: false, requires: "meta", nullMeans: "zero", classified: { needsThresholds: true, lowerBound: false } },
  // Customer entry (cohort retention). Every column is a per-customer 0/1 flag (INT64), summed over the customers
  // whose first order falls in the bucket; classes_configured is BOOL (COUNTIF). m = mature for the horizon,
  // r = 2nd order within it, dm/du = discovery entrant mature / upgraded to full size within it,
  // m23_180/r23_180 = 2nd order mature for 180 days / 3rd order within 180 days of the 2nd.
  "customer_entry.n_customer": { money: false, requires: "shop", nullMeans: "zero" },
  "customer_entry.is_discovery": { money: false, requires: "shop", nullMeans: "zero" },
  "customer_entry.has_second": { money: false, requires: "shop", nullMeans: "zero" },
  /** Customers of clients with rows in ref.product_classes. 0 over a client's rows: products not classified. */
  "customer_entry.classes_configured": { money: false, requires: "shop", nullMeans: "zero", bool: true },
  "customer_entry.m90": { money: false, requires: "shop", nullMeans: "zero" },
  "customer_entry.r90": { money: false, requires: "shop", nullMeans: "zero" },
  "customer_entry.m180": { money: false, requires: "shop", nullMeans: "zero" },
  "customer_entry.r180": { money: false, requires: "shop", nullMeans: "zero" },
  "customer_entry.m365": { money: false, requires: "shop", nullMeans: "zero" },
  "customer_entry.r365": { money: false, requires: "shop", nullMeans: "zero" },
  "customer_entry.m23_180": { money: false, requires: "shop", nullMeans: "zero" },
  "customer_entry.r23_180": { money: false, requires: "shop", nullMeans: "zero" },
  "customer_entry.dm90": { money: false, requires: "shop", nullMeans: "zero" },
  "customer_entry.du90": { money: false, requires: "shop", nullMeans: "zero" },
  "customer_entry.dm180": { money: false, requires: "shop", nullMeans: "zero" },
  "customer_entry.du180": { money: false, requires: "shop", nullMeans: "zero" },
  // phase 2
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
  // Every component of the mart, inputs and classified outputs alike.
  return (Object.values(COMPONENTS) as ComponentDef[]).filter((c) => c.mart === mart).sort((a, b) => (a.id < b.id ? -1 : 1));
}
