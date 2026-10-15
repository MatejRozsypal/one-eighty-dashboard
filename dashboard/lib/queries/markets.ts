/**
 * Markets: the contract tables, read for one client and one period.
 *
 * ── Which tables ────────────────────────────────────────────────────────────
 * `MARKETS_SOURCE` picks the dataset, the same kind of switch as KPIS_SOURCE:
 *
 *   mart_qa (default)  `mart_qa.mk_market_*`, the QA build
 *   mart               `mart.market_*`, once the owner signs off prod DDL
 *
 * Flipping the env and redeploying the same commit is the whole cut-over; no
 * code names a table directly.
 *
 * ── What is read ────────────────────────────────────────────────────────────
 * Period sums from `market_daily`, order-grain extras (first-order GP, discount
 * depth, full-price share, refunded orders, local currency, payment mix) from
 * `market_orders`, spend and its allocation rule from `market_spend_daily`
 * (the only table with the UNALLOCATED row), cohorts and the latest forecast
 * run. Everything else is derived in `lib/markets/model.ts`, the same code the
 * demo fixture goes through.
 *
 * A table that does not exist yet (QA build not run) returns null and the page
 * says so in one line; any other failure reaches the error page.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { optional } from "@/lib/queries/errors";
import { isoDate, num, num0 } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { demoMarkets, type DemoRegion } from "@/lib/demo/markets";
import type { Client } from "@/lib/clients";
import type { DateRange } from "@/lib/period";
import {
  COHORT_AGES,
  type Allocation,
  type AllocationRule,
  type CohortRow,
  type DailySums,
  type ForecastMethod,
  type CountryOrders,
  type ForecastRow,
  type MarketLifetimeRaw,
  type MarketPeriodRaw,
  type MarketsRaw,
  type MarketsSource,
  type OrderExtras,
} from "@/lib/markets/types";

export const MARKETS_SOURCE: Exclude<MarketsSource, "demo"> =
  process.env.MARKETS_SOURCE === "mart" ? "mart" : "mart_qa";

/** Fully qualified table name for the active source. */
export function marketsTable(
  name: "market_orders" | "market_daily" | "market_spend_daily" | "market_cohorts" | "market_forecast" | "client_markets"
): string {
  // The market config lives in `ref` in prod (`ref.client_markets`), next to the marts in QA.
  if (name === "client_markets") {
    return MARKETS_SOURCE === "mart" ? `\`${PROJECT_ID}.ref.client_markets\`` : `\`${PROJECT_ID}.mart_qa.mk_client_markets\``;
  }
  const table = MARKETS_SOURCE === "mart" ? name : `mk_${name}`;
  return `\`${PROJECT_ID}.${MARKETS_SOURCE}.${table}\``;
}

type Row = Record<string, unknown>;

