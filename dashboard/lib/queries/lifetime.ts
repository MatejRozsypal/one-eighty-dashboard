/**
 * Customer lifetime economics — LTV, LTGP, orders per customer.
 *
 * Reads `mart.mart_customer_lifetime`, which aggregates every order in the
 * 36-month window down to one row per customer. That window is a real limit,
 * not a rounding detail: a customer whose first-ever order predates it looks
 * like a new customer here, which understates both repeat rate and LTV. The UI
 * states this rather than hiding it.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { num, safeDiv, isoDate } from "@/lib/coerce";

export interface LifetimeSummary {
  currency: string;
  customers: number | null;
  ltv: number | null;
  ltgp: number | null;
  /** Share of lifetime revenue that survives as gross profit. */
  ltgpRatio: number | null;
  ordersPerCustomer: number | null;
  avgAov: number | null;
  /** Share of customers with ≥2 orders. */
  repeatRate: number | null;
  /** Mean days between first and last order, repeat customers only. */
  avgDaysActive: number | null;
}

export interface CustomerRow {
  email: string;
  firstOrder: string | null;
  lastOrder: string | null;
  orders: number | null;
  lifetimeRevenue: number | null;
  lifetimeGrossProfit: number | null;
  aov: number | null;
  daysActive: number | null;
  isReturning: boolean;
}

export async function getLifetimeSummary(
  clientId: string,
  currency: string
): Promise<LifetimeSummary> {
  // The inner SELECT is not cosmetic. `mart_customer_lifetime` is a view whose
  // columns are themselves aggregates — `aov` is SAFE_DIVIDE(SUM(...), COUNT(*))
  // and `is_returning` is COUNT(*) > 1. Aggregating those directly makes
  // BigQuery inline the view and reject the query with "Aggregations of
  // aggregations are not allowed". Selecting the columns in a subquery first
  // creates the block boundary that keeps the two levels apart.
  const [row] = await query<Record<string, unknown>>(
    `SELECT
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
       FROM \`${PROJECT_ID}.mart.mart_customer_lifetime\`
       WHERE client_id = @clientId AND currency = @currency
     )`,
    { clientId, currency }
  );

  const ltv = num(row?.ltv);
  const ltgp = num(row?.ltgp);

  return {
    currency,
    customers: num(row?.customers),
    ltv,
    ltgp,
    ltgpRatio: safeDiv(ltgp, ltv),
    ordersPerCustomer: num(row?.orders_per_customer),
    avgAov: num(row?.avg_aov),
    repeatRate: num(row?.repeat_rate),
    avgDaysActive: num(row?.avg_days_active),
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
export async function getTopCustomers(
  clientId: string,
  currency: string,
  limit = 25
): Promise<CustomerRow[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT
       CONCAT(
         SUBSTR(SPLIT(customer_email, '@')[OFFSET(0)], 1, 1),
         '••••',
         SUBSTR(SPLIT(customer_email, '@')[OFFSET(0)], -1),
         '@',
         SPLIT(customer_email, '@')[SAFE_OFFSET(1)]
       )                          AS email,
       first_order_date, last_order_date, total_orders,
       lifetime_revenue, lifetime_gross_profit, aov, days_active, is_returning
     FROM \`${PROJECT_ID}.mart.mart_customer_lifetime\`
     WHERE client_id = @clientId AND currency = @currency
       AND STRPOS(customer_email, '@') > 1
     ORDER BY lifetime_revenue DESC
     LIMIT @limit`,
    { clientId, currency, limit }
  );

  return rows.map((r) => ({
    email: String(r.email ?? "—"),
    firstOrder: isoDate(r.first_order_date as never),
    lastOrder: isoDate(r.last_order_date as never),
    orders: num(r.total_orders),
    lifetimeRevenue: num(r.lifetime_revenue),
    lifetimeGrossProfit: num(r.lifetime_gross_profit),
    aov: num(r.aov),
    daysActive: num(r.days_active),
    isReturning: r.is_returning === true,
  }));
}
