"use strict";
/**
 * Small per-page context queries — freshness stamps and order-level extras.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDataThrough = getDataThrough;
exports.getDiscounts = getDiscounts;
exports.getExcludedCurrencies = getExcludedCurrencies;
const bigquery_1 = require("@/lib/bigquery");
const errors_1 = require("@/lib/queries/errors");
const coerce_1 = require("@/lib/coerce");
const client_1 = require("@/lib/demo/client");
const commerce_1 = require("@/lib/demo/commerce");
/**
 * How current the data is, per source family.
 *
 * Two stamps rather than one because the expectations genuinely differ: shops
 * land same-day, ad platforms are a day behind by design (Google Ads cannot be
 * queried for today at all). A single "last updated" would make every ad
 * platform look permanently broken.
 */
async function getDataThrough(clientId) {
    // Demo client: served from memory, never from the warehouse.
    if ((0, client_1.isDemo)(clientId))
        return (0, commerce_1.demoDataThroughContext)();
    const [row] = await (0, bigquery_1.query)(`SELECT
       MAX(IF(revenue IS NOT NULL, date, NULL)) AS shop_last,
       MAX(IF(meta_spend IS NOT NULL OR google_spend IS NOT NULL, date, NULL)) AS ads_last
     FROM \`${bigquery_1.PROJECT_ID}.mart.mart_daily_kpis\`
     WHERE client_id = @clientId
       AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)`, { clientId });
    return {
        shop: (0, coerce_1.isoDate)((row?.shop_last ?? null)),
        ads: (0, coerce_1.isoDate)((row?.ads_last ?? null)),
    };
}
/**
 * Discounts given in the period.
 *
 * Only `mart_orders` carries this, and that view is Shopify-only — so a Shoptet
 * client returns null and the UI renders "not exposed by this shop platform"
 * rather than a misleading zero.
 */
async function getDiscounts(clientId, range) {
    // Demo client: served from memory, never from the warehouse.
    if ((0, client_1.isDemo)(clientId))
        return (0, commerce_1.demoDiscounts)(range);
    try {
        const [row] = await (0, bigquery_1.query)(`SELECT SUM(total_discounts) AS discounts
       FROM \`${bigquery_1.PROJECT_ID}.mart.mart_orders\`
       WHERE client_id = @clientId AND date BETWEEN @from AND @to`, { clientId, from: range.from, to: range.to });
        return (0, coerce_1.num)(row?.discounts);
    }
    catch (error) {
        if (!(0, errors_1.isMissingObject)(error))
            throw error;
        return null;
    }
}
/**
 * Orders settled in a currency other than the client's main one.
 *
 * Dobias takes a handful of CAD orders alongside USD. Summing them without a
 * rate is meaningless, so `mart_daily_kpis`'s currency-grained rows keep them
 * separate and the snapshot filters to the native currency — this query reports
 * what that filtering left out, so the exclusion is stated rather than silent.
 */
async function getExcludedCurrencies(clientId, nativeCurrency, range) {
    // Demo client: served from memory, never from the warehouse.
    if ((0, client_1.isDemo)(clientId))
        return (0, commerce_1.demoExcludedCurrencies)();
    // Summed here rather than in SQL: mart_daily_kpis' `orders` and `revenue` are
    // themselves aggregates, and BigQuery rejects SUM over them with
    // "Aggregations of aggregations are not allowed" once it inlines the view.
    // The row count is one per currency per day, so this is trivial.
    const rows = await (0, bigquery_1.query)(`SELECT currency, orders, revenue
     FROM \`${bigquery_1.PROJECT_ID}.mart.mart_daily_kpis\`
     WHERE client_id = @clientId
       AND date BETWEEN @from AND @to
       AND currency != @nativeCurrency`, { clientId, nativeCurrency, from: range.from, to: range.to });
    const byCurrency = new Map();
    for (const r of rows) {
        const currency = String(r.currency);
        const acc = byCurrency.get(currency) ?? { orders: 0, revenue: 0 };
        acc.orders += (0, coerce_1.num)(r.orders) ?? 0;
        acc.revenue += (0, coerce_1.num)(r.revenue) ?? 0;
        byCurrency.set(currency, acc);
    }
    return [...byCurrency.entries()]
        .map(([currency, v]) => ({ currency, ...v }))
        .filter((c) => c.orders > 0)
        .sort((a, b) => b.revenue - a.revenue);
}