async function periodSums(clientId: string, range: DateRange): Promise<Map<string, DailySums>> {
  const rows = await query<Row>(
    `SELECT market,
            SUM(orders) AS orders,
            SUM(new_customers) AS new_customers,
            SUM(returning_orders) AS returning_orders,
            IF(COUNT(gross_sales) = 0, NULL, SUM(gross_sales)) AS gross_sales,
            IF(COUNT(discounts) = 0, NULL, SUM(discounts)) AS discounts,
            IF(COUNT(refunds) = 0, NULL, SUM(refunds)) AS refunds,
            SUM(net_sales) AS net_sales,
            SUM(net_revenue) AS net_revenue,
            SUM(new_customer_revenue) AS new_customer_revenue,
            SUM(returning_revenue) AS returning_revenue,
            IF(COUNT(new_customer_net_sales) = 0, NULL, SUM(new_customer_net_sales)) AS new_customer_net_sales,
            IF(COUNT(returning_net_sales) = 0, NULL, SUM(returning_net_sales)) AS returning_net_sales,
            SUM(new_customer_gross_profit) AS new_customer_gross_profit,
            SUM(new_customer_costed_orders) AS new_customer_costed_orders,
            SUM(costed_net_sales) AS costed_net_sales,
            IF(SUM(costed_orders) = 0, NULL, SUM(cogs)) AS cogs,
            IF(SUM(costed_orders) = 0, NULL, SUM(gross_profit)) AS gross_profit,
            SUM(costed_orders) AS costed_orders,
            IF(COUNT(discounted_orders) = 0, NULL, SUM(discounted_orders)) AS discounted_orders,
            IF(COUNT(cod_orders) = 0, NULL, SUM(cod_orders)) AS cod_orders,
            IF(COUNT(zero_shipping_orders) = 0, NULL, SUM(zero_shipping_orders)) AS zero_shipping_orders,
            IF(COUNT(shipping_charged) = 0, NULL, SUM(shipping_charged)) AS shipping_charged
     FROM ${marketsTable("market_daily")}
     WHERE client_id = @clientId AND date BETWEEN @from AND @to
     GROUP BY market`,
    { clientId, from: range.from, to: range.to }
  );
  const out = new Map<string, DailySums>();
  for (const r of rows) {
    out.set(String(r.market), {
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
      spend: 0,
    });
  }
  return out;
}

async function periodSpend(clientId: string, range: DateRange): Promise<Map<string, Allocation>> {
  const rows = await query<Row>(
    `SELECT market, allocation, SUM(spend_base) AS spend
     FROM ${marketsTable("market_spend_daily")}
     WHERE client_id = @clientId AND date BETWEEN @from AND @to
     GROUP BY market, allocation`,
    { clientId, from: range.from, to: range.to }
  );
  const out = new Map<string, Allocation>();
  for (const r of rows) {
    const m = String(r.market);
    const a = out.get(m) ?? {};
    const rule = String(r.allocation) as AllocationRule;
    a[rule] = (a[rule] ?? 0) + num0(r.spend);
    out.set(m, a);
  }
  return out;
}

async function periodExtras(clientId: string, range: DateRange): Promise<Map<string, OrderExtras>> {
  const params = { clientId, from: range.from, to: range.to };
  const [rows, mix] = await Promise.all([
    query<Row>(
      `SELECT market,
              SUM(IF(is_new_customer AND cogs IS NOT NULL, gross_profit, 0)) AS first_order_gp,
              COUNTIF(is_new_customer AND cogs IS NOT NULL) AS first_order_costed,
              IF(COUNT(gross_sales) = 0, NULL, SUM(IF(is_discounted, gross_sales, 0))) AS discounted_gross,
              IF(COUNT(discounts) = 0, NULL, SUM(IF(is_discounted, discounts, 0))) AS discounted_discounts,
              IF(COUNT(discounts) = 0, NULL, SUM(IF(is_discounted, 0, net_revenue))) AS full_price_revenue,
              IF(COUNT(gross_sales) = 0, NULL, SUM(IF(is_new_customer, gross_sales, 0))) AS new_gross,
              IF(COUNT(discounts) = 0, NULL, SUM(IF(is_new_customer, discounts, 0))) AS new_discounts,
              IF(COUNT(gross_sales) = 0, NULL, SUM(IF(is_new_customer, 0, gross_sales))) AS returning_gross,
              IF(COUNT(discounts) = 0, NULL, SUM(IF(is_new_customer, 0, discounts))) AS returning_discounts,
              IF(COUNT(refunds) = 0, NULL, COUNTIF(refunds > 0)) AS refunded_orders,
              SUM(SAFE_DIVIDE(net_revenue, fx_local_to_base)) AS local_revenue,
              COUNT(DISTINCT currency_local) AS local_currencies,
              ANY_VALUE(currency_local) AS local_currency
       FROM ${marketsTable("market_orders")}
       WHERE client_id = @clientId AND order_date BETWEEN @from AND @to
       GROUP BY market`,
      params
    ),
    query<Row>(
      `SELECT market, payment_method, orders FROM (
         SELECT market, payment_method, COUNT(*) AS orders,
                ROW_NUMBER() OVER (PARTITION BY market ORDER BY COUNT(*) DESC) AS rk
         FROM ${marketsTable("market_orders")}
         WHERE client_id = @clientId AND order_date BETWEEN @from AND @to AND payment_method IS NOT NULL
         GROUP BY market, payment_method)
       WHERE rk <= 5`,
      params
    ),
  ]);
  const out = new Map<string, OrderExtras>();
  for (const r of rows) {
    const single = num0(r.local_currencies) === 1;
    out.set(String(r.market), {
      firstOrderGrossProfit: num(r.first_order_gp),
      firstOrderCosted: num0(r.first_order_costed),
      discountedGross: num(r.discounted_gross),
      discountedDiscounts: num(r.discounted_discounts),
      fullPriceRevenue: num(r.full_price_revenue),
      newGross: num(r.new_gross),
      newDiscounts: num(r.new_discounts),
      returningGross: num(r.returning_gross),
      returningDiscounts: num(r.returning_discounts),
      refundedOrders: num(r.refunded_orders),
      localRevenue: single ? num(r.local_revenue) : null,
      localCurrency: single && r.local_currency ? String(r.local_currency) : null,
      paymentMix: [],
    });
  }
  for (const r of mix) {
    const x = out.get(String(r.market));
    if (x) x.paymentMix.push({ method: String(r.payment_method), orders: num0(r.orders) });
  }
  for (const x of out.values()) x.paymentMix.sort((a, b) => b.orders - a.orders);
  return out;
}

