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

import { query, PROJECT_ID } from "@/lib/bigquery";
import { num, isoDate } from "@/lib/coerce";

export interface CohortRow {
  cohortMonth: string;
  customerCount: number | null;
  /** Customers in this cohort whose first 365 days are fully in the past. */
  y1CompleteCustomers: number | null;
  ltv: number | null;
  ltgp: number | null;
  /** Maturity-corrected LTV. Null until the cohort is old enough. */
  y1Ltv: number | null;
  y1Ltgp: number | null;
  ordersPerCustomer: number | null;
  repeatRate: number | null;
  /** Whole months between the cohort month and today. */
  ageMonths: number;
  /** True once the cohort has had a full 365 days to mature. */
  isMature: boolean;
}

export async function getCohorts(
  clientId: string,
  currency: string,
  monthsBack = 24
): Promise<CohortRow[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT
       cohort_month, customer_count, y1_complete_customers,
       ltv, ltgp, y1_ltv, y1_ltgp,
       avg_orders_per_customer, cohort_repeat_rate_pct
     FROM \`${PROJECT_ID}.mart.mart_customer_cohorts\`
     WHERE client_id = @clientId AND currency = @currency
       AND cohort_month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL @monthsBack MONTH), MONTH)
     ORDER BY cohort_month DESC`,
    { clientId, currency, monthsBack }
  );

  const now = new Date();

  return rows.map((r) => {
    const cohortMonth = isoDate(r.cohort_month as never) ?? "";
    const [y, m] = cohortMonth.split("-").map(Number);
    const ageMonths =
      (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - m);

    return {
      cohortMonth,
      customerCount: num(r.customer_count),
      y1CompleteCustomers: num(r.y1_complete_customers),
      ltv: num(r.ltv),
      ltgp: num(r.ltgp),
      y1Ltv: num(r.y1_ltv),
      y1Ltgp: num(r.y1_ltgp),
      ordersPerCustomer: num(r.avg_orders_per_customer),
      // Stored as 0–100 in the warehouse; the UI works in fractions throughout.
      repeatRate:
        num(r.cohort_repeat_rate_pct) === null
          ? null
          : (num(r.cohort_repeat_rate_pct) as number) / 100,
      ageMonths,
      isMature: ageMonths >= 12,
    };
  });
}
