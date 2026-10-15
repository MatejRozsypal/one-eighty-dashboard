/**
 * Markets, Trends & analysis: the reads behind /markets/trends.
 *
 * Same tables and the same `MARKETS_SOURCE` switch as lib/queries/markets.ts
 * (`marketsTable()`), so the subpage and the Overview always read one build.
 * GA4 by country lives only in `mart.market_ga4_country_daily` and is read
 * from `mart` in mart_qa mode too, as the scouting signals are.
 *
 * Each read is its own function so the page can stream one widget at a time;
 * the period sums, cohorts and model (portfolio, bridge) come from
 * `getMarkets`, the Overview's own read. Every function has a demo branch
 * (lib/demo/marketsTrends.ts) and returns null when its table is not built.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { optional } from "@/lib/queries/errors";
import { isoDate, num, num0 } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { marketsTable, MARKETS_SOURCE } from "@/lib/queries/markets";
import { demoGa4, demoOrderBins, demoResponse, demoTrendWeeks, responseWindow } from "@/lib/demo/marketsTrends";
import type { DemoRegion } from "@/lib/demo/markets";
import type { Client } from "@/lib/clients";
import type { DateRange } from "@/lib/period";
import { gapReason } from "@/lib/markets/model";
import type { DailySums } from "@/lib/markets/types";
import type { Ga4Raw, Ga4Row, MarketBins, OrderBinsRaw, ResponseRaw, TrendsRaw, WeekRow } from "@/lib/markets/analysis";

type Row = Record<string, unknown>;
type Opts = { demoRegion?: DemoRegion };

/** The `market_daily` sums a period needs, NULL where nothing in the group is measured (as the Overview reads them). */
const SUMS_SQL = `
  SUM(d.orders) AS orders,
  SUM(d.new_customers) AS new_customers,
  SUM(d.returning_orders) AS returning_orders,
  IF(COUNT(d.gross_sales) = 0, NULL, SUM(d.gross_sales)) AS gross_sales,
  IF(COUNT(d.discounts) = 0, NULL, SUM(d.discounts)) AS discounts,
  IF(COUNT(d.refunds) = 0, NULL, SUM(d.refunds)) AS refunds,
  SUM(d.net_sales) AS net_sales,
  SUM(d.net_revenue) AS net_revenue,
  SUM(d.new_customer_revenue) AS new_customer_revenue,
  SUM(d.returning_revenue) AS returning_revenue,
  IF(COUNT(d.new_customer_net_sales) = 0, NULL, SUM(d.new_customer_net_sales)) AS new_customer_net_sales,
  IF(COUNT(d.returning_net_sales) = 0, NULL, SUM(d.returning_net_sales)) AS returning_net_sales,
  SUM(d.new_customer_gross_profit) AS new_customer_gross_profit,
  SUM(d.new_customer_costed_orders) AS new_customer_costed_orders,
  SUM(d.costed_net_sales) AS costed_net_sales,
  IF(SUM(d.costed_orders) = 0, NULL, SUM(d.cogs)) AS cogs,
  IF(SUM(d.costed_orders) = 0, NULL, SUM(d.gross_profit)) AS gross_profit,
  SUM(d.costed_orders) AS costed_orders,
  IF(COUNT(d.discounted_orders) = 0, NULL, SUM(d.discounted_orders)) AS discounted_orders,
  IF(COUNT(d.cod_orders) = 0, NULL, SUM(d.cod_orders)) AS cod_orders,
  IF(COUNT(d.zero_shipping_orders) = 0, NULL, SUM(d.zero_shipping_orders)) AS zero_shipping_orders,
  IF(COUNT(d.shipping_charged) = 0, NULL, SUM(d.shipping_charged)) AS shipping_charged,
  SUM(IFNULL(d.spend_base, 0)) AS spend`;

function toSums(r: Row): DailySums {
  return {
    orders: num0(r.orders),
    newCustomers: num0(r.new_customers),
    returningOrders: num0(r.returning_orders),
    grossSales: num(r.gross_sales),
    discounts: num(r.discounts),
    refunds: num(r.refunds),
    netSales: num0(r.net_sales),
    netRevenue: num0(r.net_revenue),
    newCustomerRevenue: num0(r.new_customer_revenue),
    returningRevenue: num0(r.returning_revenue),
    newCustomerNetSales: num(r.new_customer_net_sales),
    returningNetSales: num(r.returning_net_sales),
    newCustomerGrossProfit: num(r.new_customer_gross_profit),
    newCustomerCostedOrders: num(r.new_customer_costed_orders),
    costedNetSales: num(r.costed_net_sales),
    cogs: num(r.cogs),
    grossProfit: num(r.gross_profit),
    costedOrders: num0(r.costed_orders),
    discountedOrders: num(r.discounted_orders),
    codOrders: num(r.cod_orders),
    zeroShippingOrders: num(r.zero_shipping_orders),
    shippingCharged: num(r.shipping_charged),
    spend: num0(r.spend),
  };
}

