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

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isMissingObject } from "@/lib/queries/errors";
import { num, isoDate, safeDiv } from "@/lib/coerce";
import type { DateRange } from "@/lib/period";

export type ShopPlatform = "shopify" | "shoptet";

/** Which dimension the market split is actually cut by. */
export type MarketDimension = "country" | "currency";

export interface MarketRow {
  /** ISO country code, or a currency code when `dimension` is "currency". */
  key: string;
  orders: number;
  revenue: number | null;
  aov: number | null;
  returningShare: number | null;
}

export interface OrderRow {
  date: string | null;
  orderNumber: string;
  customerEmail: string;
  /** Country for Shopify, transacting currency for Shoptet. */
  market: string;
  revenue: number | null;
  netSales: number | null;
  margin: number | null;
  discounts: number | null;
  financialStatus: string;
  isReturning: boolean;
}

export interface OrdersSummary {
  platform: ShopPlatform;
  dimension: MarketDimension;
  orders: number | null;
  revenue: number | null;
  netSales: number | null;
  /** Gross profit. Null when no order in the range carries a cost. */
  margin: number | null;
  marginRate: number | null;
  /** Canonical AOV — net sales ÷ orders, matching Shopify. */
  aovNet: number | null;
  /** The other AOV, with shipping in the numerator. */
  aovInclShipping: number | null;
  returningShare: number | null;
  markets: MarketRow[];
  /** True when the platform reports shipping separately from merchandise. */
  hasShippingSplit: boolean;
  /** True when the platform exposes per-order discounts. */
  hasDiscounts: boolean;
}

export async function getOrdersSummary(
  clientId: string,
  range: DateRange
): Promise<OrdersSummary | null> {
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT
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
       FROM \`${PROJECT_ID}.mart.mart_orders\`
       WHERE client_id = @clientId AND date BETWEEN @from AND @to
       GROUP BY market_key
       ORDER BY revenue DESC`,
      { clientId, from: range.from, to: range.to }
    );

    if (rows.length === 0) return null;

    const platform = (String(rows[0].platform ?? "shopify") ||
      "shopify") as ShopPlatform;

    const markets: MarketRow[] = rows.map((r) => {
      const orders = num(r.orders) ?? 0;
      const revenue = num(r.revenue);
      return {
        key: String(r.market_key ?? ""),
        orders,
        revenue,
        aov: safeDiv(revenue, orders),
        returningShare: safeDiv(num(r.returning_orders), orders),
      };
    });

    const sum = (field: string) =>
      rows.reduce((s, r) => s + (num(r[field]) ?? 0), 0);

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
      marginRate: margin === 0 ? null : safeDiv(margin, netSales),
      aovNet: safeDiv(netSales, orders),
      aovInclShipping: safeDiv(revenue, orders),
      returningShare: safeDiv(sum("returning_orders"), orders),
      markets,
      hasShippingSplit: sum("with_shipping") > 0,
      hasDiscounts: sum("with_discounts") > 0,
    };
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return null;
  }
}

/**
 * Recent orders. Emails are masked in SQL — a full address never reaches the
 * browser, same as on the Customers screen.
 */
export async function getRecentOrders(
  clientId: string,
  range: DateRange,
  limit = 50
): Promise<OrderRow[]> {
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT
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
       FROM \`${PROJECT_ID}.mart.mart_orders\`
       WHERE client_id = @clientId AND date BETWEEN @from AND @to
       ORDER BY date DESC, revenue DESC
       LIMIT @limit`,
      { clientId, from: range.from, to: range.to, limit }
    );

    return rows.map((r) => ({
      date: isoDate(r.date as never),
      orderNumber: String(r.order_number ?? "—"),
      customerEmail: String(r.email ?? "—"),
      market: String(r.market ?? ""),
      revenue: num(r.revenue),
      netSales: num(r.net_sales),
      margin: num(r.order_margin),
      discounts: num(r.total_discounts),
      financialStatus: String(r.financial_status ?? "—"),
      isReturning: r.is_returning_customer === true,
    }));
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return [];
  }
}
