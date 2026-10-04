import type { GrowthMonth } from "@/lib/queries/growth";

function monthIndex(monthStart: string): number {
  const [y, m] = monthStart.split("-").map(Number);
  return y * 12 + (m - 1);
}

/**
 * Average monthly growth and cumulative growth over ONE set of months.
 *
 * Both are measured from the oldest to the newest closed month with revenue in
 * the table: cumulative is the total change, the average is the compound
 * monthly rate that produces it. They can therefore never disagree in sign, as
 * they did when the average took every MoM (including the oldest month's, which
 * compares against a month outside the table) and "cumulative" took the span.
 * The partial month is left out of both.
 */
export function growthStats(months: GrowthMonth[]): {
  avgMonthlyGrowth: number | null;
  cumulativeGrowth: number | null;
} {
  const closed = months
    .filter((m) => !m.isPartial && m.revenue !== null && m.revenue > 0)
    .sort((a, b) => a.monthStart.localeCompare(b.monthStart));
  if (closed.length < 2) return { avgMonthlyGrowth: null, cumulativeGrowth: null };

  const first = closed[0];
  const last = closed[closed.length - 1];
  const steps = monthIndex(last.monthStart) - monthIndex(first.monthStart);
  const ratio = (last.revenue as number) / (first.revenue as number);
  return {
    cumulativeGrowth: ratio - 1,
    avgMonthlyGrowth: steps > 0 ? Math.pow(ratio, 1 / steps) - 1 : null,
  };
}
