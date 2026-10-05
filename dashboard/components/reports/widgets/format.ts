/**
 * FormatSpec to string, plus the small text helpers every widget shares.
 *
 * Wraps lib/format.ts (which stays the one implementation of money, number,
 * percent and ratio formatting) and adds what a registry FormatSpec needs on
 * top: `compact`, and `smallDecimals` for unit costs under 10 (CPC, CPM).
 * Every function returns NO_VALUE ("n/a") for a missing value, never a dash
 * and never "0".
 *
 * Pure module: safe for server and browser. Design: 11_reporting_suite_design.md
 * 1.13 (formats), 2.10 (gap rendering). Owner: RS7 (widgets).
 */

import { NO_VALUE, formatMoney, formatNumber, formatPercent, formatRatio, type DeltaKind } from "@/lib/format";
import type { FormatSpec, QueryGrain } from "@/lib/reports/registry/types";
import { CELL_STATUS_LABEL, type MetricCell, type WidgetResult } from "@/lib/reports/types";

function missing(value: number | null | undefined): value is null | undefined {
  return value === null || value === undefined || !Number.isFinite(value);
}

/** A metric value in its registry format. `currency` is `WidgetResult.currency`. */
export function formatMetricValue(value: number | null | undefined, spec: FormatSpec, currency: string): string {
  if (missing(value)) return NO_VALUE;
  switch (spec.style) {
    case "money": {
      if (spec.compact) return compactMoney(value, currency);
      const small = spec.smallDecimals !== undefined && Math.abs(value) < 10;
      return formatMoney(value, currency, { decimals: small ? spec.smallDecimals : spec.decimals });
    }
    case "number":
      // Counts below 100k are written out ("4,172", not "4K"): an agency report
      // is read for the exact figure.
      return formatNumber(value, { compact: spec.compact && Math.abs(value) >= COMPACT_FROM, decimals: spec.decimals });
    case "percent":
      return formatPercent(value, { decimals: spec.decimals });
    case "ratio":
      return formatRatio(value, { decimals: spec.decimals });
  }
}

/** Below this, a count or an amount is written out in full. */
const COMPACT_FROM = 100_000;

