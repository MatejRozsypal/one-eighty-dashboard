"use strict";
/**
 * Unit economics — first-time vs returning, at order-line grain.
 *
 * ── Two rows are not measurable, and say so rather than showing a number ────
 * **Return rate.** The warehouse holds no refund data at all — there is no
 * refund or return column anywhere in `stg_shopify_orders`, which is the known
 * gap in METRICS.md ("refetch orders with totalRefundedSet"). The row is kept
 * and marked unmeasured, because dropping it would hide that the leakage
 * picture is incomplete.
 *
 * **Discounts on Shoptet.** Shoptet exposes a per-item discount *percentage*,
 * not an amount, and reconstructing the amount from it means dividing by
 * (100 − pct) — which blows up on a 100% line and quietly invents money
 * elsewhere. Left null, exactly as `mart_orders` already treats it.
 *
 * ── Contribution margin allocates all paid spend to new customers ───────────
 * Paid spend cannot be attributed to an individual order, so it cannot be split
 * between the two segments from the data. The convention here — chosen
 * deliberately, not derived — is that acquisition cost belongs entirely to the
 * customers it acquired, so returning customers carry none and their CM equals
 * gross profit. It is the standard treatment and it flatters returning
 * customers by construction; the page says so where the number is shown.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUnitEconomics = getUnitEconomics;
const bigquery_1 = require("@/lib/bigquery");
const errors_1 = require("@/lib/queries/errors");
const coerce_1 = require("@/lib/coerce");
const client_1 = require("@/lib/demo/client");
const commerce_1 = require("@/lib/demo/commerce");
const EMPTY = {
    orders: null, units: null, aur: null, upt: null, grossRetailPerOrder: null,
    trueAov: null, discountRate: null, cogsPct: null, grossProfitPct: null,
    contributionMarginPct: null, paidSpend: null,
};
async function getUnitEconomics(clientId, currency, range) {
    // Demo client: served from memory, never from the warehouse.
    if ((0, client_1.isDemo)(clientId))
        return (0, commerce_1.demoUnitEconomics)(range);
    try {
        const [rows, spendRows] = await Promise.all([
            (0, bigquery_1.query)(`SELECT segment,
                SUM(orders) AS orders, SUM(units) AS units,
                SUM(gross_retail) AS gross_retail, SUM(discounts) AS discounts,
                SUM(net_sales) AS net_sales, SUM(cogs) AS cogs,
                SUM(gross_profit) AS gross_profit
         FROM \`${bigquery_1.PROJECT_ID}.mart.mart_unit_economics\`
         WHERE client_id = @clientId AND currency = @currency
           AND date BETWEEN @from AND @to
         GROUP BY segment`, { clientId, currency, from: range.from, to: range.to }),
            // Paid spend is not in the line-grain view and cannot be, so it comes
            // from the daily KPIs and is applied whole to the new-customer segment.
            (0, bigquery_1.query)(`SELECT SUM(paid_spend) AS paid_spend
         FROM \`${bigquery_1.PROJECT_ID}.mart.mart_daily_kpis\`
         WHERE client_id = @clientId AND date BETWEEN @from AND @to`, { clientId, from: range.from, to: range.to }),
        ]);
        if (rows.length === 0)
            return null;
        const paidSpend = (0, coerce_1.num)(spendRows[0]?.paid_spend);
        let hasDiscounts = false;
        const build = (segment) => {
            const r = rows.find((x) => String(x.segment) === segment);
            if (!r)
                return EMPTY;
            const orders = (0, coerce_1.num)(r.orders);
            const units = (0, coerce_1.num)(r.units);
            const grossRetail = (0, coerce_1.num)(r.gross_retail);
            const discounts = (0, coerce_1.num)(r.discounts);
            const netSales = (0, coerce_1.num)(r.net_sales);
            const cogs = (0, coerce_1.num)(r.cogs);
            const grossProfit = (0, coerce_1.num)(r.gross_profit);
            if (discounts !== null)
                hasDiscounts = true;
            // All acquisition cost sits on the new segment — see the header note.
            const spend = segment === "new" ? paidSpend : 0;
            const cm = grossProfit === null ? null : grossProfit - (spend ?? 0);
            return {
                orders,
                units,
                aur: (0, coerce_1.safeDiv)(grossRetail, units),
                upt: (0, coerce_1.safeDiv)(units, orders),
                grossRetailPerOrder: (0, coerce_1.safeDiv)(grossRetail, orders),
                trueAov: (0, coerce_1.safeDiv)(netSales, orders),
                discountRate: discounts === null ? null : (0, coerce_1.safeDiv)(discounts, grossRetail),
                cogsPct: (0, coerce_1.safeDiv)(cogs, netSales),
                grossProfitPct: (0, coerce_1.safeDiv)(grossProfit, netSales),
                contributionMarginPct: (0, coerce_1.safeDiv)(cm, netSales),
                paidSpend: segment === "new" ? paidSpend : 0,
            };
        };
        const first = build("new");
        const returning = build("returning");
        return { first, returning, hasDiscounts };
    }
    catch (error) {
        if (!(0, errors_1.isMissingObject)(error))
            throw error;
        return null;
    }
}
