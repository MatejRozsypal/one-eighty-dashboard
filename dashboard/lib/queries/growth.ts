/**
 * Month-over-month growth.
 *
 * Reads `mart.mart_monthly_kpis`, which already carries LAG()-based MoM columns
 * so the growth arithmetic lives in one place rather than being re-derived here.
 *
 * The current month is always partial. Its MoM is arithmetically correct but
 * commercially meaningless — a month three days old will always look like a
 * collapse next to a closed one — so rows are flagged and the UI marks them.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { num, isoDate } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { demoGrowthRows } from "@/lib/demo/trend";

export interface GrowthMonth {
  monthStart: string;
  revenue: number | null;
  revenueMoM: number | null;
  newCustomerOrders: number | null;
  newCustomerOrdersMoM: number | null;
  newCustomerRevenue: number | null;
  newCustomerRevenueMoM: number | null;
  cm3: number | null;
  /** True when the month hasn't closed — its MoM isn't comparable. */
  isPartial: boolean;
}

export interface GrowthSummary {
  months: GrowthMonth[];
  /** Mean of the closed months' revenue MoM. */
  avgMonthlyGrowth: number | null;
  /** Total growth from the first to the last closed month. */
  cumulativeGrowth: number | null;
}

export async function getGrowth(
  clientId: string,
  currency: string,
  monthsBack = 12
): Promise<GrowthSummary> {
  // Demo client: rows are synthesised, then run through exactly the same
  // partial-month and averaging rules below as a real client's.
  const rows = isDemo(clientId)
    ? demoGrowthRows(monthsBack)
    : await query<Record<string, unknown>>(
    `SELECT
       month_start, revenue, mom_revenue_pct,
       new_customer_orders, mom_new_customer_orders_pct,
       new_customer_revenue, mom_new_customer_revenue_pct,
       cm3
     FROM \`${PROJECT_ID}.mart.mart_monthly_kpis\`
     WHERE client_id = @clientId AND currency = @currency
       AND month_start >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL @monthsBack MONTH), MONTH)
     ORDER BY month_start DESC`,
    { clientId, currency, monthsBack }
  );

  const currentMonth = new Date().toISOString().slice(0, 7);

  const months: GrowthMonth[] = rows.map((r) => {
    const monthStart = isoDate(r.month_start as never) ?? "";
    return {
      monthStart,
      revenue: num(r.revenue),
      revenueMoM: num(r.mom_revenue_pct),
      newCustomerOrders: num(r.new_customer_orders),
      newCustomerOrdersMoM: num(r.mom_new_customer_orders_pct),
      newCustomerRevenue: num(r.new_customer_revenue),
      newCustomerRevenueMoM: num(r.mom_new_customer_revenue_pct),
      cm3: num(r.cm3),
      isPartial: monthStart.slice(0, 7) === currentMonth,
    };
  });

  // Growth stats deliberately exclude the partial month — including it would
  // drag the average down by an artifact of the calendar.
  const closed = months.filter((m) => !m.isPartial);
  const withMoM = closed.filter((m) => m.revenueMoM !== null);

  const avgMonthlyGrowth =
    withMoM.length > 0
      ? withMoM.reduce((sum, m) => sum + (m.revenueMoM ?? 0), 0) / withMoM.length
      : null;

  // `months` is newest-first, so the last element is the oldest.
  const oldest = closed[closed.length - 1];
  const newest = closed[0];
  const cumulativeGrowth =
    oldest?.revenue && newest?.revenue && oldest.revenue !== 0
      ? (newest.revenue - oldest.revenue) / oldest.revenue
      : null;

  return { months, avgMonthlyGrowth, cumulativeGrowth };
}
