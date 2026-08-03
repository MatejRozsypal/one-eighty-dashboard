"use strict";
/**
 * Customer lifetime economics — LTV, LTGP, orders per customer.
 *
 * Reads `mart.mart_customer_lifetime`, which aggregates every order in the
 * 36-month window down to one row per customer. That window is a real limit,
 * not a rounding detail: a customer whose first-ever order predates it looks
 * like a new customer here, which understates both repeat rate and LTV. The UI
 * states this rather than hiding it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLifetimeSummary = getLifetimeSummary;
exports.getTopCustomers = getTopCustomers;
exports.getPayback = getPayback;
const bigquery_1 = require("@/lib/bigquery");
const coerce_1 = require("@/lib/coerce");
const errors_1 = require("@/lib/queries/errors");
const client_1 = require("@/lib/demo/client");
const customers_1 = require("@/lib/demo/customers");
async function getLifetimeSummary(clientId, currency) {
    // Demo client: served from memory, never from the warehouse.
    if ((0, client_1.isDemo)(clientId))
        return (0, customers_1.demoLifetimeSummary)();
    // The inner SELECT is not cosmetic. `mart_customer_lifetime` is a view whose
    // columns are themselves aggregates — `aov` is SAFE_DIVIDE(SUM(...), COUNT(*))
    // and `is_returning` is COUNT(*) > 1. Aggregating those directly makes
    // BigQuery inline the view and reject the query with "Aggregations of
    // aggregations are not allowed". Selecting the columns in a subquery first
    // creates the block boundary that keeps the two levels apart.
    const [row] = await (0, bigquery_1.query)(`SELECT
       COUNT(*)                                     AS customers,
       AVG(lifetime_revenue)                        AS ltv,
       AVG(lifetime_gross_profit)                   AS ltgp,
       AVG(total_orders)                            AS orders_per_customer,
       AVG(aov)                                     AS avg_aov,
       SAFE_DIVIDE(COUNTIF(is_returning), COUNT(*)) AS repeat_rate,
       AVG(IF(is_returning, days_active, NULL))     AS avg_days_active
     FROM (
       SELECT lifetime_revenue, lifetime_gross_profit, total_orders,
              aov, is_returning, days_active
       FROM \`${bigquery_1.PROJECT_ID}.mart.mart_customer_lifetime\`
       WHERE client_id = @clientId AND currency = @currency
     )`, { clientId, currency });
    const ltv = (0, coerce_1.num)(row?.ltv);
    const ltgp = (0, coerce_1.num)(row?.ltgp);
    return {
        currency,
        customers: (0, coerce_1.num)(row?.customers),
        ltv,
        ltgp,
        ltgpRatio: (0, coerce_1.safeDiv)(ltgp, ltv),
        ordersPerCustomer: (0, coerce_1.num)(row?.orders_per_customer),
        avgAov: (0, coerce_1.num)(row?.avg_aov),
        repeatRate: (0, coerce_1.num)(row?.repeat_rate),
        avgDaysActive: (0, coerce_1.num)(row?.avg_days_active),
    };
}
/**
 * Top customers by lifetime revenue.
 *
 * Emails are masked in SQL, not in TypeScript. The design mocks them as
 * `p••••a@seznam.cz`, and doing the masking server-side means a full address
 * never reaches the browser at all — this is customer PII on an internal tool
 * that will eventually be shown to clients.
 */
async function getTopCustomers(clientId, currency, limit = 25) {
    // Demo client: served from memory, never from the warehouse.
    if ((0, client_1.isDemo)(clientId))
        return (0, customers_1.demoTopCustomers)(limit);
    const rows = await (0, bigquery_1.query)(`SELECT
       CONCAT(
         SUBSTR(SPLIT(customer_email, '@')[OFFSET(0)], 1, 1),
         '••••',
         SUBSTR(SPLIT(customer_email, '@')[OFFSET(0)], -1),
         '@',
         SPLIT(customer_email, '@')[SAFE_OFFSET(1)]
       )                          AS email,
       first_order_date, last_order_date, total_orders,
       lifetime_revenue, lifetime_gross_profit, aov, days_active, is_returning
     FROM \`${bigquery_1.PROJECT_ID}.mart.mart_customer_lifetime\`
     WHERE client_id = @clientId AND currency = @currency
       AND STRPOS(customer_email, '@') > 1
     ORDER BY lifetime_revenue DESC
     LIMIT @limit`, { clientId, currency, limit });
    return rows.map((r) => ({
        email: String(r.email ?? "—"),
        firstOrder: (0, coerce_1.isoDate)(r.first_order_date),
        lastOrder: (0, coerce_1.isoDate)(r.last_order_date),
        orders: (0, coerce_1.num)(r.total_orders),
        lifetimeRevenue: (0, coerce_1.num)(r.lifetime_revenue),
        lifetimeGrossProfit: (0, coerce_1.num)(r.lifetime_gross_profit),
        aov: (0, coerce_1.num)(r.aov),
        daysActive: (0, coerce_1.num)(r.days_active),
        isReturning: r.is_returning === true,
    }));
}
async function getPayback(clientId, currency, monthsBack = 12) {
    // Demo client: served from memory, never from the warehouse.
    if ((0, client_1.isDemo)(clientId))
        return (0, customers_1.demoPayback)(monthsBack);
    try {
        const [rows, spend] = await Promise.all([
            (0, bigquery_1.query)(`SELECT SUM(customers_90d_complete) AS customers,
                SUM(gross_profit_30d_of_90d_cohort) AS gp30,
                SUM(gross_profit_90d) AS gp90
         FROM \`${bigquery_1.PROJECT_ID}.mart.mart_customer_payback\`
         WHERE client_id = @clientId AND currency = @currency
           AND cohort_date >= DATE_SUB(CURRENT_DATE(), INTERVAL @monthsBack MONTH)`, { clientId, currency, monthsBack }),
            (0, bigquery_1.query)(`SELECT SUM(paid_spend) AS spend, SUM(new_customer_orders) AS new_orders
         FROM \`${bigquery_1.PROJECT_ID}.mart.mart_daily_kpis\`
         WHERE client_id = @clientId
           AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL @monthsBack MONTH)`, { clientId, monthsBack }),
        ]);
        const customers = (0, coerce_1.num)(rows[0]?.customers);
        if (!customers)
            return null;
        const ltgp30 = (0, coerce_1.safeDiv)((0, coerce_1.num)(rows[0]?.gp30), customers);
        const ltgp90 = (0, coerce_1.safeDiv)((0, coerce_1.num)(rows[0]?.gp90), customers);
        // New-customer *orders* stands in for new customers: a first order is by
        // definition one customer, so over a long window the two converge.
        const cac = (0, coerce_1.safeDiv)((0, coerce_1.num)(spend[0]?.spend), (0, coerce_1.num)(spend[0]?.new_orders));
        return {
            customers,
            ltgp30,
            ltgp90,
            cac,
            recovery30: cac ? (0, coerce_1.safeDiv)(ltgp30, cac) : null,
            ltgpToCac: cac ? (0, coerce_1.safeDiv)(ltgp90, cac) : null,
        };
    }
    catch (error) {
        if (!(0, errors_1.isMissingObject)(error))
            throw error;
        return null;
    }
}
