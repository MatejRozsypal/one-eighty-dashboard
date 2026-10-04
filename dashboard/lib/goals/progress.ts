/**
 * Turning targets and actuals into attainment.
 *
 * ── Pace, and why an in-flight month needs it ───────────────────────────────
 * On the 4th of the month a client is at 12% of target, which reads as a
 * disaster and is usually nothing. Attainment alone cannot distinguish "behind"
 * from "early", so every in-flight period also carries what *should* have
 * landed by now if the month ran evenly, and it is that comparison the page
 * colours on. A closed month is judged on attainment alone, because there is no
 * more time for it to catch up.
 *
 * Even pacing is a simplification and a real one: November is not linear, it is
 * Black Friday. It is still far better than pretending the month is over, and
 * the page says which basis it is using rather than presenting a projection as
 * a fact.
 *
 * ── Missing is not zero ─────────────────────────────────────────────────────
 * A month with no target set is not a month with a target of zero, and a month
 * with no actuals yet is not a month of no sales. Both stay null and render as
 * "not set" / "-", per the house rule.
 */

import type { Goal, GoalMetric } from "@/lib/goals/store";
import type { MonthActuals } from "@/lib/queries/goals";

export interface Attainment {
  target: number | null;
  actual: number | null;
  /** actual ÷ target. Null when there is no target to be measured against. */
  ratio: number | null;
  /** Share of the period elapsed, 0..1. 1 for a closed period. */
  elapsed: number;
  /** What should have landed by now at an even pace. Null without a target. */
  expected: number | null;
  /** Ahead of, level with, or behind the even-pace line. Null without a target. */
  pace: "ahead" | "on" | "behind" | null;
  /** True while the period can still change. */
  isOpen: boolean;
  /**
   * Months with a target, out of the months in the period. Target, actual and
   * elapsed all cover the targeted months only, so a partial plan is never
   * measured against a full year of actuals.
   */
  coverage: { targeted: number; of: number };
}

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * How much of a month has passed, as of `today`.
 *
 * Counts the days that have *completed*, not the calendar date: on the 4th,
 * three days of selling are in the data, not four. Overstating elapsed time
 * makes every in-flight month look behind.
 */
function monthElapsed(month: string, today: string): number {
  const start = month.slice(0, 7);
  const now = today.slice(0, 7);
  if (now > start) return 1;
  if (now < start) return 0;
  return Math.min(1, (Number(today.slice(8, 10)) - 1) / daysInMonth(month));
}

function paceOf(
  actual: number | null,
  expected: number | null
): "ahead" | "on" | "behind" | null {
  if (actual === null || expected === null || expected === 0) return null;
  const ratio = actual / expected;
  // A five-point band around the line, without it, every period flickers
  // between "ahead" and "behind" on noise nobody would act on.
  if (ratio >= 1.05) return "ahead";
  if (ratio <= 0.95) return "behind";
  return "on";
}

export function attainment(
  target: number | null,
  actual: number | null,
  elapsed: number,
  coverage: { targeted: number; of: number } = {
    targeted: target === null ? 0 : 1,
    of: 1,
  }
): Attainment {
  const expected = target === null ? null : target * elapsed;
  return {
    target,
    actual,
    ratio: target === null || target === 0 || actual === null ? null : actual / target,
    elapsed,
    expected,
    pace: elapsed >= 1 ? null : paceOf(actual, expected),
    isOpen: elapsed < 1,
    coverage,
  };
}

export interface PeriodProgress {
  label: string;
  /** Months covered, oldest first. */
  months: string[];
  byMetric: Record<GoalMetric, Attainment>;
}

/**
 * Roll a set of months up into one period.
 *
 * Targets and actuals are summed because every goal metric is an absolute
 * quantity, that is precisely why ratios were excluded from the metric list.
 *
 * ── Only targeted months are measured ───────────────────────────────────────
 * A year with targets for 2 of 12 months is not a year with a small target.
 * Summing every month's actuals against those two targets reads as 331% and
 * means nothing. Per metric, the roll-up therefore sums target AND actual over
 * the months that have a target, measures elapsed time over the same months,
 * and reports `coverage` so the page can say "Target covers 2 of 12 months".
 * When no month has a target the target stays null (not zero) and the actual is
 * the plain total, shown without a bar.
 */
export function rollUp(
  label: string,
  months: string[],
  goals: Goal[],
  actuals: MonthActuals[],
  metrics: GoalMetric[],
  today: string
): PeriodProgress {
  const byMetric = {} as Record<GoalMetric, Attainment>;

  const elapsedOf = (ms: string[]) =>
    ms.length === 0
      ? 0
      : ms.reduce((a, m) => a + monthElapsed(m, today), 0) / ms.length;

  const actualOf = (ms: string[], metric: GoalMetric): number | null => {
    let actual: number | null = null;
    for (const month of ms) {
      const a = actuals.find((x) => x.month === month);
      const value = a ? a[metric] : null;
      if (value !== null && value !== undefined) actual = (actual ?? 0) + value;
    }
    return actual;
  };

  for (const metric of metrics) {
    const targeted = months.filter((month) =>
      goals.some((x) => x.month === month && x.metric === metric)
    );

    if (targeted.length === 0) {
      byMetric[metric] = attainment(null, actualOf(months, metric), elapsedOf(months), {
        targeted: 0,
        of: months.length,
      });
      continue;
    }

    const target = targeted.reduce(
      (sum, month) =>
        sum + goals.find((x) => x.month === month && x.metric === metric)!.target,
      0
    );

    byMetric[metric] = attainment(target, actualOf(targeted, metric), elapsedOf(targeted), {
      targeted: targeted.length,
      of: months.length,
    });
  }

  return { label, months, byMetric };
}

/** The twelve months of a year, ISO first-of-month, oldest first. */
export function monthsOfYear(year: number): string[] {
  return Array.from(
    { length: 12 },
    (_, i) => `${year}-${String(i + 1).padStart(2, "0")}-01`
  );
}

export function quarterOf(month: string): number {
  return Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1;
}

export function monthsOfQuarter(year: number, quarter: number): string[] {
  const first = (quarter - 1) * 3 + 1;
  return [0, 1, 2].map(
    (i) => `${year}-${String(first + i).padStart(2, "0")}-01`
  );
}
