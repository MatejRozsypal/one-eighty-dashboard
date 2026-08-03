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
 * "not set" / "—", per the house rule.
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
  // A five-point band around the line — without it, every period flickers
  // between "ahead" and "behind" on noise nobody would act on.
  if (ratio >= 1.05) return "ahead";
  if (ratio <= 0.95) return "behind";
  return "on";
}

export function attainment(
  target: number | null,
  actual: number | null,
  elapsed: number
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
 * quantity — that is precisely why ratios were excluded from the metric list.
 * A period's target is null only when *no* month in it has one; a partial plan
 * is still a plan, and summing what exists beats refusing to show anything.
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

  // Elapsed across the whole period: months fully past count 1, the current one
  // counts its own fraction, the future counts 0.
  const elapsed =
    months.length === 0
      ? 0
      : months.reduce((a, m) => a + monthElapsed(m, today), 0) / months.length;

  for (const metric of metrics) {
    let target: number | null = null;
    let actual: number | null = null;

    for (const month of months) {
      const g = goals.find((x) => x.month === month && x.metric === metric);
      if (g) target = (target ?? 0) + g.target;

      const a = actuals.find((x) => x.month === month);
      const value = a ? a[metric] : null;
      if (value !== null && value !== undefined) actual = (actual ?? 0) + value;
    }

    byMetric[metric] = attainment(target, actual, elapsed);
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
