"use strict";
/**
 * Orders — order-level detail and the market split.
 *
 * `mart_orders` carries **both** platforms since migration 209: Shopify for
 * Dobias, Shoptet for Manami, reconciled to `mart_daily_kpis` to the cent for
 * both. Before that this view read Shopify only and every Shoptet client got an
 * empty state.
 *
 * ── The two platforms are not symmetrical, and the page must not pretend ────
 * Shoptet's order payload carries **no address at all** (verified against
 * `raw_shoptet_orders.payload_json`), so `shipping_country` is structurally
 * NULL there — not missing data that might arrive later. Splitting Manami by
 * "country" would mean inventing one.
 *
 * What Shoptet does have is the currency the customer transacted in, and for
 * Manami that is a real market boundary: CZK is the Czech market, EUR is
 * SK/EU. So the split dimension follows the platform — country where we know
 * it, transacting currency where we don't — and the UI labels which one it is
 * rather than calling both "market" and hoping nobody asks.
 *
 * Shoptet also reports per-order margin directly, which Shopify does not; on
 * the Shopify side it comes from the order-items cost join in the view.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrdersSummary = getOrdersSummary;
exports.getRecentOrders = getRecentOrders;
const bigquery_1 = require("@/lib/bigquery");
const errors_1 = require("@/lib/queries/errors");
const coerce_1 = require("@/lib/coerce");
const client_1 = require("@/lib/demo/client");
const commerce_1 = require("@/lib/demo/commerce");
async function getOrdersSummary(clientId, range) {
    // Demo client: served from memory, never from the warehouse.
    if ((0, client_1.isDemo)(clientId))
        return (0, commerce_1.demoOrdersSummary)(range);
    try {
        const rows = await (0, bigquery_1.query)(`SELECT
         ANY_VALUE(platform)                                AS platform,
         COALESCE(shipping_country, market_currency, '')    AS market_key,
         COUNT(*)                                           AS orders,
         SUM(revenue)                                       AS revenue,
         SUM(net_sales)                                     AS net_sales,
         SUM(shipping_revenue)                              AS shipping_revenue,
         SUM(order_margin)                                  AS margin,
         COUNTIF(shipping_revenue IS NOT NULL)              AS with_shipping,
         COUNTIF(total_discounts IS NOT NULL)               AS with_discounts,
         COUNTIF(is_returning_customer)                     AS returning_orders
       FROM \`${bigquery_1.PROJECT_ID}.mart.mart_orders\`
       WHERE client_id = @clientId AND date BETWEEN @from AND @to
       GROUP BY market_key
       ORDER BY revenue DESC`, { clientId, from: range.from, to: range.to });
        if (rows.length === 0)
            return null;
        const platform = (String(rows[0].platform ?? "shopify") ||
            "shopify");
        const markets = rows.map((r) => {
            const orders = (0, coerce_1.num)(r.orders) ?? 0;
            const revenue = (0, coerce_1.num)(r.revenue);
            return {
                key: String(r.market_key ?? ""),
                orders,
                revenue,
                aov: (0, coerce_1.safeDiv)(revenue, orders),
                returningShare: (0, coerce_1.safeDiv)((0, coerce_1.num)(r.returning_orders), orders),
            };
        });
        const sum = (field) => rows.reduce((s, r) => s + ((0, coerce_1.num)(r[field]) ?? 0), 0);
        const orders = markets.reduce((s, m) => s + m.orders, 0);
        const revenue = sum("revenue");
        const netSales = sum("net_sales");
        const margin = sum("margin");
        return {
            platform,
            dimension: platform === "shoptet" ? "currency" : "country",
            orders,
            revenue,
            netSales,
            // A margin of exactly zero across every order means no cost data, not a
            // business running at cost.
            margin: margin === 0 ? null : margin,
            marginRate: margin === 0 ? null : (0, coerce_1.safeDiv)(margin, netSales),
            aovNet: (0, coerce_1.safeDiv)(netSales, orders),
            aovInclShipping: (0, coerce_1.safeDiv)(revenue, orders),
            returningShare: (0, coerce_1.safeDiv)(sum("returning_orders"), orders),
            markets,
            hasShippingSplit: sum("with_shipping") > 0,
            hasDiscounts: sum("with_discounts") > 0,
        };
    }
    catch (error) {
        if (!(0, errors_1.isMissingObject)(error))
            throw error;
        return null;
    }
}
/**
 * Recent orders. Emails are masked in SQL — a full address never reaches the
 * browser, same as on the Customers screen.
 */
async function getRecentOrders(clientId, range, limit = 50) {
    // Demo client: served from memory, never from the warehouse.
    if ((0, client_1.isDemo)(clientId))
        return (0, commerce_1.demoRecentOrders)(range, limit);
    try {
        const rows = await (0, bigquery_1.query)(`SELECT
         date, order_number,
         IF(STRPOS(customer_email, '@') > 1,
            CONCAT(
              SUBSTR(SPLIT(customer_email, '@')[OFFSET(0)], 1, 1), '••••',
              SUBSTR(SPLIT(customer_email, '@')[OFFSET(0)], -1), '@',
              SPLIT(customer_email, '@')[SAFE_OFFSET(1)]
            ),
            '—') AS email,
         COALESCE(shipping_country, market_currency, '') AS market,
         revenue, net_sales, order_margin, total_discounts,
         COALESCE(financial_status, '—') AS financial_status,
         is_returning_customer
       FROM \`${bigquery_1.PROJECT_ID}.mart.mart_orders\`
       WHERE client_id = @clientId AND date BETWEEN @from AND @to
       ORDER BY date DESC, revenue DESC
       LIMIT @limit`, { clientId, from: range.from, to: range.to, limit });
        return rows.map((r) => ({
            date: (0, coerce_1.isoDate)(r.date),
            orderNumber: String(r.order_number ?? "—"),
            customerEmail: String(r.email ?? "—"),
            market: String(r.market ?? ""),
            revenue: (0, coerce_1.num)(r.revenue),
            netSales: (0, coerce_1.num)(r.net_sales),
            margin: (0, coerce_1.num)(r.order_margin),
            discounts: (0, coerce_1.num)(r.total_discounts),
            financialStatus: String(r.financial_status ?? "—"),
            isReturning: r.is_returning_customer === true,
        }));
    }
    catch (error) {
        if (!(0, errors_1.isMissingObject)(error))
            throw error;
        return [];
    }
}