async function period(
  clientId: string,
  range: DateRange
): Promise<{ rows: MarketPeriodRaw[]; allocation: Map<string, Allocation> }> {
  const [sums, spend, extras] = await Promise.all([
    periodSums(clientId, range),
    periodSpend(clientId, range),
    periodExtras(clientId, range),
  ]);
  const markets = new Set([...sums.keys(), ...spend.keys()]);
  const rows = [...markets].map((market) => {
    const s = sums.get(market) ?? {
      orders: 0, newCustomers: 0, returningOrders: 0, grossSales: null, discounts: null, refunds: null,
      netSales: 0, netRevenue: 0, newCustomerRevenue: 0, returningRevenue: 0,
      newCustomerNetSales: null, returningNetSales: null, newCustomerGrossProfit: null, newCustomerCostedOrders: null,
      costedNetSales: null, cogs: null, grossProfit: null,
      costedOrders: 0, discountedOrders: null, codOrders: null, zeroShippingOrders: null, shippingCharged: null, spend: 0,
    };
    const a = spend.get(market) ?? {};
    s.spend = Object.values(a).reduce((t, v) => t + (v ?? 0), 0);
    return { market, sums: s, extras: extras.get(market) ?? null };
  });
  return { rows, allocation: spend };
}

function age<T>(r: Row, prefix: string, conv: (v: unknown) => T): Partial<Record<(typeof COHORT_AGES)[number], T>> {
  const out: Partial<Record<(typeof COHORT_AGES)[number], T>> = {};
  for (const a of COHORT_AGES) out[a] = conv(r[`${prefix}_${a}`]);
  return out;
}