/** "CZK 13.0M", "CZK 618.8K": one decimal always, so the precision does not jump; whole units below 100k. */
function compactMoney(value: number, currency: string): string {
  if (Math.abs(value) < COMPACT_FROM) return formatMoney(value, currency, { decimals: 0 });
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

/** Axis ticks: always compact, one decimal at most. */
export function formatAxisValue(value: number | null | undefined, spec: FormatSpec, currency: string): string {
  if (missing(value)) return NO_VALUE;
  switch (spec.style) {
    case "money":
      return formatMoney(value, currency, { compact: true });
    case "number":
      return formatNumber(value, { compact: true, decimals: 1 });
    case "percent":
      return formatPercent(value, { decimals: Math.abs(value) < 0.1 ? 1 : 0 });
    case "ratio":
      return formatRatio(value, { decimals: 1 });
  }
}

/** Magnitude of a delta, unsigned: "12.4%" for relative, "2.1 pp" for pp. Direction is shown by the arrow. */
export function formatDeltaMagnitude(delta: number, kind: "relative" | "pp"): string {
  const magnitude = Math.abs(delta);
  return kind === "pp" ? `${(magnitude * 100).toFixed(1)} pp` : formatPercent(magnitude);
}

/** The delta kind of a registry format: percent metrics are rates (pp in both modes). */
export function deltaKindOf(style: FormatSpec["style"]): DeltaKind {
  switch (style) {
    case "money":
      return "money";
    case "number":
      return "count";
    case "ratio":
      return "ratio";
    case "percent":
      return "rate";
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function parts(iso: string): { y: number; m: number; d: number } {
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) };
}

/** "2026-10-01" to "Oct 2026". */
export function monthLabel(iso: string): string {
  const { y, m } = parts(iso);
  return `${MONTHS[m - 1] ?? "?"} ${y}`;
}

/** Axis and tooltip label of a bucket: "Sep 7" for day and week, "Sep 2026" for month. */
export function formatBucket(bucket: string, grain: QueryGrain): string {
  if (grain === "month") return monthLabel(bucket);
  const { m, d } = parts(bucket);
  return `${MONTHS[m - 1] ?? "?"} ${d}`;
}

/** "2026-07" for a period edge. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

// ---------------------------------------------------------------------------
// Status text (design 1.1, 2.10)
// ---------------------------------------------------------------------------

/**
 * The two or three words under (or beside) an `n/a`: "Not connected",
 * "No data", "No cost data", "No FX Oct 2026". Empty for an ok cell.
 */
export function statusLabel(cell: Pick<MetricCell, "status" | "reason" | "fxMonths">): string {
  if (cell.status === "ok") return "";
  if (cell.status === "fx_missing") {
    const first = cell.fxMonths?.[0];
    if (first) return `No FX ${monthLabel(first)}`;
    return cell.reason ?? CELL_STATUS_LABEL.fx_missing;
  }
  return CELL_STATUS_LABEL[cell.status];
}

/** Hover lines for a gap: the cell's own reason when it says more than the label, and every missing FX month. */
export function statusDetail(cell: Pick<MetricCell, "status" | "reason" | "fxMonths">): string[] {
  if (cell.status === "ok") return [];
  const label = statusLabel(cell);
  const lines: string[] = [];
  if (cell.reason && cell.reason !== label) lines.push(cell.reason);
  if (cell.status === "fx_missing" && cell.fxMonths && cell.fxMonths.length > 1) {
    lines.push(`No FX ${cell.fxMonths.map(monthLabel).join(", ")}`);
  }
  return lines;
}

/** Footnote form used by Scatter: "{label}: {reason}". */
export function statusReason(cell: Pick<MetricCell, "status" | "reason" | "fxMonths">): string {
  return cell.reason ?? statusLabel(cell);
}

/** snake_case id to sentence-case words, the fallback when a caveat text is missing. */
export function humanize(id: string): string {
  const words = id.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Only http(s) links are rendered from benchmark rows. */
export function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A rollup over one client is labelled "All clients" by the evaluator
 * (lib/reports/evaluate.ts), which reads wrong for a report on one client
 * (QA N-03): the tooltip said "All clients CZK 1.0M" for a Dobias-only report.
 * When a combined series covers exactly one selected client, its label is that
 * client's name. "Selected" is `coverage.of` on the series' cells (the clients
 * the rollup was asked for, including any left out as gaps); a rollup over
 * several clients keeps "All clients". Returns the same object when nothing
 * changes.
 */
export function nameSingleClientRollups(result: WidgetResult, clients: ReadonlyArray<{ id: string; name: string }>): WidgetResult {
  let changed = false;
  const series = result.series.map((s) => {
    if (s.kind !== "combined") return s;
    const cells = Object.values(s.cells).filter((c): c is MetricCell => c !== undefined);
    const of = Math.max(0, ...cells.map((c) => c.coverage?.of ?? 0));
    let id: string | undefined;
    let name: string | undefined;
    if (of === 1) {
      id = s.clientIds?.[0];
      name = clients.find((c) => c.id === id)?.name;
      if (name === undefined) {
        const left = cells.flatMap((c) => c.excluded ?? [])[0];
        if (left) {
          id = left.id;
          name = left.name;
        }
      }
    } else if (of === 0 && s.clientIds?.length === 1) {
      // No coverage numbers (older result shape): the one client included is the one asked for.
      id = s.clientIds[0];
      name = clients.find((c) => c.id === id)?.name;
    }
    if (name === undefined || name === s.label) return s;
    changed = true;
    return { ...s, label: name };
  });
  return changed ? { ...result, series } : result;
}
