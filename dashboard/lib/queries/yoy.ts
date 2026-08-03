/**
 * Year-over-year, and a year-end projection for the year still running.
 *
 * ── Why the current year is compared capped ────────────────────────────────
 * Seven months of 2026 against twelve of 2025 is not a comparison, it is a
 * subtraction of five months. So the current year is matched against the
 * **same months** of every earlier year — Jan–Jul vs Jan–Jul — and the table
 * says how many months that is. The uncapped full-year totals are still shown
 * for the years that are actually complete.
 *
 * ── The projection, and what it is worth ───────────────────────────────────
 * Seasonal-naive: for each prior complete year, work out what share of that
 * year's revenue had landed by month N. Average those shares, then divide this
 * year's N months by it. That is the standard way to annualise a partial year
 * and it encodes the one thing a straight-line ×12/N does not — that Q4 is not
 * a twelfth of the year in retail.
 *
 * Its honesty depends entirely on how many prior years exist, which is why the
 * result carries the shares it was built from and the count. With one prior
 * year it is a restatement of last year's shape, not a forecast, and the UI
 * says so rather than printing a confident number.
 *
 * The spread between the highest and lowest prior-year share is reported as the
 * range. It is not a confidence interval — there is no distribution here — it
 * is the span the past few years would each have implied, which is the honest
 * version of "how much does this depend on which year you copy".
 *
 * ── Only closed months count ───────────────────────────────────────────────
 * The running month is excluded from both sides. A month three days old would
 * deflate this year's total and the seasonal share alike, and the error
 * compounds when you divide one by the other.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { num } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { demoYoyRows } from "@/lib/demo/trend";

export interface YearRow {
  year: number;
  /** Every month held for this year. Null for a year with no rows. */
  revenue: number | null;
  cm3: number | null;
  monthsWithData: number;
  isCurrent: boolean;
  /** A full twelve closed months. */
  isComplete: boolean;
  /** Revenue over the capped window only — months 1..cappedThroughMonth. */
  cappedRevenue: number | null;
  /** Same window a year earlier, so the row can state its own YoY. */
  cappedYoY: number | null;
}

export interface Projection {
  /** Mid estimate — this year's capped revenue ÷ the mean seasonal share. */
  mid: number;
  low: number;
  high: number;
  /** How many prior complete years the shares came from. */
  basisYears: number;
  /** Share of the year that had landed by the cap month, per prior year. */
  shares: Array<{ year: number; share: number }>;
  /**
   * Highest prior-year share ÷ lowest. Near 1 means the years agree and the
   * shape really is seasonal; well above 1 means they disagree, and the method
   * is mostly measuring the business changing size rather than the calendar.
   */
  shareSpread: number;
}

export interface YoYSummary {
  years: YearRow[];
  /** Last fully closed month, 1–12. Every capped figure stops here. */
  cappedThroughMonth: number;
  currentYear: number;
  projection: Projection | null;
  /** Why there is no projection, when there isn't one. */
  projectionBlockedBy: string | null;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}