async function cohorts(clientId: string): Promise<CohortRow[]> {
  // A cohort month with days of no spend data at all (ad history starting
  // mid-month, Dobias 2026-04) has a lower-bound cohort_spend: read it as
  // missing, so cohort CAC and LTGP:CAC say n/a rather than flatter.
  const rows = await query<Row>(
    `WITH gaps AS (
       SELECT DISTINCT DATE_TRUNC(date, MONTH) AS m
       FROM ${marketsTable("market_daily")}
       WHERE client_id = @clientId AND spend_base IS NULL
     )
     SELECT c.first_order_market AS market, c.cohort_month, c.customers, c.costed_customers,
            ${COHORT_AGES.map((a) => `c.repeat_customers_${a}, c.revenue_${a}, c.gp_${a}`).join(", ")},
            IF(g.m IS NULL, c.cohort_spend, NULL) AS cohort_spend, c.first_order_gp
     FROM ${marketsTable("market_cohorts")} c
     LEFT JOIN gaps g ON g.m = c.cohort_month
     WHERE c.client_id = @clientId
     ORDER BY c.cohort_month`,
    { clientId }
  );
  return rows.map((r) => ({
    market: String(r.market),
    cohortMonth: isoDate(r.cohort_month as never) ?? String(r.cohort_month),
    customers: num0(r.customers),
    costedCustomers: num0(r.costed_customers),
    repeatCustomers: age(r, "repeat_customers", num),
    revenue: age(r, "revenue", num),
    gp: age(r, "gp", num),
    cohortSpend: num(r.cohort_spend),
    firstOrderGp: num(r.first_order_gp),
  }));
}

async function forecast(clientId: string): Promise<ForecastRow[]> {
  const rows = await query<Row>(
    `SELECT first_order_market AS market, cohort_month, customers, as_of_age_days, actual_gp_per_customer,
            forecast_gp365_per_customer, band_low, band_high, multiplier, n_reference_cohorts,
            method, reason_if_none, run_date
     FROM ${marketsTable("market_forecast")}
     WHERE client_id = @clientId
       AND run_date = (SELECT MAX(run_date) FROM ${marketsTable("market_forecast")} WHERE client_id = @clientId)`,
    { clientId }
  );
  return rows.map((r) => ({
    market: String(r.market),
    cohortMonth: isoDate(r.cohort_month as never) ?? String(r.cohort_month),
    customers: num(r.customers),
    asOfAgeDays: num0(r.as_of_age_days),
    actualGpPerCustomer: num(r.actual_gp_per_customer),
    forecastGp365PerCustomer: num(r.forecast_gp365_per_customer),
    bandLow: num(r.band_low),
    bandHigh: num(r.band_high),
    multiplier: num(r.multiplier),
    nReferenceCohorts: num(r.n_reference_cohorts),
    method: (String(r.method ?? "none") as ForecastMethod),
    reasonIfNone: r.reason_if_none ? String(r.reason_if_none) : null,
    runDate: isoDate(r.run_date as never) ?? String(r.run_date),
  }));
}

/** Days in a range with no spend data at all for the client (`spend_base` NULL). */
async function spendGapDays(clientId: string, range: DateRange): Promise<number> {
  const rows = await query<Row>(
    `SELECT COUNT(DISTINCT date) AS days
     FROM ${marketsTable("market_daily")}
     WHERE client_id = @clientId AND date BETWEEN @from AND @to AND spend_base IS NULL`,
    { clientId, from: range.from, to: range.to }
  );
  return num0(rows[0]?.days);
}

/** Orders inside OTHER, split back by their own country, for Scouting. */
async function otherCountries(clientId: string, range: DateRange): Promise<CountryOrders[]> {
  const rows = await query<Row>(
    `SELECT country, COUNT(*) AS orders, COUNTIF(is_new_customer) AS new_customers,
            SUM(net_revenue) AS net_revenue, SUM(IF(is_new_customer, net_sales, 0)) AS new_net_sales
     FROM ${marketsTable("market_orders")}
     WHERE client_id = @clientId AND order_date BETWEEN @from AND @to
       AND market = 'OTHER' AND country IS NOT NULL
     GROUP BY country`,
    { clientId, from: range.from, to: range.to }
  );
  return rows.map((r) => ({
    iso: String(r.country),
    orders: num0(r.orders),
    newCustomers: num0(r.new_customers),
    netRevenue: num0(r.net_revenue),
    newCustomerNetSales: num0(r.new_net_sales),
  }));
}

interface MarketConfig {
  markets: string[];
  home: string | null;
  localCurrencyOf: Record<string, string>;
}

