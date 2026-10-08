/**
 * Window arithmetic over a client's daily plan actuals. Pure, safe anywhere.
 *
 * Only sums and ratios of sums: aMER over a window is the window's new
 * customer revenue over its paid spend, never an average of daily ratios. A
 * window counts as complete only when every one of its days has a value, so a
 * missing day can never read as zero.
 */

import type { DayPoint } from "./types";

/** `YYYY-MM-DD` plus `days` (negative to go back), in UTC. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** First day of the month of `iso`. */
export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** The same calendar day a year earlier (29 Feb becomes 28 Feb), as BigQuery's DATE_SUB(.., INTERVAL 1 YEAR). */
export function yearEarlier(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Inclusive number of days from `from` to `to`. */
export function daySpan(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** "2026-10-07" -> "7 Oct". */
export function shortDay(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "2026-10-07" -> "October". */
export function monthWord(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
}

export function inWindow(days: DayPoint[], from: string, to: string): DayPoint[] {
  return days.filter((d) => d.date >= from && d.date <= to);
}

type Field = "revenue" | "cm3" | "ncr" | "paid";

/**
 * Sum of a field over [from, to]. Null unless every day of the window is
 * present with a value: a gap is unknown, not zero.
 */
export function completeSum(days: DayPoint[], field: Field, from: string, to: string): number | null {
  const rows = inWindow(days, from, to);
  if (rows.length !== daySpan(from, to)) return null;
  let sum = 0;
  for (const r of rows) {
    const v = r[field];
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

/** aMER over [from, to]: new customer revenue over paid spend. Null with a gap or no spend. */
export function windowAmer(days: DayPoint[], from: string, to: string): number | null {
  const paid = completeSum(days, "paid", from, to);
  const ncr = completeSum(days, "ncr", from, to);
  if (paid === null || ncr === null || paid <= 0) return null;
  return ncr / paid;
}

/**
 * Month-to-date pace by day: cumulative actual over the plan's cumulative
 * target, as a percentage (the warehouse's pace_pct definition). Ends at the
 * first day the actual or the target is missing.
 */
export function paceSeries(
  days: DayPoint[],
  metric: "revenue" | "cm3",
  from: string,
  to: string
): Array<{ date: string; pace: number }> {
  const out: Array<{ date: string; pace: number }> = [];
  let cum = 0;
  for (const d of inWindow(days, from, to)) {
    const v = d[metric];
    const target = metric === "revenue" ? d.revenueTargetCum : d.cm3TargetCum;
    if (v === null || target === null) break;
    cum += v;
    if (target > 0) out.push({ date: d.date, pace: (cum / target) * 100 });
  }
  return out;
}
