/**
 * Demo growth and year-over-year, as *rows* rather than finished summaries.
 *
 * Both callers already do their real work in TypeScript: `getGrowth` decides
 * what counts as a partial month and which months feed the average, and
 * `getYearOverYear` builds the seasonal projection — including the rule that it
 * may only use the most recent complete year, which exists because averaging
 * prior years once invented ~24% of growth for a flat business.
 *
 * Handing those functions rows instead of answers means the demo is subject to
 * exactly that reasoning. If the projection rule changes, the demo changes with
 * it, and there is no second copy to forget about.
 *
 * Monthly figures are roll-ups of the same daily spine as the P&L, so a year
 * here is the sum of the months on the Growth page, which is the sum of the
 * days behind the snapshot.
 */

import { dataThrough, days, firstDay, type DemoDay } from "./business";

const r2 = (n: number): number => Math.round(n * 100) / 100;

interface DemoMonth {
  monthStart: string;
  year: number;
  month: number;
  revenue: number;
  orders: number;
  newCustomerOrders: number;
  newCustomerRevenue: number;
  cm3: number;
}

/** Every month the demo holds, oldest first. */
export function demoMonths(): DemoMonth[] {
  const byMonth = new Map<string, DemoDay[]>();
  for (const d of days(firstDay(), dataThrough())) {
    const key = d.date.slice(0, 7);
    const list = byMonth.get(key) ?? [];
    list.push(d);
    byMonth.set(key, list);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => {
      const [year, month] = key.split("-").map(Number);
      return {
        monthStart: `${key}-01`,
        year,
        month,
        revenue: r2(list.reduce((a, d) => a + d.revenue, 0)),
        orders: list.reduce((a, d) => a + d.orders, 0),
        newCustomerOrders: list.reduce((a, d) => a + d.newCustomerOrders, 0),
        newCustomerRevenue: r2(list.reduce((a, d) => a + d.newCustomerRevenue, 0)),
        cm3: r2(list.reduce((a, d) => a + d.cm3, 0)),
      };
    });
}

function pct(current: number, previous: number | undefined): number | null {
  if (previous === undefined || previous === 0) return null;
  return (current - previous) / previous;
}

/**
 * Rows shaped like `mart_monthly_kpis`, newest first — the order `getGrowth`
 * expects, since it reads the oldest closed month off the end of the array.
 *
 * Month-over-month is precomputed here because the mart precomputes it too;
 * the query reads it as a column rather than deriving it.
 */
export function demoGrowthRows(monthsBack: number): Array<Record<string, unknown>> {
  const all = demoMonths();
  // One extra month so the oldest kept month still has a predecessor to
  // compare against, exactly as a SQL window would give it.
  const kept = monthsBack > 0 ? all.slice(-(monthsBack + 1)) : all;

  const rows = kept.map((m, i) => {
    const prev = i > 0 ? kept[i - 1] : undefined;
    return {
      month_start: { value: m.monthStart },
      revenue: m.revenue,
      mom_revenue_pct: pct(m.revenue, prev?.revenue),
      new_customer_orders: m.newCustomerOrders,
      mom_new_customer_orders_pct: pct(m.newCustomerOrders, prev?.newCustomerOrders),
      new_customer_revenue: m.newCustomerRevenue,
      mom_new_customer_revenue_pct: pct(m.newCustomerRevenue, prev?.newCustomerRevenue),
      cm3: m.cm3,
    };
  });

  // Drop the helper month, then reverse: the query returns newest first.
  return (monthsBack > 0 && all.length > monthsBack ? rows.slice(1) : rows).reverse();
}

/** Rows shaped like the year-over-year query: one per month, oldest first. */
export function demoYoyRows(): Array<Record<string, unknown>> {
  return demoMonths().map((m) => ({
    yr: m.year,
    mo: m.month,
    revenue: m.revenue,
    cm3: m.cm3,
  }));
}