/** The client's sold markets, home market and local currencies; null without config rows. */
async function clientMarkets(clientId: string): Promise<MarketConfig | null> {
  const rows = await optional(
    () =>
      query<Row>(
        `SELECT market, local_currency, is_home FROM ${marketsTable("client_markets")} WHERE client_id = @clientId`,
        { clientId }
      ),
    [] as Row[]
  );
  if (rows.length === 0) return null;
  return {
    markets: rows.map((r) => String(r.market)),
    home: rows.find((r) => r.is_home === true)?.market ? String(rows.find((r) => r.is_home === true)!.market) : null,
    localCurrencyOf: Object.fromEntries(rows.filter((r) => r.local_currency).map((r) => [String(r.market), String(r.local_currency)])),
  };
}

async function lifetimeAndSold(clientId: string, to: string): Promise<{
  lifetime: Record<string, MarketLifetimeRaw>;
  sold: string[];
  lastDay: string | null;
}> {
  const [life, sold, last] = await Promise.all([
    query<Row>(
      `SELECT market, MIN(order_date) AS first_order_date, COUNT(*) AS orders
       FROM ${marketsTable("market_orders")}
       WHERE client_id = @clientId
       GROUP BY market`,
      { clientId }
    ),
    query<Row>(
      `SELECT DISTINCT market
       FROM ${marketsTable("market_spend_daily")}
       WHERE client_id = @clientId AND spend_base > 0
         AND date BETWEEN DATE_SUB(DATE(@to), INTERVAL 364 DAY) AND DATE(@to)`,
      { clientId, to }
    ),
    query<Row>(
      `SELECT MAX(date) AS last_day FROM ${marketsTable("market_daily")} WHERE client_id = @clientId`,
      { clientId }
    ),
  ]);
  const lifetime: Record<string, MarketLifetimeRaw> = {};
  for (const r of life) {
    lifetime[String(r.market)] = {
      firstOrderDate: isoDate(r.first_order_date as never) ?? String(r.first_order_date),
      orders: num0(r.orders),
    };
  }
  return {
    lifetime,
    sold: sold.map((r) => String(r.market)),
    lastDay: isoDate(last[0]?.last_day as never) ?? null,
  };
}

/**
 * Everything the Markets page needs for one client and period. Null when the
 * Markets tables are not built for the active source.
 */
export async function getMarkets(
  client: Client,
  range: DateRange,
  comparison: DateRange | null,
  opts: { demoRegion?: DemoRegion } = {}
): Promise<MarketsRaw | null> {
  if (isDemo(client.clientId)) return demoMarkets(opts.demoRegion ?? "na", range, comparison);

  const clientId = client.clientId;
  return optional(async () => {
    const [current, previous, life, cohortRows, forecastRows, config, gapCur, gapPrev, others] = await Promise.all([
      period(clientId, range),
      comparison ? period(clientId, comparison) : Promise.resolve(null),
      lifetimeAndSold(clientId, range.to),
      cohorts(clientId),
      forecast(clientId),
      clientMarkets(clientId),
      spendGapDays(clientId, range),
      comparison ? spendGapDays(clientId, comparison) : Promise.resolve(null),
      otherCountries(clientId, range),
    ]);
    if (!life.lastDay) return null;
    return {
      source: MARKETS_SOURCE,
      baseCurrency: client.currency,
      platform: client.shopPlatform,
      homeMarket: config?.home ?? client.country,
      lastCompleteDay: life.lastDay,
      range,
      compareRange: comparison,
      current: current.rows,
      previous: previous?.rows ?? null,
      allocation: Object.fromEntries(current.allocation),
      lifetime: life.lifetime,
      configuredMarkets: config?.markets ?? null,
      localCurrencyOf: config?.localCurrencyOf ?? {},
      spendMarkets365: life.sold,
      spendGapDays: { current: gapCur, previous: gapPrev },
      otherCountries: others,
      cohorts: cohortRows,
      forecast: forecastRows,
    } satisfies MarketsRaw;
  }, null);
}
