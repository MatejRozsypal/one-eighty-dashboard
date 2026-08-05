/**
 * When the second order happens, day by day.
 *
 * ── Why this is not the "Time between orders" page ──────────────────────────
 * `/gaps` pools *every* consecutive gap — 1st→2nd, 2nd→3rd, 3rd→4th — into
 * coarse buckets over 24 months. That answers "how often does this base
 * reorder". This answers a different question: for someone who has just bought
 * once, when do they come back? Only the first→second gap, one day per bar.
 * The two legitimately disagree, because a fourth order arrives on a different
 * clock from a second one.
 *
 * ── The cohort is chosen so the window is observed, not censored ────────────
 * A customer who bought last week has not "failed to reorder within 90 days" —
 * they have not had 90 days. Including them drags every share down and makes
 * the distribution look worse the better acquisition has been recently, which
 * is exactly backwards.
 *
 * So the cohort is customers whose first order is between `horizon` and
 * `horizon + 365` days ago: twelve months of cohorts, every one of them fully
 * observed for the whole window.
 *
 * ── The denominator is repeaters, not the cohort ────────────────────────────
 * Bars are the share of *repeat orders* landing on each day, so they sum to
 * 100% across the window. The share of the cohort that repeated at all is
 * reported separately — mixing the two produces a chart whose bars sum to
 * something meaningless.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { num } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { demoRepeatTiming } from "@/lib/demo/repeatTiming";

/** Windows the summary table reports. Contiguous, and they cover the horizon. */
export const TIMING_WINDOWS: Array<{ label: string; from: number; to: number }> = [
  { label: "Same day", from: 0, to: 0 },
  { label: "1–3 days", from: 1, to: 3 },
  { label: "4–7 days", from: 4, to: 7 },
  { label: "8–14 days", from: 8, to: 14 },
  { label: "15–30 days", from: 15, to: 30 },
  { label: "31–45 days", from: 31, to: 45 },
  { label: "46–60 days", from: 46, to: 60 },
  { label: "61–90 days", from: 61, to: 90 },
  { label: "91–180 days", from: 91, to: 180 },
  { label: "181–365 days", from: 181, to: 365 },
];

export interface TimingDay {
  day: number;
  customers: number;
  /** Share of repeats landing on this day, 0..1. */
  share: number;
  /** Share of repeats that had landed by end of this day, 0..1. */
  cumulative: number;
}

export interface TimingWindow {
  label: string;
  from: number;
  to: number;
  customers: number;
  share: number;
  cumulative: number;
}

export interface RepeatTiming {
  horizon: number;
  /** Customers whose first order is old enough to have been fully observed. */
  cohort: number;
  /** …of whom this many placed a second order inside the horizon. */
  repeaters: number;
  /** …and this many did so later than the horizon, so they are off the chart. */
  beyondHorizon: number;
  days: TimingDay[];
  windows: TimingWindow[];
  /** Day by which half of all in-window repeats had landed. */
  medianDay: number | null;
  /** Day by which 80% had landed. */
  p80Day: number | null;
  /**
   * Heaviest seven consecutive days, and what share they hold.
   *
   * A seven-day window rather than the single tallest bar: with a few hundred
   * repeats spread over ninety buckets, the tallest day is usually noise, and
   * crowning it would name a day nobody should plan around.
   */
  peak: { from: number; to: number; share: number } | null;
  /** Same-day repeats, which are often a split order rather than a return. */
  sameDay: number;
}

const PEAK_WINDOW = 7;

