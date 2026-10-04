/**
 * Actuals to measure targets against.
 *
 * ── Same days, same arithmetic as the Snapshot ──────────────────────────────
 * Actuals are built from the Snapshot's own daily rows (`fetchPnlDays`), with
 * the same stated per-order costs applied, then summed per calendar month. A
 * month here and the Snapshot's figure for the same month are therefore the
 * same number, CM3 included. Reading the raw CM3 column instead would skip the
 * per-order rates the Snapshot deducts and the two pages would disagree.
 *
 * Missing is not zero: a month where no day carries a value stays null, so a
 * client with no cost data shows n/a for CM3, never 0.
 */

import { num } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { demoGoalActuals, demoGoals } from "@/lib/demo/goals";
import { listGoals, type Goal, type GoalMetric } from "@/lib/goals/store";
import { fetchPnlDays, type CostRates, type PnlDay } from "@/lib/queries/pnl";

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

/** Sum a column, null only when every day is null. */
function sumOrNull(rows: PnlDay[], pick: (r: PnlDay) => number | null): number | null {
  let total = 0;
  let seen = false;
  for (const r of rows) {
    const v = num(pick(r));
    if (v !== null) {
      total += v;
      seen = true;
    }
  }
  return seen ? total : null;
}

export async function getGoalActuals(
  clientId: string,
  nativeCurrency: string,
  year: number,
  costs: CostRates = { fulfilmentPerOrder: null, otherCm1PerOrder: null }
): Promise<MonthActuals[]> {
  if (isDemo(clientId)) return demoGoalActuals(year);

  const days = await fetchPnlDays(
    clientId,
    { from: `${year}-01-01`, to: `${year}-12-31` },
    "native",
    nativeCurrency,
    costs
  );

  const byMonth = new Map<string, PnlDay[]>();
  for (const d of days) {
    const month = `${d.date.slice(0, 7)}-01`;
    const bucket = byMonth.get(month);
    if (bucket) bucket.push(d);
    else byMonth.set(month, [d]);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, rows]) => {
      // Coverage rule, same as the Snapshot: a month with revenue on a day that
      // has no COGS has no CM3 (never a partial sum).
      const uncosted = rows.some((r) => (r.revenue ?? 0) > 0 && r.cogs === null);
      return {
      month,
      revenue: sumOrNull(rows, (r) => r.revenue),
      orders: sumOrNull(rows, (r) => r.orders),
      new_customers: sumOrNull(rows, (r) => r.newCustomerOrders),
      cm3: uncosted ? null : sumOrNull(rows, (r) => r.cm3),
    };
    });
}

/**
 * Targets for a client and year.
 *
 * The demo generates its own rather than reading Postgres, an admin editing a
 * fictional brand's plan would be writing rows nothing reads.
 */
export async function getGoals(clientId: string, year: number): Promise<Goal[]> {
  if (isDemo(clientId)) return demoGoals(year);
  return listGoals(clientId, year);
}
