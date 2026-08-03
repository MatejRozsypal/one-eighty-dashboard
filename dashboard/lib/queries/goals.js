"use strict";
/**
 * Actuals to measure targets against.
 *
 * ── Why this aggregates daily rows rather than reading a monthly mart ───────
 * `mart_monthly_kpis` exists and the Growth page uses it, but it is read there
 * for revenue, new-customer counts and CM3 only — nothing in this codebase
 * reads a total order count from it, so whether it carries one is unverified.
 * `mart_daily_kpis` demonstrably carries all four figures, because the P&L
 * snapshot reads every one of them. Summing days is a little more scan for a
 * guarantee that the number exists and matches the rest of the dashboard.
 *
 * Attainment is therefore computed against the same daily spine the snapshot
 * uses, which is what stops the Goals page and the headline disagreeing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.actualFor = actualFor;
exports.getGoalActuals = getGoalActuals;
exports.getGoals = getGoals;
const bigquery_1 = require("@/lib/bigquery");
const coerce_1 = require("@/lib/coerce");
const client_1 = require("@/lib/demo/client");
const goals_1 = require("@/lib/demo/goals");
const store_1 = require("@/lib/goals/store");
function actualFor(row, metric) {
    if (!row)
        return null;
    return row[metric];
}
async function getGoalActuals(clientId, nativeCurrency, year) {
    if ((0, client_1.isDemo)(clientId))
        return (0, goals_1.demoGoalActuals)(year);
    const rows = await (0, bigquery_1.query)(`SELECT
       DATE_TRUNC(date, MONTH)         AS month,
       SUM(revenue)                    AS revenue,
       SUM(orders)                     AS orders,
       SUM(new_customer_orders)        AS new_customers,
       SUM(cm3)                        AS cm3
     FROM \`${bigquery_1.PROJECT_ID}.mart.mart_daily_kpis\`
     WHERE client_id = @clientId
       AND currency  = @currency
       AND date >= DATE(@year, 1, 1)
       AND date <  DATE(@nextYear, 1, 1)
     GROUP BY month
     ORDER BY month`, {
        clientId,
        currency: nativeCurrency,
        year,
        nextYear: year + 1,
    });
    return rows.map((r) => ({
        month: r.month.value,
        revenue: (0, coerce_1.num)(r.revenue),
        orders: (0, coerce_1.num)(r.orders),
        new_customers: (0, coerce_1.num)(r.new_customers),
        cm3: (0, coerce_1.num)(r.cm3),
    }));
}
/**
 * Targets for a client and year.
 *
 * The demo generates its own rather than reading Postgres — an admin editing a
 * fictional brand's plan would be writing rows nothing reads.
 */
async function getGoals(clientId, year) {
    if ((0, client_1.isDemo)(clientId))
        return (0, goals_1.demoGoals)(year);
    return (0, store_1.listGoals)(clientId, year);
}