/**
 * `market_daily` per market and Monday week. Spend gap days are counted for
 * the client (a day with no spend data at all), as the Overview counts them.
 */
async function weeks(clientId: string, range: DateRange): Promise<WeekRow[]> {
  const t = marketsTable("market_daily");
  const rows = await query<Row>(
    `WITH gaps AS (
       SELECT DATE_TRUNC(date, WEEK(MONDAY)) AS wk, COUNT(DISTINCT date) AS gap
       FROM ${t}
       WHERE client_id = @clientId AND date BETWEEN @from AND @to AND spend_base IS NULL
       GROUP BY wk
     )
     SELECT d.market, DATE_TRUNC(d.date, WEEK(MONDAY)) AS wk, ${SUMS_SQL},
            ANY_VALUE(IFNULL(g.gap, 0)) AS gap
     FROM ${t} d
     LEFT JOIN gaps g ON g.wk = DATE_TRUNC(d.date, WEEK(MONDAY))
     WHERE d.client_id = @clientId AND d.date BETWEEN @from AND @to
     GROUP BY d.market, wk`,
    { clientId, from: range.from, to: range.to }
  );
  return rows.map((r) => ({
    market: String(r.market),
    week: isoDate(r.wk as never) ?? String(r.wk),
    sums: toSums(r),
    spendGapDays: num0(r.gap),
  }));
}

/** Weekly rows for the trends, current range and compare range. */
export async function getTrendWeeks(
  client: Client,
  range: DateRange,
  comparison: DateRange | null,
  opts: Opts = {}
): Promise<TrendsRaw | null> {
  if (isDemo(client.clientId)) return demoTrendWeeks(opts.demoRegion ?? "na", range, comparison);
  return optional(async () => {
    const [cur, prev] = await Promise.all([
      weeks(client.clientId, range),
      comparison ? weeks(client.clientId, comparison) : Promise.resolve(null),
    ]);
    return { source: MARKETS_SOURCE, weeks: cur, compareWeeks: prev };
  }, null);
}

/** Weekly spend and new customers over the 52 weeks ending with the range (the fit window). */
export async function getResponseWeeks(client: Client, range: DateRange, opts: Opts = {}): Promise<ResponseRaw | null> {
  if (isDemo(client.clientId)) return demoResponse(opts.demoRegion ?? "na", range);
  const window = responseWindow(range);
  return optional(async () => ({ window, rows: await weeks(client.clientId, window) }), null);
}

// ---------------------------------------------------------------------------
// GA4
// ---------------------------------------------------------------------------

const GA4_TABLE = `\`${PROJECT_ID}.mart.market_ga4_country_daily\``;

async function ga4Sums(clientId: string, range: DateRange): Promise<Ga4Row[]> {
  const rows = await query<Row>(
    `SELECT IFNULL(iso2, 'ZZ') AS iso, SUM(sessions) AS sessions, SUM(engaged_sessions) AS engaged,
            SUM(unpaid_engaged_sessions) AS unpaid, SUM(add_to_cart_sessions) AS atc, SUM(purchases) AS purchases
     FROM ${GA4_TABLE}
     WHERE client_id = @clientId AND date BETWEEN @from AND @to
     GROUP BY iso`,
    { clientId, from: range.from, to: range.to }
  );
  return rows.map((r) => ({
    iso: String(r.iso),
    sessions: num0(r.sessions),
    engagedSessions: num0(r.engaged),
    unpaidEngagedSessions: num0(r.unpaid),
    addToCartSessions: num0(r.atc),
    purchases: num0(r.purchases),
  }));
}

