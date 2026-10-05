/**
 * Customer lifetime economics, LTV, LTGP, orders per customer.
 *
 * Reads `mart.mart_customer_lifetime`, which aggregates every order in the
 * 60-month window down to one row per customer. The window starts at the later
 * of 60 months ago and the client's data start. It is a real limit, not a
 * rounding detail: a customer whose first-ever order predates it looks like a
 * new customer here, which understates both repeat rate and LTV. The UI states
 * this rather than hiding it.
 *
 * Two repeat rates sit side by side on purpose. The to-date rate (customers
 * with 2 or more orders) is lowered by recent customers who have not had time
 * to return. The 365-day rate comes from `mart.rpt_customer_entry` and counts
 * only customers with a full 365 days of history, so it is comparable across
 * clients and over time.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { num, safeDiv, isoDate } from "@/lib/coerce";
import { NO_VALUE } from "@/lib/format";
import { isMissingObject } from "@/lib/queries/errors";
import { isDemo } from "@/lib/demo/client";
import {
  demoLifetimeSummary,
  demoPayback,
  demoRepeat365,
  demoTopCustomers,
} from "@/lib/demo/customers";

export interface LifetimeSummary {
  currency: string;
  customers: number | null;
  ltv: number | null;
  ltgp: number | null;
  /** Share of lifetime revenue that survives as gross profit. */
  ltgpRatio: number | null;
  ordersPerCustomer: number | null;
  avgAov: number | null;
  /** Share of customers with ≥2 orders, whatever their age. */
  repeatRate: number | null;
  /** Pooled 365-day repeat rate, non-early customers. Null when unavailable. */
  repeat365: Repeat365 | null;
  /** First day the lifetime figures cover (ISO date), for the tooltip. */
  windowStart: string | null;
  /** Mean days between first and last order, repeat customers only. */
  avgDaysActive: number | null;
}

export interface Repeat365 {
  /** Customers with a second order inside 365 days of the first. */
  repeaters: number;
  /** Customers with at least 365 days of history, excluding early customers. */
  matured: number;
  /** repeaters / matured, null below the minimum sample. */
  rate: number | null;
  /** First day the lifetime figures cover (ISO date). */
  windowStart: string | null;
}

/** Below this many matured customers a rate is shown as n/a. */
export const REPEAT_MIN_N = 30;

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

/**
 * Pooled 365-day repeat rate: sum of r365 over sum of m365, early customers
 * (first order inside the history guard after data start) excluded. Pooled,
 * never an average of cohort rates. One definition for Customers and Cohorts.
 *
 * Null when the table is not there yet or the client has no rows.
 */
export async function getRepeat365(clientId: string): Promise<Repeat365 | null> {
  if (isDemo(clientId)) return demoRepeat365();

  try {
    const [row] = await query<Record<string, unknown>>(
      `SELECT
         SUM(IF(NOT is_early, r365, 0))  AS repeaters,
         SUM(IF(NOT is_early, m365, 0))  AS matured,
         GREATEST(MIN(data_start_date),
                  DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)) AS window_start
       FROM \`${PROJECT_ID}.mart.rpt_customer_entry\`
       WHERE client_id = @clientId`,
      { clientId }
    );
    const matured = num(row?.matured);
    if (matured === null) return null;
    const repeaters = num(row?.repeaters) ?? 0;
    return {
      repeaters,
      matured,
      rate: matured >= REPEAT_MIN_N ? safeDiv(repeaters, matured) : null,
      windowStart: isoDate(row?.window_start as never),
    };
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return null;
  }
}

/** Null when the client has no customer rows, so the page never shows a 0. */
export async function getLifetimeSummary(
  clientId: string,
  currency: string
): Promise<LifetimeSummary | null> {
  // Demo client: served from memory, never from the warehouse.
  if (isDemo(clientId)) return demoLifetimeSummary();

  // The inner SELECT is not cosmetic. `mart_customer_lifetime` is a view whose
  // columns are themselves aggregates, `aov` is SAFE_DIVIDE(SUM(...), COUNT(*))
  // and `is_returning` is COUNT(*) > 1. Aggregating those directly makes
  // BigQuery inline the view and reject the query with "Aggregations of
  // aggregations are not allowed". Selecting the columns in a subquery first
  // creates the block boundary that keeps the two levels apart.
  //
  // AOV is order-weighted: total revenue over total orders. The mart's own
  // per-customer `aov` column would weight a one-order customer the same as a
  // five-order one, so it is not used here.
  const [[row], repeat365] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT
         COUNT(*)                                     AS customers,
         AVG(lifetime_revenue)                        AS ltv,
         AVG(lifetime_gross_profit)                   AS ltgp,
         AVG(total_orders)                            AS orders_per_customer,
         SAFE_DIVIDE(SUM(lifetime_revenue), SUM(total_orders)) AS avg_aov,
         SAFE_DIVIDE(COUNTIF(is_returning), COUNT(*)) AS repeat_rate,
         AVG(IF(is_returning, days_active, NULL))     AS avg_days_active
       FROM (
         SELECT lifetime_revenue, lifetime_gross_profit, total_orders,
                is_returning, days_active
         FROM \`${PROJECT_ID}.mart.mart_customer_lifetime\`
         WHERE client_id = @clientId AND currency = @currency
       )`,
      { clientId, currency }
    ),
    getRepeat365(clientId),
  ]);

  // COUNT(*) is 0, not NULL, over an empty set.
  const customers = num(row?.customers);
  if (!customers) return null;

  const ltv = num(row?.ltv);
  const ltgp = num(row?.ltgp);

  return {
    currency,
    customers,
    ltv,
    ltgp,
    ltgpRatio: safeDiv(ltgp, ltv),
    ordersPerCustomer: num(row?.orders_per_customer),
    avgAov: num(row?.avg_aov),
    repeatRate: num(row?.repeat_rate),
    repeat365,
    windowStart: repeat365?.windowStart ?? null,
    avgDaysActive: num(row?.avg_days_active),
  };
}

