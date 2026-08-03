"use strict";
/**
 * Time between orders.
 *
 * Reads `mart.mart_order_gaps` (migration 208). If that view hasn't been
 * deployed yet, every function here returns null and the screen renders its
 * "not computed for this client yet" state rather than erroring — the view is a
 * warehouse change that ships separately from the frontend.
 *
 * ── The median leads, not the mean ──────────────────────────────────────────
 * The distribution is heavily right-skewed: a long tail of customers returning
 * after a year drags the mean well above the typical gap. On Dobias the mean is
 * 85 days against a median of 59. That 26-day difference is the difference
 * between a reorder reminder at week 8 and one at week 12 — the first lands with
 * the median customer, the second arrives after most of them have already
 * decided. So the UI leads with the median and shows the mean as context.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGapStats = getGapStats;
const bigquery_1 = require("@/lib/bigquery");
const errors_1 = require("@/lib/queries/errors");
const coerce_1 = require("@/lib/coerce");
const client_1 = require("@/lib/demo/client");
const customers_1 = require("@/lib/demo/customers");
const BUCKETS = [
    { label: "0–7", min: 0, max: 7 },
    { label: "8–14", min: 8, max: 14 },
    { label: "15–30", min: 15, max: 30 },
    { label: "31–60", min: 31, max: 60 },
    { label: "61–90", min: 61, max: 90 },
    { label: "91–180", min: 91, max: 180 },
    { label: "181–365", min: 181, max: 365 },
    { label: "365+", min: 366, max: 100_000 },
];
async function getGapStats(clientId, currency) {
    // Demo client: served from memory, never from the warehouse.
    if ((0, client_1.isDemo)(clientId))
        return (0, customers_1.demoGapStats)();
    try {
        const bucketCases = BUCKETS.map((b, i) => `COUNTIF(gap_days BETWEEN ${b.min} AND ${b.max}) AS b${i}`).join(",\n       ");
        const [row] = await (0, bigquery_1.query)(`SELECT
         COUNT(*) AS total_gaps,
         AVG(gap_days) AS mean_days,
         APPROX_QUANTILES(gap_days, 100)[OFFSET(25)] AS p25,
         APPROX_QUANTILES(gap_days, 100)[OFFSET(50)] AS median,
         APPROX_QUANTILES(gap_days, 100)[OFFSET(75)] AS p75,
         APPROX_QUANTILES(gap_days, 100)[OFFSET(90)] AS p90,
         ${bucketCases}
       FROM \`${bigquery_1.PROJECT_ID}.mart.mart_order_gaps\`
       WHERE client_id = @clientId AND currency = @currency`, { clientId, currency });
        const total = (0, coerce_1.num)(row?.total_gaps) ?? 0;
        if (total === 0)
            return null;
        const counts = BUCKETS.map((_, i) => (0, coerce_1.num)(row?.[`b${i}`]) ?? 0);
        const maxCount = Math.max(...counts);
        return {
            totalGaps: total,
            median: (0, coerce_1.num)(row?.median),
            mean: (0, coerce_1.num)(row?.mean_days),
            p25: (0, coerce_1.num)(row?.p25),
            p75: (0, coerce_1.num)(row?.p75),
            p90: (0, coerce_1.num)(row?.p90),
            buckets: BUCKETS.map((b, i) => ({
                label: b.label,
                count: counts[i],
                isModal: counts[i] === maxCount && maxCount > 0,
                isOrderHygiene: b.label === "0–7",
            })),
            windowLabel: "last 24 months",
        };
    }
    catch (error) {
        // Missing object = a view that ships later. Anything else (permission,
        // timeout) must surface — a false "no data" is worse than an error.
        if (!(0, errors_1.isMissingObject)(error))
            throw error;
        return null;
    }
}
