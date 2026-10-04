/**
 * Paid section arithmetic. Pure: no BigQuery, no React, safe in any bundle.
 *
 * ── The one rule ────────────────────────────────────────────────────────────
 * Every rate is SUM(numerator) / SUM(denominator) over the selected rows.
 * Never the average of per-row ratios, and never a `_per_day` column: that is
 * AVG(daily ratio), which METRICS.md measures as 10 to 30 percent wrong. The
 * helpers here take rows and pickers, so a ratio cannot be built from anything
 * but summed components.
 *
 * Missing values: `null` means "not measured", and stays null all the way to
 * the formatter ("n/a"). A sum of nothing is null, not zero; a ratio over a
 * zero or null denominator is null, not Infinity.
 */

import { addDays, daysInRange, type DateRange } from "@/lib/period";
import type { BrandClass, Grain } from "@/lib/paid/types";

type Num = number | null | undefined;

// ── Ratios and sums ─────────────────────────────────────────────────────────

/** numerator / denominator, null when either is missing or the denominator is 0. */
export function ratio(numerator: Num, denominator: Num): number | null {
  if (numerator === null || numerator === undefined) return null;
  if (denominator === null || denominator === undefined || denominator === 0) return null;
  const r = numerator / denominator;
  return Number.isFinite(r) ? r : null;
}

/** Sum of the non-null values, or null when no row has a value. */
export function sumOf<T>(rows: readonly T[], pick: (row: T) => Num): number | null {
  let total: number | null = null;
  for (const row of rows) {
    const v = pick(row);
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    total = (total ?? 0) + v;
  }
  return total;
}

/**
 * SUM(numerator) / SUM(denominator) over rows. With `where`, both sums are
 * restricted to the rows that pass (hook rate counts only video ads).
 */
export function ratioOfSums<T>(
  rows: readonly T[],
  numerator: (row: T) => Num,
  denominator: (row: T) => Num,
  where?: (row: T) => boolean
): number | null {
  const used = where ? rows.filter(where) : rows;
  return ratio(sumOf(used, numerator), sumOf(used, denominator));
}

/**
 * A funnel share (step over the previous step, or over the top). Pixel events
 * are not sequential, so a later step can exceed an earlier one; a share above
 * 100 percent is not a rate of anything and is null ("n/a"), never drawn.
 */
export function funnelShare(value: Num, base: Num): number | null {
  const r = ratio(value, base);
  return r === null || r > 1 ? null : r;
}

/** A cost per thousand: spend / impressions x 1000. */
export function perThousand(numerator: Num, denominator: Num): number | null {
  const r = ratio(numerator, denominator);
  return r === null ? null : r * 1000;
}

/** Relative change as a fraction ((current - previous) / previous). Null when previous is 0 or missing. */
export function relativeChange(current: Num, previous: Num): number | null {
  if (current === null || current === undefined) return null;
  if (previous === null || previous === undefined || previous === 0) return null;
  const r = (current - previous) / Math.abs(previous);
  return Number.isFinite(r) ? r : null;
}

/** Absolute change in a rate, in fraction points (0.012 is 1.2 pp). Null when either side is missing. */
export function pointChange(current: Num, previous: Num): number | null {
  if (current === null || current === undefined) return null;
  if (previous === null || previous === undefined) return null;
  return current - previous;
}

// ── Low volume ──────────────────────────────────────────────────────────────

/** A row under this share of the table's spend is low volume. */
export const LOW_VOLUME_SPEND_SHARE = 0.01;
/** A row under this many purchases (conversions) is low volume. */
export const LOW_VOLUME_MIN_PURCHASES = 3;

/**
 * A row is low volume when its spend is under 1 percent of the table total, or
 * its purchases (conversions) are under 3. A missing figure never makes a row
 * low volume on that test: its ROAS and CPA are already "n/a".
 *
 * Effect in a table: ROAS and CPA render muted with a "Low volume" marker and
 * their sort key is null (`unlessLowVolume`), so they sort last both ways.
 */
export function isLowVolume(row: { spend: Num; purchases: Num }, totalSpend: Num): boolean {
  const spendShare = ratio(row.spend, totalSpend);
  if (spendShare !== null && spendShare < LOW_VOLUME_SPEND_SHARE) return true;
  if (row.purchases !== null && row.purchases !== undefined && row.purchases < LOW_VOLUME_MIN_PURCHASES) {
    return true;
  }
  return false;
}

/** The sort key for a ratio column: null (sorts last) for a low volume row, else the value. */
export function unlessLowVolume(value: number | null, lowVolume: boolean): number | null {
  return lowVolume ? null : value;
}

// ── Impression share ────────────────────────────────────────────────────────
//
// The Google mart stores eligible impressions (impressions / reported share)
// and the lost and top components as impression counts, so any set of rows
// re-aggregates correctly. Shares of 0 mean "not reported" and arrive as null,
// so those rows drop out of numerator and denominator together.

