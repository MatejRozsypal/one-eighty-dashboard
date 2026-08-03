/**
 * Profitability / P&L snapshot — the headline page's data.
 *
 * ── One scan, everything ────────────────────────────────────────────────────
 * A snapshot needs, per metric: the current-period total, the comparison-period
 * total, and a daily series for the sparkline. The naive shape is one query per
 * metric per period. `mart.mart_daily_kpis` is a *view* over 36 months of orders
 * joined to ads data, so every query against it scans on the order of 1.5 MB per
 * day of range — measured 138 MB for a 90-day, two-client read. Twenty small
 * queries would be twenty full scans.
 *
 * Instead this module issues exactly one query returning daily rows across the
 * union of both periods, and does bucketing, summation and series-building in
 * TypeScript. Row counts are tiny (≤ ~730 even for a 12-month year-over-year
 * comparison), so the arithmetic is free and the scan happens once.
 *
 * ── Rates are recomputed, never summed ──────────────────────────────────────
 * Per METRICS.md, no percentage or ratio is pre-computed in the warehouse, and
 * pre-divided columns must not be summed across rows. Every rate here is derived
 * from summed components — MER is SUM(revenue)/SUM(paid_spend), never an average
 * of daily MERs, which would weight a quiet Sunday the same as Black Friday.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { num, safeDiv } from "@/lib/coerce";
import {
  type DateRange,
  type ResolvedPeriod,
  scanBounds,
  delta,
} from "@/lib/period";
import { fxSql, fxParams, type DisplayCurrency } from "@/lib/currency";
import { isDemo } from "@/lib/demo/client";
import { demoPnlDays } from "@/lib/demo/pnl";

/** One day of P&L, already converted into the display currency. */
export interface PnlDay {
  date: string;
  currency: string;
  revenue: number | null;
  netSales: number | null;
  grossRevenueInclTax: number | null;
  shippingRevenue: number | null;
  taxCollected: number | null;
  newCustomerRevenue: number | null;
  returningCustomerRevenue: number | null;
  cogs: number | null;
  cm1: number | null;
  cm2: number | null;
  cm3: number | null;
  metaSpend: number | null;
  googleSpend: number | null;
  paidSpend: number | null;
  orders: number | null;
  uniqueCustomers: number | null;
  newCustomerOrders: number | null;
  returningCustomerOrders: number | null;
}

/** Aggregated totals plus every rate derived from them. */
export interface PnlTotals {
  // Top line
  revenue: number | null;
  netSales: number | null;
  grossRevenueInclTax: number | null;
  shippingRevenue: number | null;
  /** Null for Shoptet — it doesn't split VAT out, so revenue is gross of it. */
  taxCollected: number | null;
  newCustomerRevenue: number | null;
  returningCustomerRevenue: number | null;

  // Costs and margin stack (monotonic: revenue ≥ cm1 ≥ cm2 ≥ cm3)
  cogs: number | null;
  cm1: number | null;
  cm2: number | null;
  cm3: number | null;
  cm1Pct: number | null;
  cm2Pct: number | null;
  cm3Pct: number | null;

  // Paid media
  metaSpend: number | null;
  googleSpend: number | null;
  paidSpend: number | null;

  // Volume
  orders: number | null;
  uniqueCustomers: number | null;
  newCustomerOrders: number | null;
  returningCustomerOrders: number | null;

  // Derived economics
  aov: number | null;
  aovNew: number | null;
  aovReturning: number | null;
  /** Blended MER: revenue per unit of total paid spend (Meta + Google). */
  mer: number | null;
  /** Acquisition MER: first-time-customer revenue per unit of paid spend. */
  amer: number | null;
  /** Paid spend per newly acquired customer order. */
  cac: number | null;
  /** Share of orders from returning customers, this period. */
  returningOrderShare: number | null;
  /** Share of revenue from returning customers, this period. */
  returningRevenueShare: number | null;
}

export interface PnlMetric {
  current: number | null;
  previous: number | null;
  /** Relative change as a fraction; null when there's no usable baseline. */
  delta: number | null;
}