/**
 * Top customers by lifetime revenue.
 *
 * Emails are masked in SQL, not in TypeScript. The design mocks them as
 * `p••••a@seznam.cz`, and doing the masking server-side means a full address
 * never reaches the browser at all, this is customer PII on an internal tool
 * that will eventually be shown to clients.
 */
export async function getTopCustomers(
  clientId: string,
  currency: string,
  limit = 25
): Promise<CustomerRow[]> {
  // Demo client: served from memory, never from the warehouse.
  if (isDemo(clientId)) return demoTopCustomers(limit);

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
    email: String(r.email ?? NO_VALUE),
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

/**
 * Payback windows, gross profit per new customer at 30 and 90 days.
 *
 * Answers the question CAC and lifetime LTGP together cannot: *how long* until
 * an acquired customer has paid for themselves. Lifetime value says a customer
 * is profitable; this says whether the cash comes back inside a quarter.
 *
 * ── Both numbers cover the same customers, on purpose ───────────────────────
 * A 30-day average over everyone 30 days old and a 90-day average over everyone
 * 90 days old are computed on different populations, and the 90-day figure can
 * land *below* the 30-day one, impossible for a cumulative measure, and purely
 * an artefact of which cohorts each includes. Manami showed exactly that
 * (2,882 vs 2,775). Both figures here are restricted to customers whose 90-day
 * window has fully elapsed, so the pair is a real curve.
 *
 * Only complete windows count at all: a customer ten days old contributes
 * nothing to a 30-day average, otherwise payback looks worse the faster you
 * acquire.
 */
export interface Payback {
  customers: number | null;
  ltgp30: number | null;
  ltgp90: number | null;
  /** Blended CAC over the same span, paid spend ÷ new customers. */
  cac: number | null;
  /** Share of CAC recovered in 30 days. */
  recovery30: number | null;
  /** 90-day gross profit per CAC currency unit. */
  ltgpToCac: number | null;
}

export async function getPayback(
  clientId: string,
  currency: string,
  monthsBack = 12
): Promise<Payback | null> {
  // Demo client: served from memory, never from the warehouse.
  if (isDemo(clientId)) return demoPayback(monthsBack);

  try {
    const [rows, spend] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT SUM(customers_90d_complete) AS customers,
                SUM(gross_profit_30d_of_90d_cohort) AS gp30,
                SUM(gross_profit_90d) AS gp90
         FROM \`${PROJECT_ID}.mart.mart_customer_payback\`
         WHERE client_id = @clientId AND currency = @currency
           AND cohort_date >= DATE_SUB(CURRENT_DATE(), INTERVAL @monthsBack MONTH)`,
        { clientId, currency, monthsBack }
      ),
      query<Record<string, unknown>>(
        `SELECT SUM(paid_spend) AS spend, SUM(new_customer_orders) AS new_orders
         FROM \`${PROJECT_ID}.mart.mart_daily_kpis\`
         WHERE client_id = @clientId
           AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL @monthsBack MONTH)`,
        { clientId, monthsBack }
      ),
    ]);

    const customers = num(rows[0]?.customers);
    if (!customers) return null;

    const ltgp30 = safeDiv(num(rows[0]?.gp30), customers);
    const ltgp90 = safeDiv(num(rows[0]?.gp90), customers);
    // New-customer *orders* stands in for new customers: a first order is by
    // definition one customer, so over a long window the two converge.
    const cac = safeDiv(num(spend[0]?.spend), num(spend[0]?.new_orders));

    return {
      customers,
      ltgp30,
      ltgp90,
      cac,
      recovery30: cac ? safeDiv(ltgp30, cac) : null,
      ltgpToCac: cac ? safeDiv(ltgp90, cac) : null,
    };
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return null;
  }
}
