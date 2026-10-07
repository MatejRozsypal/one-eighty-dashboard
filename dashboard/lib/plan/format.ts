/**
 * Formatting for plan figures. Pure, safe in client components, and built on
 * `lib/format` only, so "n/a", the minus sign and en-US grouping match the
 * rest of the app.
 *
 * Counts on a curve target are fractional (15.6 orders to date), so counts
 * under 100 keep one decimal; whole counts print without one.
 */

import { MINUS, NO_VALUE, formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import { isRatioMetric, type RowMetric, type RowStatus } from "./types";

export const METRIC_LABEL: Record<RowMetric, string> = {
  orders: "Orders",
  revenue: "Revenue",
  new_customers: "New customers",
  ad_spend: "Ad spend",
  cm3: "CM3",
  amer: "aMER",
  units: "Units",
};

export function isMoney(metric: RowMetric): boolean {
  return metric === "revenue" || metric === "ad_spend" || metric === "cm3";
}

export function fmtCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  const whole = Math.abs(value - Math.round(value)) < 0.05;
  return formatNumber(value, { decimals: whole || Math.abs(value) >= 100 ? 0 : 1 });
}

export function fmtValue(
  value: number | null | undefined,
  metric: RowMetric,
  currency: string,
  { compact = false }: { compact?: boolean } = {}
): string {
  if (isMoney(metric)) return formatMoney(value, currency, { compact });
  if (isRatioMetric(metric)) return formatRatio(value);
  return compact ? formatNumber(value, { compact: true, decimals: 1 }) : fmtCount(value);
}

/** Signed difference: "+4.2", "−CZK 7,725". Zero prints unsigned. */
export function fmtGap(value: number | null | undefined, metric: RowMetric, currency: string): string {
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

export const STATUS_LABEL: Record<RowStatus, string> = {
  ahead: "Ahead",
  on_track: "On track",
  behind: "Behind",
  off_track: "Off track",
  not_started: "Not started",
  closed: "Closed",
  no_target: "No target",
  not_measured: "n/a",
};