export interface PnlSnapshot {
  period: ResolvedPeriod;
  /** Currency the figures are expressed in. */
  currency: string;
  current: PnlTotals;
  previous: PnlTotals | null;
  /** Daily rows for the current period only — sparkline input. */
  series: PnlDay[];
}

interface PnlRow {
  date: { value: string };
  currency: string;
  revenue: unknown;
  net_sales: unknown;
  gross_revenue_incl_tax: unknown;
  shipping_revenue: unknown;
  tax_collected: unknown;
  new_customer_revenue: unknown;
  returning_customer_revenue: unknown;
  cogs: unknown;
  cm1: unknown;
  cm2: unknown;
  cm3: unknown;
  meta_spend: unknown;
  google_spend: unknown;
  paid_spend: unknown;
  orders: unknown;
  unique_customers: unknown;
  new_customer_orders: unknown;
  returning_customer_orders: unknown;
}

/**
 * Fetch daily P&L rows across the scan window.
 *
 * Money columns are multiplied by the month's FX rate inside SQL when a display
 * currency is requested; counts (orders, customers) never are.
 */
async function fetchDays(
  clientId: string,
  bounds: DateRange,
  display: DisplayCurrency,
  nativeCurrency: string
): Promise<PnlDay[]> {
  // The demo client is served entirely from memory: no SQL is built, no
  // credentials are needed, and there is no path by which a real figure could
  // reach a presentation. Everything below this line is the real client path.
  if (isDemo(clientId)) return demoPnlDays(bounds, display);

  const fx = fxSql(display, "k");
  const m = fx.wrap; // money column → converted expression

  // `mart_daily_kpis` is grained by currency, and Dobias carries a handful of
  // CAD orders alongside USD. In native mode those rows must be excluded —
  // adding CAD to USD produces a number that means nothing. In conversion mode
  // they're kept, because the FX join gives every row a common unit.
  const currencyFilter =
    display === "native" ? "AND k.currency = @nativeCurrency" : "";

  const rows = await query<PnlRow>(
    `SELECT
       k.date,
       ${display === "native" ? "k.currency" : "@displayCurrency AS currency"},
       ${m("k.revenue")}                     AS revenue,
       ${m("k.net_sales")}                   AS net_sales,
       ${m("k.gross_revenue_incl_tax")}      AS gross_revenue_incl_tax,
       ${m("k.shipping_revenue")}            AS shipping_revenue,
       ${m("k.tax_collected")}               AS tax_collected,
       ${m("k.new_customer_revenue")}        AS new_customer_revenue,
       ${m("k.returning_customer_revenue")}  AS returning_customer_revenue,
       ${m("k.cogs")}                        AS cogs,
       ${m("k.cm1")}                         AS cm1,
       ${m("k.cm2")}                         AS cm2,
       ${m("k.cm3")}                         AS cm3,
       ${m("k.meta_spend")}                  AS meta_spend,
       ${m("k.google_spend")}                AS google_spend,
       ${m("k.paid_spend")}                  AS paid_spend,
       k.orders,
       k.unique_customers,
       k.new_customer_orders,
       k.returning_customer_orders
     FROM \`${PROJECT_ID}.mart.mart_daily_kpis\` k
     ${fx.join}
     WHERE k.client_id = @clientId
       AND k.date BETWEEN @scanFrom AND @scanTo
       ${currencyFilter}
     ORDER BY k.date`,
    {
      clientId,
      scanFrom: bounds.from,
      scanTo: bounds.to,
      nativeCurrency,
      ...fxParams(display),
    }
  );

  return rows.map((r) => ({
    date: r.date.value,
    currency: r.currency,
    revenue: num(r.revenue),
    netSales: num(r.net_sales),
    grossRevenueInclTax: num(r.gross_revenue_incl_tax),
    shippingRevenue: num(r.shipping_revenue),
    taxCollected: num(r.tax_collected),
    newCustomerRevenue: num(r.new_customer_revenue),
    returningCustomerRevenue: num(r.returning_customer_revenue),
    cogs: num(r.cogs),
    cm1: num(r.cm1),
    cm2: num(r.cm2),
    cm3: num(r.cm3),
    metaSpend: num(r.meta_spend),
    googleSpend: num(r.google_spend),
    paidSpend: num(r.paid_spend),
    orders: num(r.orders),
    uniqueCustomers: num(r.unique_customers),
    newCustomerOrders: num(r.new_customer_orders),
    returningCustomerOrders: num(r.returning_customer_orders),
  }));
}

