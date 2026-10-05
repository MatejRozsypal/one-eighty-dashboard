/**
 * Month-over-month growth.
 *
 * Reads `mart.mart_monthly_kpis`, which already carries LAG()-based MoM columns
 * so the growth arithmetic lives in one place rather than being re-derived here.
 *
 * The current month is always partial. Its MoM is arithmetically correct but
 * commercially meaningless, a month three days old will always look like a
 * collapse next to a closed one, so rows are flagged and the UI marks them.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { num, isoDate } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { demoGrowthRows } from "@/lib/demo/trend";

export interface GrowthMonth {
  monthStart: string;
  revenue: number | null;
  revenueMoM: number | null;
  /**
   * The month before, for the % / 123 toggle: set only when that row is the
   * previous calendar month (a gap has no honest MoM, same as the mart's own
   * MoM columns), null for the first month the warehouse holds.
   */
  previousRevenue: number | null;
  newCustomerOrders: number | null;
  newCustomerOrdersMoM: number | null;
  previousNewCustomerOrders: number | null;
  newCustomerRevenue: number | null;
  newCustomerRevenueMoM: number | null;
  cm3: number | null;
  /** True when the month hasn't closed, its MoM isn't comparable. */
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
  // One month more than the table shows, so the oldest shown month still has
  // its predecessor's figures for the absolute change. The extra row is read
  // for that and then dropped; it never reaches the table or the averages.
  const fetchBack = monthsBack + 1;
  const now = new Date();
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1)
  )
    .toISOString()
    .slice(0, 10);

  // Demo client: rows are synthesised, then run through exactly the same
  // partial-month and averaging rules below as a real client's.
  const rows = isDemo(clientId)
    ? demoGrowthRows(fetchBack)
    : await query<Record<string, unknown>>(
    `SELECT
       month_start, revenue, mom_revenue_pct,
       new_customer_orders, mom_new_customer_orders_pct,
       new_customer_revenue, mom_new_customer_revenue_pct,
       cogs, cm3
     FROM \`${PROJECT_ID}.mart.mart_monthly_kpis\`
     WHERE client_id = @clientId AND currency = @currency
       AND month_start >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL @fetchBack MONTH), MONTH)
     ORDER BY month_start DESC`,
    { clientId, currency, fetchBack }
  );

  const currentMonth = new Date().toISOString().slice(0, 7);

  const monthIndex = (iso: string): number => {
    const [y, m] = iso.split("-").map(Number);
    return y * 12 + (m - 1);
  };

  const allMonths: GrowthMonth[] = rows.map((r, i) => {
    const monthStart = isoDate(r.month_start as never) ?? "";
    // Rows are newest first, so the row after this one is the month before.
    const before = rows[i + 1];
    const beforeStart = before ? (isoDate(before.month_start as never) ?? "") : "";
    const consecutive =
      before !== undefined &&
      monthStart !== "" &&
      beforeStart !== "" &&
      monthIndex(monthStart) - monthIndex(beforeStart) === 1;
    return {
      monthStart,
      revenue: num(r.revenue),
      revenueMoM: num(r.mom_revenue_pct),
      previousRevenue: consecutive ? num(before?.revenue) : null,
      newCustomerOrders: num(r.new_customer_orders),
      newCustomerOrdersMoM: num(r.mom_new_customer_orders_pct),
      previousNewCustomerOrders: consecutive ? num(before?.new_customer_orders) : null,
      newCustomerRevenue: num(r.new_customer_revenue),
      newCustomerRevenueMoM: num(r.mom_new_customer_revenue_pct),
      // Coverage rule: revenue without COGS means no CM3, never a partial sum.
      cm3:
        "cogs" in r && (num(r.revenue) ?? 0) > 0 && num(r.cogs) === null
          ? null
          : num(r.cm3),
      isPartial: monthStart.slice(0, 7) === currentMonth,
    };
  });

  // Drop the helper month: only months in the requested window are shown. The
  // demo rows are cut by count, as before (its helper month is the oldest row).
  const months = isDemo(clientId)
    ? allMonths.slice(0, monthsBack)
    : allMonths.filter((m) => m.monthStart >= windowStart);

  // Growth stats deliberately exclude the partial month, including it would
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