/** Shared by the warehouse and demo paths so the two cannot compute differently. */
export function buildTiming(
  counts: Map<number, number>,
  horizon: number,
  cohort: number,
  beyondHorizon: number
): RepeatTiming {
  const repeaters = [...counts.values()].reduce((a, b) => a + b, 0);

  const days: TimingDay[] = [];
  let running = 0;
  for (let d = 0; d <= horizon; d++) {
    const customers = counts.get(d) ?? 0;
    running += customers;
    days.push({
      day: d,
      customers,
      share: repeaters > 0 ? customers / repeaters : 0,
      cumulative: repeaters > 0 ? running / repeaters : 0,
    });
  }

  const dayAt = (target: number): number | null =>
    days.find((x) => x.cumulative >= target)?.day ?? null;

  let peak: RepeatTiming["peak"] = null;
  if (repeaters > 0 && days.length >= PEAK_WINDOW) {
    let best = { from: 0, share: -1 };
    for (let i = 0; i + PEAK_WINDOW <= days.length; i++) {
      const share = days
        .slice(i, i + PEAK_WINDOW)
        .reduce((a, x) => a + x.share, 0);
      if (share > best.share) best = { from: days[i].day, share };
    }
    peak = { from: best.from, to: best.from + PEAK_WINDOW - 1, share: best.share };
  }

  const windows: TimingWindow[] = TIMING_WINDOWS.filter((w) => w.from <= horizon).map(
    (w) => {
      const to = Math.min(w.to, horizon);
      let customers = 0;
      for (let d = w.from; d <= to; d++) customers += counts.get(d) ?? 0;
      return {
        label: w.label,
        from: w.from,
        to,
        customers,
        share: repeaters > 0 ? customers / repeaters : 0,
        cumulative: days[to]?.cumulative ?? 0,
      };
    }
  );

  return {
    horizon,
    cohort,
    repeaters,
    beyondHorizon,
    days,
    windows,
    medianDay: dayAt(0.5),
    p80Day: dayAt(0.8),
    peak,
    sameDay: counts.get(0) ?? 0,
  };
}

interface Row {
  gap_days: unknown;
  customers: unknown;
}

export async function getRepeatTiming(
  clientId: string,
  horizon = 90
): Promise<RepeatTiming | null> {
  if (isDemo(clientId)) return demoRepeatTiming(horizon);

  const totals = await query<{
    cohort: unknown;
    within: unknown;
    beyond: unknown;
  }>(
    `WITH pairs AS (
       SELECT customer_key,
              MIN(IF(step = 1, order_date, NULL)) AS first_date,
              MIN(IF(step = 2, order_date, NULL)) AS second_date
       FROM \`${PROJECT_ID}.mart.mart_customer_product_steps\`
       WHERE client_id = @clientId AND step <= 2
       GROUP BY customer_key
     )
     SELECT
       COUNT(*)                                                          AS cohort,
       COUNTIF(DATE_DIFF(second_date, first_date, DAY) BETWEEN 0 AND @horizon) AS within,
       COUNTIF(DATE_DIFF(second_date, first_date, DAY) > @horizon)        AS beyond
     FROM pairs
     WHERE first_date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL @lookback DAY)
                          AND DATE_SUB(CURRENT_DATE(), INTERVAL @horizon DAY)`,
    { clientId, horizon, lookback: horizon + 365 }
  );

  const cohort = Number(num(totals[0]?.cohort) ?? 0);
  if (cohort === 0) return null;

  const rows = await query<Row>(
    `WITH pairs AS (
       SELECT customer_key,
              MIN(IF(step = 1, order_date, NULL)) AS first_date,
              MIN(IF(step = 2, order_date, NULL)) AS second_date
       FROM \`${PROJECT_ID}.mart.mart_customer_product_steps\`
       WHERE client_id = @clientId AND step <= 2
       GROUP BY customer_key
     )
     SELECT DATE_DIFF(second_date, first_date, DAY) AS gap_days, COUNT(*) AS customers
     FROM pairs
     WHERE first_date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL @lookback DAY)
                          AND DATE_SUB(CURRENT_DATE(), INTERVAL @horizon DAY)
       AND DATE_DIFF(second_date, first_date, DAY) BETWEEN 0 AND @horizon
     GROUP BY gap_days`,
    { clientId, horizon, lookback: horizon + 365 }
  );

  const counts = new Map<number, number>();
  for (const r of rows) {
    counts.set(Number(num(r.gap_days) ?? 0), Number(num(r.customers) ?? 0));
  }

  return buildTiming(
    counts,
    horizon,
    cohort,
    Number(num(totals[0]?.beyond) ?? 0)
  );
}