export async function getYearOverYear(
  clientId: string,
  currency: string
): Promise<YoYSummary> {
  // Month grain, arithmetic in TypeScript. `revenue` on this view is already an
  // aggregate, and re-aggregating a mart's aggregate columns is what BigQuery
  // rejects once it inlines the view — the same trap that broke three pages on
  // first deploy. The row count here is a few dozen.
  // Demo client: rows are synthesised, then run through the same year
  // assembly and seasonal projection as a real client's.
  const rows = isDemo(clientId)
    ? demoYoyRows()
    : await query<Record<string, unknown>>(
    `SELECT
       EXTRACT(YEAR  FROM month_start) AS yr,
       EXTRACT(MONTH FROM month_start) AS mo,
       revenue,
       cm3
     FROM \`${PROJECT_ID}.mart.mart_monthly_kpis\`
     WHERE client_id = @clientId AND currency = @currency
     ORDER BY yr, mo`,
    { clientId, currency }
  );

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  // The running month is never closed. In January there is no closed month in
  // this year at all, so the cap is 0 and nothing capped can be computed.
  const cappedThroughMonth = currentMonth - 1;

  const byYear = new Map<number, Map<number, { revenue: number | null; cm3: number | null }>>();
  for (const r of rows) {
    const yr = Number(r.yr);
    const mo = Number(r.mo);
    if (!byYear.has(yr)) byYear.set(yr, new Map());
    byYear.get(yr)!.set(mo, { revenue: num(r.revenue), cm3: num(r.cm3) });
  }

  const sumRange = (yr: number, fromMonth: number, toMonth: number): number | null => {
    const months = byYear.get(yr);
    if (!months) return null;
    let total = 0;
    let seen = 0;
    for (let m = fromMonth; m <= toMonth; m++) {
      const v = months.get(m)?.revenue;
      if (v !== null && v !== undefined) {
        total += v;
        seen++;
      }
    }
    return seen > 0 ? total : null;
  };

  const sortedYears = [...byYear.keys()].sort((a, b) => b - a);

  const years: YearRow[] = sortedYears.map((yr) => {
    const months = byYear.get(yr)!;
    const monthsWithData = months.size;
    const isCurrent = yr === currentYear;

    // "Complete" means twelve closed months — a past year with a gap is not.
    const isComplete = !isCurrent && monthsWithData === 12;

    const revenue = sumRange(yr, 1, 12);
    const cm3 = [...months.values()].reduce<number | null>(
      (acc, m) => (m.cm3 === null ? acc : (acc ?? 0) + m.cm3),
      null
    );

    const capped =
      cappedThroughMonth >= 1 ? sumRange(yr, 1, cappedThroughMonth) : null;
    const priorCapped =
      cappedThroughMonth >= 1 ? sumRange(yr - 1, 1, cappedThroughMonth) : null;

    return {
      year: yr,
      revenue,
      cm3,
      monthsWithData,
      isCurrent,
      isComplete,
      cappedRevenue: capped,
      cappedYoY:
        capped !== null && priorCapped !== null && priorCapped !== 0
          ? (capped - priorCapped) / priorCapped
          : null,
    };
  });

  return {
    years,
    cappedThroughMonth,
    currentYear,
    ...buildProjection(years, byYear, currentYear, cappedThroughMonth, sumRange),
  };
}

function buildProjection(
  years: YearRow[],
  byYear: Map<number, Map<number, { revenue: number | null }>>,
  currentYear: number,
  cappedThroughMonth: number,
  sumRange: (yr: number, from: number, to: number) => number | null
): { projection: Projection | null; projectionBlockedBy: string | null } {
  if (cappedThroughMonth < 1) {
    return {
      projection: null,
      projectionBlockedBy:
        "No month of this year has closed yet — there is nothing to project from.",
    };
  }

  const thisYear = years.find((y) => y.year === currentYear);
  if (!thisYear?.cappedRevenue) {
    return {
      projection: null,
      projectionBlockedBy: "No revenue recorded for this year yet.",
    };
  }

  // Only years with all twelve months can say what share of a year lands by
  // month N — a year missing months would understate its own total and
  // overstate the share.
  const shares = years
    .filter((y) => y.isComplete)
    .map((y) => {
      const partial = sumRange(y.year, 1, cappedThroughMonth);
      const full = sumRange(y.year, 1, 12);
      return partial !== null && full ? { year: y.year, share: partial / full } : null;
    })
    .filter((s): s is { year: number; share: number } => s !== null && s.share > 0);

  if (shares.length === 0) {
    return {
      projection: null,
      projectionBlockedBy:
        "No complete earlier year to read seasonality from — the warehouse holds " +
        `${byYear.size} year${byYear.size === 1 ? "" : "s"}, none of them a full twelve closed months.`,
    };
  }

  const values = shares.map((s) => s.share);

  // The midpoint uses the MOST RECENT complete year, not the mean of all of
  // them. Averaging assumes every prior year is an equally good model of this
  // one, and on this warehouse that is plainly false: Dobias ran a separate
  // Canadian store until it was merged into the US store in March 2026, and
  // that store's whole history only entered the warehouse with the merge. Older
  // years therefore describe a differently-shaped, differently-sized business.
  //
  // Concretely, averaging 2024's 28% share with 2025's 47% projected ~24%
  // growth for a business whose Jan–Jun was flat year on year. The most recent
  // year is the only one that reflects the current store configuration.
  //
  // Every year's share is still reported, and the full span is the range, so
  // the discarded years are visible rather than silently dropped.
  const mostRecent = shares.reduce((a, b) => (b.year > a.year ? b : a));

  // A bigger share means more of the year is already banked, so dividing by it
  // gives a *smaller* projection — the highest share produces the low estimate.
  return {
    projection: {
      mid: thisYear.cappedRevenue / mostRecent.share,
      low: thisYear.cappedRevenue / Math.max(...values),
      high: thisYear.cappedRevenue / Math.min(...values),
      basisYears: shares.length,
      shares,
      shareSpread: Math.max(...values) / Math.min(...values),
    },
    projectionBlockedBy: null,
  };
}