/** GA4 sessions by country for the range and compare range, with the client's GA4 coverage. */
export async function getGa4Funnel(
  client: Client,
  range: DateRange,
  comparison: DateRange | null,
  opts: Opts = {}
): Promise<Ga4Raw | null> {
  if (isDemo(client.clientId)) return demoGa4(opts.demoRegion ?? "na", range, comparison);
  const clientId = client.clientId;
  return optional(async () => {
    const [span, cur, prev] = await Promise.all([
      query<Row>(
        `SELECT MIN(date) AS first_day, MAX(date) AS last_day,
                COUNT(DISTINCT IF(date BETWEEN @from AND @to, date, NULL)) AS days_cur,
                COUNT(DISTINCT IF(date BETWEEN @cfrom AND @cto, date, NULL)) AS days_prev
         FROM ${GA4_TABLE}
         WHERE client_id = @clientId`,
        {
          clientId,
          from: range.from,
          to: range.to,
          cfrom: comparison?.from ?? range.from,
          cto: comparison?.to ?? range.to,
        }
      ),
      ga4Sums(clientId, range),
      comparison ? ga4Sums(clientId, comparison) : Promise.resolve(null),
    ]);
    const s = span[0] ?? {};
    return {
      firstDay: isoDate(s.first_day as never),
      lastDay: isoDate(s.last_day as never),
      daysCurrent: num0(s.days_cur),
      daysPrevious: comparison ? num0(s.days_prev) : null,
      current: cur,
      previous: prev,
    };
  }, null);
}

// ---------------------------------------------------------------------------
// Order values
// ---------------------------------------------------------------------------

/**
 * Orders per market in fine value bins (net sales: ex VAT, ex shipping, so
 * the shipping a paying order adds does not smear the threshold). Fine width
 * = a round step of p95 / 20, divided by 5; values above p99 fold into the
 * last bin. Null `markets` with a reason when the platform has no shipping split.
 */
export async function getOrderBins(client: Client, range: DateRange, opts: Opts = {}): Promise<OrderBinsRaw | null> {
  if (isDemo(client.clientId)) return demoOrderBins(opts.demoRegion ?? "na", range);
  const t = marketsTable("market_orders");
  return optional(async () => {
    const rows = await query<Row>(
      `WITH o AS (
         SELECT market, GREATEST(CAST(net_sales AS FLOAT64), 0) AS v, is_zero_shipping AS z
         FROM ${t}
         WHERE client_id = @clientId AND order_date BETWEEN @from AND @to AND net_sales IS NOT NULL
       ),
       q AS (
         SELECT market, APPROX_QUANTILES(v, 100)[OFFSET(95)] AS p95, APPROX_QUANTILES(v, 100)[OFFSET(99)] AS p99,
                COUNTIF(z IS NULL) AS null_ship, COUNT(*) AS n
         FROM o GROUP BY market
       ),
       w AS (
         SELECT *, IF(p95 > 0, POW(10, FLOOR(LOG10(p95 / 20))), 1) AS mag FROM q
       ),
       f AS (
         SELECT *, IF(p95 > 0,
                      mag * CASE WHEN p95 / 20 / mag <= 1 THEN 1 WHEN p95 / 20 / mag <= 2 THEN 2 WHEN p95 / 20 / mag <= 5 THEN 5 ELSE 10 END / 5,
                      1) AS fine
         FROM w
       )
       SELECT o.market, ANY_VALUE(f.fine) AS fine, ANY_VALUE(f.p99) AS cap,
              FLOOR(LEAST(o.v, f.p99) / f.fine) * f.fine AS lo,
              COUNT(*) AS orders, COUNTIF(o.z) AS zero_ship,
              ANY_VALUE(f.null_ship) AS null_ship, ANY_VALUE(f.n) AS n
       FROM o JOIN f USING (market)
       GROUP BY o.market, lo`,
      { clientId: client.clientId, from: range.from, to: range.to }
    );
    if (rows.length > 0 && rows.every((r) => num0(r.null_ship) === num0(r.n))) {
      return { markets: null, reason: gapReason("shipping", client.shopPlatform) };
    }
    const by = new Map<string, MarketBins>();
    for (const r of rows) {
      if (num0(r.null_ship) === num0(r.n)) continue;
      const m = String(r.market);
      const mb = by.get(m) ?? { market: m, width: num0(r.fine) || 1, cap: num0(r.cap), bins: [] };
      mb.bins.push({ lo: num0(r.lo), orders: num0(r.orders), zeroShip: num0(r.zero_ship) });
      by.set(m, mb);
    }
    for (const mb of by.values()) mb.bins.sort((a, b) => a.lo - b.lo);
    return { markets: [...by.values()], reason: null };
  }, null);
}
