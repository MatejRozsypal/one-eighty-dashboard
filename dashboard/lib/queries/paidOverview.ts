/**
 * Paid > Overview queries.
 *
 * ── One daily read, everything derived in TypeScript ────────────────────────
 * `mart_daily_kpis` is a view over 60 months of orders: one 30-day read scans
 * roughly 400 MB. So the Overview issues exactly one query against it
 * (`getPaidDaily`, over `scanBounds` so the comparison period rides along) and
 * derives the tiles, chart, platform table and period table from those rows
 * (`components/paid/overview/model.ts`). No widget has its own query.
 *
 * The two campaign marts are small (campaign grain), so they are read once
 * together (`getCampaignsAcross`) and the campaign table and the spend mix are
 * both derived from that result.
 *
 * Currency: the daily mart is already in the client's currency. The toggle
 * converts with the month's rate inside SQL (`fxSql`), before summing, and the
 * campaign marts' `*_client_ccy` columns go through the same wrapper.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isoDate, num } from "@/lib/coerce";
import { fxParams, fxSql, type DisplayCurrency } from "@/lib/currency";
import { isMissingObject } from "@/lib/queries/errors";
import { isDemo } from "@/lib/demo/client";
import { demoCampaigns, demoPaidDays } from "@/lib/demo/paidOverview";
import { scanBounds, type DateRange, type ResolvedPeriod } from "@/lib/period";
import type { CampaignAgg, Ga4Totals, PaidDay } from "@/components/paid/overview/model";

export interface PaidDaily {
  /** One row per day over the scan window, display currency, native-currency days only in native mode. */
  days: PaidDay[];
  /** Orders in another currency than the client's, left out of native totals. */
  excluded: Array<{ currency: string; orders: number }>;
}

/**
 * Q-OV1: the daily shop and paid rows for the scan window.
 *
 * In native mode every currency comes back and the split happens here: native
 * days feed the figures, other-currency orders are counted into `excluded`
 * (adding a CAD order to a USD total means nothing). In conversion mode every
 * row is converted, so they all count.
 */
export async function getPaidDaily(
  clientId: string,
  period: ResolvedPeriod,
  display: DisplayCurrency,
  nativeCurrency: string
): Promise<PaidDaily> {
  const bounds = scanBounds(period);
  if (isDemo(clientId)) return { days: demoPaidDays(bounds, display), excluded: [] };

  const fx = fxSql(display, "k");
  const m = fx.wrap;

  const rows = await query<Record<string, unknown>>(
    `SELECT
       k.date,
       k.currency,
       ${m("k.revenue")}               AS revenue,
       ${m("k.new_customer_revenue")}  AS new_customer_revenue,
       k.orders,
       k.new_customer_orders,
       ${m("k.paid_spend")}            AS paid_spend,
       ${m("k.meta_spend")}            AS meta_spend,
       ${m("k.google_spend")}          AS google_spend,
       ${m("k.meta_revenue")}          AS meta_revenue,
       ${m("k.google_revenue")}        AS google_revenue,
       k.meta_purchases,
       k.google_purchases,
       -- Delivery exists but the spend could not be converted (no FX rate).
       (${m("k.meta_spend")} IS NULL AND k.meta_impressions IS NOT NULL)     AS meta_gap,
       (${m("k.google_spend")} IS NULL AND k.google_impressions IS NOT NULL) AS google_gap
     FROM \`${PROJECT_ID}.mart.mart_daily_kpis\` k
     ${fx.join}
     WHERE k.client_id = @clientId
       AND k.date BETWEEN @scanFrom AND @scanTo
     ORDER BY k.date`,
    {
      clientId,
      scanFrom: bounds.from,
      scanTo: bounds.to,
      ...fxParams(display),
    }
  );

  const native = display === "native";
  const excluded = new Map<string, number>();
  const byDate = new Map<string, PaidDay>();

  for (const r of rows) {
    const currency = String(r.currency ?? nativeCurrency);
    if (native && currency !== nativeCurrency) {
      excluded.set(currency, (excluded.get(currency) ?? 0) + (num(r.orders) ?? 0));
      continue;
    }

    const date = isoDate(r.date as string | { value: string })!;
    const day = toDay(date, r);
    const prev = byDate.get(date);
    byDate.set(date, prev ? mergeDays(prev, day) : day);
  }

  return {
    days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    excluded: [...excluded.entries()].map(([currency, orders]) => ({ currency, orders })),
  };
}

