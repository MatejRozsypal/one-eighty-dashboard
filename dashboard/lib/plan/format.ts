/**
 * Formatting for plan figures. Pure, safe in client components, and built on
 * `lib/format` only, so "n/a", the minus sign and en-US grouping match the
 * rest of the app.
 *
 * Counts on a curve target are fractional (15.6 orders to date), so counts
 * under 100 keep one decimal; whole counts print without one.
 */

import { MINUS, NO_VALUE, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import type { PacingStatus, PlanMetric } from "./types";

export const METRIC_LABEL: Record<PlanMetric, string> = {
  orders: "Orders",
  revenue: "Revenue",
  new_customers: "New customers",
  ad_spend: "Ad spend",
};

export function isMoney(metric: PlanMetric): boolean {
  return metric === "revenue" || metric === "ad_spend";
}

export function fmtCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  const whole = Math.abs(value - Math.round(value)) < 0.05;
  return formatNumber(value, { decimals: whole || Math.abs(value) >= 100 ? 0 : 1 });
}

export function fmtValue(
  value: number | null | undefined,
  metric: PlanMetric,
  currency: string,
  { compact = false }: { compact?: boolean } = {}
): string {
  if (isMoney(metric)) return formatMoney(value, currency, { compact });
  return compact ? formatNumber(value, { compact: true, decimals: 1 }) : fmtCount(value);
}

/** Signed difference: "+4.2", "−CZK 7,725". Zero prints unsigned. */
export function fmtGap(value: number | null | undefined, metric: PlanMetric, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  const text = fmtValue(Math.abs(value), metric, currency);
  if (text === fmtValue(0, metric, currency)) return text;
  return value < 0 ? `${MINUS}${text}` : `+${text}`;
}

/** Pace arrives as a percentage (64.1), renders "64.1%". */
export function fmtPace(pct: number | null | undefined): string {
  return formatPercent(pct === null || pct === undefined ? null : pct / 100);
}

/** MER arrives as a percentage of revenue (27.6), renders "27.6%". */
export function fmtMer(pct: number | null | undefined): string {
  return formatPercent(pct === null || pct === undefined ? null : pct / 100);
}

export const STATUS_LABEL: Record<PacingStatus, string> = {
  ahead: "Ahead",
  on_track: "On track",
  behind: "Behind",
  off_track: "Off track",
  not_started: "Not started",
  closed: "Closed",
};
