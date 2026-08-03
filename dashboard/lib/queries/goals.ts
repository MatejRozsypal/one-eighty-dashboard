/**
 * Actuals to measure targets against.
 *
 * ── Why this aggregates daily rows rather than reading a monthly mart ───────
 * `mart_monthly_kpis` exists and the Growth page uses it, but it is read there
 * for revenue, new-customer counts and CM3 only — nothing in this codebase
 * reads a total order count from it, so whether it carries one is unverified.
 * `mart_daily_kpis` demonstrably carries all four figures, because the P&L
 * snapshot reads every one of them. Summing days is a little more scan for a
 * guarantee that the number exists and matches the rest of the dashboard.
 *
 * Attainment is therefore computed against the same daily spine the snapshot
 * uses, which is what stops the Goals page and the headline disagreeing.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { num } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { demoGoalActuals, demoGoals } from "@/lib/demo/goals";
import { listGoals, type Goal, type GoalMetric } from "@/lib/goals/store";

/** One month's actuals, keyed by the same metric names goals are stored under. */
export interface MonthActuals {
  /** First day of the month, ISO. */
  month: string;
  revenue: number | null;
  orders: number | null;
  new_customers: number | null;
  cm3: number | null;
}

export function actualFor(
  row: MonthActuals | undefined,
  metric: GoalMetric
): number | null {
  if (!row) return null;
  return row[metric];
}

interface Row {
  month: { value: string };
  revenue: unknown;
  orders: unknown;
  new_customers: unknown;
  cm3: unknown;
}

export async function getGoalActuals(
  clientId: string,
  nativeCurrency: string,
  year: number
): Promise<MonthActuals[]> {
  if (isDemo(clientId)) return demoGoalActuals(year);

  const rows = await query<Row>(
    `SELECT
       DATE_TRUNC(date, MONTH)         AS month,
       SUM(revenue)                    AS revenue,
       SUM(orders)                     AS orders,
       SUM(new_customer_orders)        AS new_customers,
       SUM(cm3)                        AS cm3
     FROM \`${PROJECT_ID}.mart.mart_daily_kpis\`
     WHERE client_id = @clientId
       AND currency  = @currency
       AND date >= DATE(@year, 1, 1)
       AND date <  DATE(@nextYear, 1, 1)
     GROUP BY month
     ORDER BY month`,
    {
      clientId,
      currency: nativeCurrency,
      year,
      nextYear: year + 1,
    }
  );

  return rows.map((r) => ({
    month: r.month.value,
    revenue: num(r.revenue),
    orders: num(r.orders),
    new_customers: num(r.new_customers),
    cm3: num(r.cm3),
  }));
}

/**
 * Targets for a client and year.
 *
 * The demo generates its own rather than reading Postgres — an admin editing a
 * fictional brand's plan would be writing rows nothing reads.
 */
export async function getGoals(clientId: string, year: number): Promise<Goal[]> {
  if (isDemo(clientId)) return demoGoals(year);
  return listGoals(clientId, year);
}