function toDay(date: string, r: Record<string, unknown>): PaidDay {
  return {
    date,
    revenue: num(r.revenue),
    newCustomerRevenue: num(r.new_customer_revenue),
    orders: num(r.orders),
    newCustomerOrders: num(r.new_customer_orders),
    paidSpend: num(r.paid_spend),
    metaSpend: num(r.meta_spend),
    googleSpend: num(r.google_spend),
    metaRevenue: num(r.meta_revenue),
    googleRevenue: num(r.google_revenue),
    metaPurchases: num(r.meta_purchases),
    googlePurchases: num(r.google_purchases),
    metaGap: r.meta_gap === true,
    googleGap: r.google_gap === true,
  };
}

/** Two rows for the same date (conversion mode keeps every currency): add them, null only when both are null. */
function mergeDays(a: PaidDay, b: PaidDay): PaidDay {
  const add = (x: number | null, y: number | null) =>
    x === null ? y : y === null ? x : x + y;
  return {
    date: a.date,
    revenue: add(a.revenue, b.revenue),
    newCustomerRevenue: add(a.newCustomerRevenue, b.newCustomerRevenue),
    orders: add(a.orders, b.orders),
    newCustomerOrders: add(a.newCustomerOrders, b.newCustomerOrders),
    paidSpend: add(a.paidSpend, b.paidSpend),
    metaSpend: add(a.metaSpend, b.metaSpend),
    googleSpend: add(a.googleSpend, b.googleSpend),
    metaRevenue: add(a.metaRevenue, b.metaRevenue),
    googleRevenue: add(a.googleRevenue, b.googleRevenue),
    metaPurchases: add(a.metaPurchases, b.metaPurchases),
    googlePurchases: add(a.googlePurchases, b.googlePurchases),
    metaGap: a.metaGap || b.metaGap,
    googleGap: a.googleGap || b.googleGap,
  };
}

/**
 * Q-OV2: every campaign of the connected platforms over the current range (and
 * the comparison range), in the display currency. The page takes the top 15
 * for the table and builds the spend mix from the same rows.
 *
 * Meta value is the platform's attributed purchase value; Google value is its
 * conversion value (the account's primary conversions, the same definition the
 * daily mart's platform rows use, so the two tables agree). A campaign whose
 * spend could not be converted in any day of a range reports null for that
 * range rather than a partial sum.
 */