/**
 * Sum a column across rows, preserving the null/zero distinction.
 *
 * Returns null only when *every* row is null — meaning the source never
 * reported. If any day has a value, the rest are treated as zero. This is what
 * makes `google_spend` read "—" for a client with no Google Ads, but a real
 * total for one that has it with quiet days.
 */
function sum(rows: PnlDay[], pick: (r: PnlDay) => number | null): number | null {
  let total = 0;
  let seen = false;
  for (const row of rows) {
    const value = pick(row);
    if (value !== null) {
      total += value;
      seen = true;
    }
  }
  return seen ? total : null;
}

function aggregate(rows: PnlDay[]): PnlTotals {
  const revenue = sum(rows, (r) => r.revenue);
  const newCustomerRevenue = sum(rows, (r) => r.newCustomerRevenue);
  const returningCustomerRevenue = sum(rows, (r) => r.returningCustomerRevenue);
  const cm1 = sum(rows, (r) => r.cm1);
  const cm2 = sum(rows, (r) => r.cm2);
  const cm3 = sum(rows, (r) => r.cm3);
  const paidSpend = sum(rows, (r) => r.paidSpend);
  const orders = sum(rows, (r) => r.orders);
  const newCustomerOrders = sum(rows, (r) => r.newCustomerOrders);
  const returningCustomerOrders = sum(rows, (r) => r.returningCustomerOrders);

  return {
    revenue,
    netSales: sum(rows, (r) => r.netSales),
    grossRevenueInclTax: sum(rows, (r) => r.grossRevenueInclTax),
    shippingRevenue: sum(rows, (r) => r.shippingRevenue),
    taxCollected: sum(rows, (r) => r.taxCollected),
    newCustomerRevenue,
    returningCustomerRevenue,

    cogs: sum(rows, (r) => r.cogs),
    cm1,
    cm2,
    cm3,
    cm1Pct: safeDiv(cm1, revenue),
    cm2Pct: safeDiv(cm2, revenue),
    cm3Pct: safeDiv(cm3, revenue),

    metaSpend: sum(rows, (r) => r.metaSpend),
    googleSpend: sum(rows, (r) => r.googleSpend),
    paidSpend,

    orders,
    uniqueCustomers: sum(rows, (r) => r.uniqueCustomers),
    newCustomerOrders,
    returningCustomerOrders,

    aov: safeDiv(revenue, orders),
    aovNew: safeDiv(newCustomerRevenue, newCustomerOrders),
    aovReturning: safeDiv(returningCustomerRevenue, returningCustomerOrders),
    mer: safeDiv(revenue, paidSpend),
    amer: safeDiv(newCustomerRevenue, paidSpend),
    cac: safeDiv(paidSpend, newCustomerOrders),
    returningOrderShare: safeDiv(returningCustomerOrders, orders),
    returningRevenueShare: safeDiv(returningCustomerRevenue, revenue),
  };
}

function inRange(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

export async function getPnlSnapshot(
  clientId: string,
  nativeCurrency: string,
  period: ResolvedPeriod,
  display: DisplayCurrency = "native"
): Promise<PnlSnapshot> {
  const rows = await fetchDays(
    clientId,
    scanBounds(period),
    display,
    nativeCurrency
  );

  const currentRows = rows.filter((r) => inRange(r.date, period.current));
  const previousRows = period.comparison
    ? rows.filter((r) => inRange(r.date, period.comparison!))
    : [];

  return {
    period,
    currency: display === "native" ? nativeCurrency : display,
    current: aggregate(currentRows),
    previous: period.comparison ? aggregate(previousRows) : null,
    series: currentRows,
  };
}

/** Pair a metric's current and previous values with the delta between them. */
export function metric(
  snapshot: PnlSnapshot,
  pick: (t: PnlTotals) => number | null
): PnlMetric {
  const current = pick(snapshot.current);
  const previous = snapshot.previous ? pick(snapshot.previous) : null;
  return { current, previous, delta: delta(current, previous) };
}