interface IsRow {
  isImpressions?: Num;
  eligibleImpressions?: Num;
  lostBudgetImpressions?: Num;
  lostRankImpressions?: Num;
  topImpressions?: Num;
  topEligibleImpressions?: Num;
  absTopImpressions?: Num;
}

/** Search impression share: SUM(is_impressions) / SUM(eligible_impressions). */
export function searchImpressionShare(rows: readonly IsRow[]): number | null {
  return ratioOfSums(rows, (r) => r.isImpressions, (r) => r.eligibleImpressions);
}

/** Share lost to budget: SUM(lost_budget_impressions) / SUM(eligible_impressions). */
export function lostBudgetShare(rows: readonly IsRow[]): number | null {
  return ratioOfSums(rows, (r) => r.lostBudgetImpressions, (r) => r.eligibleImpressions);
}

/** Share lost to ad rank: SUM(lost_rank_impressions) / SUM(eligible_impressions). */
export function lostRankShare(rows: readonly IsRow[]): number | null {
  return ratioOfSums(rows, (r) => r.lostRankImpressions, (r) => r.eligibleImpressions);
}

/** Top impression share: SUM(top_impressions) / SUM(top_eligible_impressions). Shopping rows are null in both. */
export function topImpressionShare(rows: readonly IsRow[]): number | null {
  return ratioOfSums(rows, (r) => r.topImpressions, (r) => r.topEligibleImpressions);
}

/** Absolute top impression share: SUM(abs_top_impressions) / SUM(eligible_impressions). */
export function absTopImpressionShare(rows: readonly IsRow[]): number | null {
  return ratioOfSums(rows, (r) => r.absTopImpressions, (r) => r.eligibleImpressions);
}

// ── Google brand metrics ────────────────────────────────────────────────────

/** Brand share of spend: spend in brand campaigns / total spend. */
export function brandShare(
  rows: readonly { spend: Num; brandClass: BrandClass | null }[]
): number | null {
  const total = sumOf(rows, (r) => r.spend);
  if (total === null) return null;
  const brand = sumOf(rows.filter((r) => r.brandClass === "brand"), (r) => r.spend);
  return ratio(brand ?? 0, total);
}

/** Non-brand ROAS: value / spend over non-brand and Shopping/PMax campaigns. */
export function nonBrandRoas(
  rows: readonly { spend: Num; value: Num; brandClass: BrandClass | null }[]
): number | null {
  const nb = rows.filter((r) => r.brandClass === "non_brand" || r.brandClass === "shopping_pmax");
  return ratioOfSums(nb, (r) => r.value, (r) => r.spend);
}

/**
 * Brand leakage: spend on brand search terms inside non-brand campaigns, over
 * all search-term spend in non-brand campaigns.
 */
export function brandLeakage(
  rows: readonly { spend: Num; isBrand: boolean; campaignBrandClass: BrandClass | null }[]
): number | null {
  const nb = rows.filter((r) => r.campaignBrandClass === "non_brand");
  const total = sumOf(nb, (r) => r.spend);
  if (total === null) return null;
  const leaked = sumOf(nb.filter((r) => r.isBrand), (r) => r.spend);
  return ratio(leaked ?? 0, total);
}

// ── GA4 cross-check ─────────────────────────────────────────────────────────

/** Platform-reported value over GA4 revenue (x). Above 1 means the platform claims more than GA4 sees. */
export function overClaim(platformValue: Num, ga4Revenue: Num): number | null {
  return ratio(platformValue, ga4Revenue);
}

/** GA4 all-channel revenue over shop revenue. */
export function trackingCoverage(ga4Revenue: Num, shopRevenue: Num): number | null {
  return ratio(ga4Revenue, shopRevenue);
}

// ── Time buckets ────────────────────────────────────────────────────────────

/** Longest range, in days, that still draws daily points. */
export const DAY_GRAIN_MAX_DAYS = 45;
/** Longest range, in days, that still draws weekly points. */
export const WEEK_GRAIN_MAX_DAYS = 180;

/**
 * The grain for a series over a range: day up to 45 days, ISO week (Monday
 * start) up to 180, month beyond. Ratios are recomputed per bucket from summed
 * components, never averaged across buckets.
 */
export function bucketGrain(range: DateRange): Grain {
  const days = daysInRange(range);
  if (days <= DAY_GRAIN_MAX_DAYS) return "day";
  if (days <= WEEK_GRAIN_MAX_DAYS) return "week";
  return "month";
}

/** The first day of the bucket a date falls in: itself, its ISO Monday, or the 1st of its month. */
export function bucketStart(date: string, grain: Grain): string {
  if (grain === "day") return date;
  if (grain === "month") return `${date.slice(0, 7)}-01`;
  // 0 = Sunday ... 6 = Saturday, in UTC, so a Monday is 1 and a Sunday steps back 6.
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}
