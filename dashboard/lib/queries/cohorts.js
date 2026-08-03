"use strict";
/**
 * Cohorts — customers grouped by the month they first bought.
 *
 * ── The maturity trap ───────────────────────────────────────────────────────
 * Read a cohort table's repeat-rate column top to bottom and it looks like
 * retention has collapsed: on Dobias it runs from 4% for this month's cohort to
 * 41% for one a year old. It hasn't collapsed. July's cohort has had three
 * weeks to make a second purchase; last June's has had thirteen months.
 *
 * Every cohort table in every analytics tool has this artifact and almost none
 * explain it. So this module returns `ageMonths` and `isMature` alongside the
 * numbers, and the UI uses them to make the effect structural rather than
 * something you have to already know to look for.
 *
 * The Y1 columns are the honest fix — every customer measured over the same
 * 365-day window — but they only exist once a cohort is fully mature, which is
 * why most rows have them empty. That emptiness is rigor, not a gap.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCohorts = getCohorts;
const bigquery_1 = require("@/lib/bigquery");
const coerce_1 = require("@/lib/coerce");
const client_1 = require("@/lib/demo/client");
const customers_1 = require("@/lib/demo/customers");
async function getCohorts(clientId, currency, monthsBack = 24) {
    // Demo client: served from memory, never from the warehouse.
    if ((0, client_1.isDemo)(clientId))
        return (0, customers_1.demoCohorts)(monthsBack);
    const rows = await (0, bigquery_1.query)(`SELECT
       cohort_month, customer_count, y1_complete_customers,
       ltv, ltgp, y1_ltv, y1_ltgp,
       avg_orders_per_customer, cohort_repeat_rate_pct
     FROM \`${bigquery_1.PROJECT_ID}.mart.mart_customer_cohorts\`
     WHERE client_id = @clientId AND currency = @currency
       AND cohort_month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL @monthsBack MONTH), MONTH)
     ORDER BY cohort_month DESC`, { clientId, currency, monthsBack });
    const now = new Date();
    return rows.map((r) => {
        const cohortMonth = (0, coerce_1.isoDate)(r.cohort_month) ?? "";
        const [y, m] = cohortMonth.split("-").map(Number);
        const ageMonths = (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - m);
        return {
            cohortMonth,
            customerCount: (0, coerce_1.num)(r.customer_count),
            y1CompleteCustomers: (0, coerce_1.num)(r.y1_complete_customers),
            ltv: (0, coerce_1.num)(r.ltv),
            ltgp: (0, coerce_1.num)(r.ltgp),
            y1Ltv: (0, coerce_1.num)(r.y1_ltv),
            y1Ltgp: (0, coerce_1.num)(r.y1_ltgp),
            ordersPerCustomer: (0, coerce_1.num)(r.avg_orders_per_customer),
            // Stored as 0–100 in the warehouse; the UI works in fractions throughout.
            repeatRate: (0, coerce_1.num)(r.cohort_repeat_rate_pct) === null
                ? null
                : (0, coerce_1.num)(r.cohort_repeat_rate_pct) / 100,
            ageMonths,
            isMature: ageMonths >= 12,
        };
    });
}
