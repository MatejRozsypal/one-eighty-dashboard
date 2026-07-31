/**
 * Orders — order-level detail and the market split.
 *
 * `mart_orders` is Shopify-only (it's built from `stg_shopify_orders`), so a
 * Shoptet client returns nothing here. That's handled as an explicit empty
 * state rather than an error: the page exists, this client's data doesn't.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isMissingObject } from "@/lib/queries/errors";
import { num, isoDate, safeDiv } from "@/lib/coerce";
import type { DateRange } from "@/lib/period";

export interface MarketRow {
  /** ISO country code. Empty string means the order carried no country. */
  country: string;
  orders: number;
  revenue: number | null;
  aov: number | null;
  returningShare: number | null;
}

export interface OrderRow {
  date: string | null;
  orderNumber: string;
  customerEmail: string;
  country: string;
  revenue: number | null;
  netSales: number | null;
  shippingRevenue: number | null;
  discounts: number | null;
  financialStatus: string;
  isReturning: boolean;
}

export interface OrdersSummary {
  orders: number | null;
  revenue: number | null;
  netSales: number | null;
  /** Canonical AOV — net sales ÷ orders, matching Shopify. */
  aovNet: number | null;
  /** The other AOV, with shipping in the numerator. */
  aovInclShipping: number | null;
  returningShare: number | null;
  markets: MarketRow[];
}

export async function getOrdersSummary(
  clientId: string,
  range: DateRange
): Promise<OrdersSummary | null> {
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT
         COALESCE(shipping_country, '') AS country,
         COUNT(*)                       AS orders,
         SUM(revenue)                   AS revenue,
         SUM(net_sales)                 AS net_sales,
         SUM(shipping_revenue)          AS shipping_revenue,
         COUNTIF(is_returning_customer) AS returning_orders
       FROM \`${PROJECT_ID}.mart.mart_orders\`
       WHERE client_id = @clientId AND date BETWEEN @from AND @to
       GROUP BY country
       ORDER BY revenue DESC`,
      { clientId, from: range.from, to: range.to }
    );

    if (rows.length === 0) return null;

    const markets: MarketRow[] = rows.map((r) => {
      const orders = num(r.orders) ?? 0;
      const revenue = num(r.revenue);
      return {
        country: String(r.country ?? ""),
        orders,
        revenue,
        aov: safeDiv(revenue, orders),
        returningShare: safeDiv(num(r.returning_orders), orders),
      };
    });

    const totals = markets.reduce(
      (acc, m) => ({
        orders: acc.orders + m.orders,
        revenue: acc.revenue + (m.revenue ?? 0),
      }),
      { orders: 0, revenue: 0 }
    );

    const netSales = rows.reduce((s, r) => s + (num(r.net_sales) ?? 0), 0);
    const returning = rows.reduce((s, r) => s + (num(r.returning_orders) ?? 0), 0);

    return {
      orders: totals.orders,
      revenue: totals.revenue,
      netSales,
      aovNet: safeDiv(netSales, totals.orders),
      aovInclShipping: safeDiv(totals.revenue, totals.orders),
      returningShare: safeDiv(returning, totals.orders),
      markets,
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
         COALESCE(shipping_country, '') AS country,
         revenue, net_sales, shipping_revenue, total_discounts,
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
      country: String(r.country ?? ""),
      revenue: num(r.revenue),
      netSales: num(r.net_sales),
      shippingRevenue: num(r.shipping_revenue),
      discounts: num(r.total_discounts),
      financialStatus: String(r.financial_status ?? "—"),
      isReturning: r.is_returning_customer === true,
    }));
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return [];
  }
}
