"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPnlSnapshot = getPnlSnapshot;
exports.metric = metric;
const bigquery_1 = require("@/lib/bigquery");
const coerce_1 = require("@/lib/coerce");
const period_1 = require("@/lib/period");
const currency_1 = require("@/lib/currency");
const client_1 = require("@/lib/demo/client");
const pnl_1 = require("@/lib/demo/pnl");
/**
 * Fetch daily P&L rows across the scan window.
 *
 * Money columns are multiplied by the month's FX rate inside SQL when a display
 * currency is requested; counts (orders, customers) never are.
 */
async function fetchDays(clientId, bounds, display, nativeCurrency) {
    // The demo client is served entirely from memory: no SQL is built, no
    // credentials are needed, and there is no path by which a real figure could
    // reach a presentation. Everything below this line is the real client path.
    if ((0, client_1.isDemo)(clientId))
        return (0, pnl_1.demoPnlDays)(bounds, display);
    const fx = (0, currency_1.fxSql)(display, "k");
    const m = fx.wrap; // money column → converted expression
    // `mart_daily_kpis` is grained by currency, and Dobias carries a handful of
    // CAD orders alongside USD. In native mode those rows must be excluded —
    // adding CAD to USD produces a number that means nothing. In conversion mode
    // they're kept, because the FX join gives every row a common unit.
    const currencyFilter = display === "native" ? "AND k.currency = @nativeCurrency" : "";
    const rows = await (0, bigquery_1.query)(`SELECT
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
     FROM \`${bigquery_1.PROJECT_ID}.mart.mart_daily_kpis\` k
     ${fx.join}
     WHERE k.client_id = @clientId
       AND k.date BETWEEN @scanFrom AND @scanTo
       ${currencyFilter}
     ORDER BY k.date`, {
        clientId,
        scanFrom: bounds.from,
        scanTo: bounds.to,
        nativeCurrency,
        ...(0, currency_1.fxParams)(display),
    });
    return rows.map((r) => ({
        date: r.date.value,
        currency: r.currency,
        revenue: (0, coerce_1.num)(r.revenue),
        netSales: (0, coerce_1.num)(r.net_sales),
        grossRevenueInclTax: (0, coerce_1.num)(r.gross_revenue_incl_tax),
        shippingRevenue: (0, coerce_1.num)(r.shipping_revenue),
        taxCollected: (0, coerce_1.num)(r.tax_collected),
        newCustomerRevenue: (0, coerce_1.num)(r.new_customer_revenue),
        returningCustomerRevenue: (0, coerce_1.num)(r.returning_customer_revenue),
        cogs: (0, coerce_1.num)(r.cogs),
        cm1: (0, coerce_1.num)(r.cm1),
        cm2: (0, coerce_1.num)(r.cm2),
        cm3: (0, coerce_1.num)(r.cm3),
        metaSpend: (0, coerce_1.num)(r.meta_spend),
        googleSpend: (0, coerce_1.num)(r.google_spend),
        paidSpend: (0, coerce_1.num)(r.paid_spend),
        orders: (0, coerce_1.num)(r.orders),
        uniqueCustomers: (0, coerce_1.num)(r.unique_customers),
        newCustomerOrders: (0, coerce_1.num)(r.new_customer_orders),
        returningCustomerOrders: (0, coerce_1.num)(r.returning_customer_orders),
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
function sum(rows, pick) {
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
function aggregate(rows) {
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
        cm1Pct: (0, coerce_1.safeDiv)(cm1, revenue),
        cm2Pct: (0, coerce_1.safeDiv)(cm2, revenue),
        cm3Pct: (0, coerce_1.safeDiv)(cm3, revenue),
        metaSpend: sum(rows, (r) => r.metaSpend),
        googleSpend: sum(rows, (r) => r.googleSpend),
        paidSpend,
        orders,
        uniqueCustomers: sum(rows, (r) => r.uniqueCustomers),
        newCustomerOrders,
        returningCustomerOrders,
        aov: (0, coerce_1.safeDiv)(revenue, orders),
        aovNew: (0, coerce_1.safeDiv)(newCustomerRevenue, newCustomerOrders),
        aovReturning: (0, coerce_1.safeDiv)(returningCustomerRevenue, returningCustomerOrders),
        mer: (0, coerce_1.safeDiv)(revenue, paidSpend),
        amer: (0, coerce_1.safeDiv)(newCustomerRevenue, paidSpend),
        cac: (0, coerce_1.safeDiv)(paidSpend, newCustomerOrders),
        returningOrderShare: (0, coerce_1.safeDiv)(returningCustomerOrders, orders),
        returningRevenueShare: (0, coerce_1.safeDiv)(returningCustomerRevenue, revenue),
    };
}
function inRange(date, range) {
    return date >= range.from && date <= range.to;
}
async function getPnlSnapshot(clientId, nativeCurrency, period, display = "native") {
    const rows = await fetchDays(clientId, (0, period_1.scanBounds)(period), display, nativeCurrency);
    const currentRows = rows.filter((r) => inRange(r.date, period.current));
    const previousRows = period.comparison
        ? rows.filter((r) => inRange(r.date, period.comparison))
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
function metric(snapshot, pick) {
    const current = pick(snapshot.current);
    const previous = snapshot.previous ? pick(snapshot.previous) : null;
    return { current, previous, delta: (0, period_1.delta)(current, previous) };
}