export async function getCampaignsAcross(
  clientId: string,
  period: ResolvedPeriod,
  display: DisplayCurrency,
  platforms: { meta: boolean; google: boolean }
): Promise<CampaignAgg[]> {
  if (isDemo(clientId)) return demoCampaigns(period, display, platforms);
  if (!platforms.meta && !platforms.google) return [];

  const bounds = scanBounds(period);
  const fx = fxSql(display, "s");
  const m = fx.wrap;

  const parts: string[] = [];
  if (platforms.meta) {
    parts.push(`
      SELECT 'meta' AS platform, campaign_id, campaign_name,
             funnel_stage AS kind, CAST(NULL AS STRING) AS brand_class,
             date, client_currency AS currency,
             CAST(spend_client_ccy AS FLOAT64) AS spend,
             CAST(revenue_client_ccy AS FLOAT64) AS value,
             CAST(purchases AS FLOAT64) AS purchases
      FROM \`${PROJECT_ID}.mart.mart_meta_campaign_perf\`
      WHERE client_id = @clientId AND date BETWEEN @scanFrom AND @scanTo`);
  }
  if (platforms.google) {
    parts.push(`
      SELECT 'google' AS platform, campaign_id, campaign_name,
             channel_type AS kind, brand_class,
             date, client_currency AS currency,
             spend_client_ccy AS spend,
             conversions_value_client_ccy AS value,
             conversions AS purchases
      FROM \`${PROJECT_ID}.mart.mart_gads_campaign_daily\`
      WHERE client_id = @clientId AND date BETWEEN @scanFrom AND @scanTo`);
  }

  const comparing = period.comparison !== null;
  const cur = "s.date BETWEEN @from AND @to";
  const prev = "s.date BETWEEN @cFrom AND @cTo";

  // Spend is null for a range when any of its days could not be converted.
  const spendIn = (range: string) =>
    `IF(COUNTIF(${range} AND ${m("s.spend")} IS NULL) > 0, NULL, SUM(IF(${range}, ${m("s.spend")}, NULL)))`;
  const sumIn = (col: string, range: string) =>
    `SUM(IF(${range}, ${m(`s.${col}`)}, NULL))`;
  const countIn = (col: string, range: string) => `SUM(IF(${range}, s.${col}, NULL))`;

  const rows = await query<Record<string, unknown>>(
    `WITH s AS (${parts.join("\n      UNION ALL\n")}
     )
     SELECT
       s.platform, s.campaign_id,
       ARRAY_AGG(s.campaign_name IGNORE NULLS ORDER BY s.date DESC LIMIT 1)[SAFE_OFFSET(0)] AS campaign_name,
       ARRAY_AGG(s.kind IGNORE NULLS ORDER BY s.date DESC LIMIT 1)[SAFE_OFFSET(0)] AS kind,
       ARRAY_AGG(s.brand_class IGNORE NULLS ORDER BY s.date DESC LIMIT 1)[SAFE_OFFSET(0)] AS brand_class,
       ${spendIn(cur)}                AS spend,
       ${sumIn("value", cur)}         AS value,
       ${countIn("purchases", cur)}   AS purchases,
       ${comparing ? spendIn(prev) : "NULL"}               AS prev_spend,
       ${comparing ? sumIn("value", prev) : "NULL"}        AS prev_value,
       ${comparing ? countIn("purchases", prev) : "NULL"}  AS prev_purchases
     FROM s
     ${fx.join}
     GROUP BY s.platform, s.campaign_id
     HAVING COUNTIF(${cur}) > 0 ${comparing ? `OR COUNTIF(${prev}) > 0` : ""}`,
    {
      clientId,
      scanFrom: bounds.from,
      scanTo: bounds.to,
      from: period.current.from,
      to: period.current.to,
      ...(comparing
        ? { cFrom: period.comparison!.from, cTo: period.comparison!.to }
        : {}),
      ...fxParams(display),
    }
  );

  return rows.map((r) => ({
    platform: r.platform === "google" ? "google" : "meta",
    id: String(r.campaign_id),
    name: r.campaign_name === null || r.campaign_name === undefined ? null : String(r.campaign_name),
    kind: r.kind === null || r.kind === undefined ? null : String(r.kind),
    brandClass: r.brand_class === null || r.brand_class === undefined ? null : String(r.brand_class),
    spend: num(r.spend),
    value: num(r.value),
    purchases: num(r.purchases),
    prevSpend: num(r.prev_spend),
    prevValue: num(r.prev_value),
    prevPurchases: num(r.prev_purchases),
  }));
}

/**
 * Q-OV3: GA4 last-click revenue per attributed platform, for the platform
 * table's two GA4 columns. Called only for a client with GA4.
 *
 * The GA4 sessions mart ships after this page. Until it exists the query
 * fails with "not found"; that one error returns null, which hides the GA4
 * columns. Every other failure (permissions, quota, timeouts) is thrown.
 * Revenue is null when any purchase session in the range lacked an FX rate.
 */
export async function getGa4PlatformTotals(
  clientId: string,
  range: DateRange,
  display: DisplayCurrency
): Promise<Ga4Totals | null> {
  if (isDemo(clientId)) return null;

  const fx = fxSql(display, "g");
  const m = fx.wrap;

  let rows: Array<Record<string, unknown>>;
  try {
    rows = await query<Record<string, unknown>>(
      `SELECT
         g.platform,
         SUM(${m("g.revenue")})        AS revenue,
         SUM(g.sessions_fx_missing)    AS fx_missing
       FROM \`${PROJECT_ID}.mart.mart_ga4_sessions_daily\` g
       ${fx.join}
       WHERE g.client_id = @clientId
         AND g.date BETWEEN @from AND @to
       GROUP BY g.platform`,
      { clientId, from: range.from, to: range.to, ...fxParams(display) }
    );
  } catch (error) {
    if (isMissingObject(error)) return null;
    throw error;
  }

  const partial = rows.some((r) => (num(r.fx_missing) ?? 0) > 0);
  const by = (platform: string): number | null => {
    const row = rows.find((r) => r.platform === platform);
    return row ? num(row.revenue) : null;
  };
  const sum = (platforms: string[]): number | null => {
    let total: number | null = null;
    for (const p of platforms) {
      const v = by(p);
      if (v !== null) total = (total ?? 0) + v;
    }
    return total;
  };

  if (partial) return { meta: null, google: null, paid: null };
  return {
    meta: sum(["meta"]),
    google: sum(["google"]),
    paid: sum(["meta", "google", "other_paid"]),
  };
}
