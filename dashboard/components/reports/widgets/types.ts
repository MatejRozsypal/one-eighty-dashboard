/**
 * Shared props and data helpers of the report widgets.
 *
 * Widgets never import the metric registry (it is server-adjacent and owned by
 * WP1). The page passes `WidgetMetric[]` in query order, picked from the
 * registry, and `CaveatTexts`, picked from CAVEATS (`short`). A registered
 * metric is assignable to WidgetMetric as is.
 *
 * Pure module. Owner: RS7 (widgets).
 */

import type { MetricId } from "@/lib/reports/registry/ids";
import type { CaveatId, MetricBase } from "@/lib/reports/registry/types";
import type { BenchmarkMatch, MetricCell, ResultSeries, WidgetResult, WidgetView } from "@/lib/reports/types";
import { humanize } from "./format";

/** The registry fields a widget needs. */
export type WidgetMetric = Pick<MetricBase, "label" | "unit" | "format" | "goodWhen" | "benchmarkable" | "caveats" | "reference"> & {
  id: MetricId;
};

/** Hover text per caveat id (`CAVEATS[id].short`). A missing entry falls back to the id in words. */
export type CaveatTexts = Readonly<Partial<Record<CaveatId, string>>>;

export interface WidgetProps {
  result: WidgetResult;
  /** The widget's metrics in display order (`query.metrics`). */
  metrics: readonly WidgetMetric[];
  caveatTexts: CaveatTexts;
  view: WidgetView;
  /**
   * The result on screen is older than the request (a refetch is running). A
   * metric the old result has no cell for is not "no data", it is not here yet:
   * the cell draws a skeleton, not `n/a`.
   */
  pending?: boolean;
}

/** Chart widgets measure themselves; pass `size` to render at a fixed size (print, tests). */
export interface ChartWidgetProps extends WidgetProps {
  size?: { width: number; height: number };
}

export function cellOf(series: ResultSeries, metricId: MetricId): MetricCell | undefined {
  return series.cells[metricId];
}

/** A cell with a plottable total. */
export function isOk(cell: MetricCell | undefined): cell is MetricCell & { total: number } {
  return cell !== undefined && cell.status === "ok" && cell.total !== null;
}

/** "4 of 5 clients": the first hover line of a partial rollup. NotesMark shows "4 of 5" as its trigger for it. */
export function coverageLine(included: number, of: number): string {
  return `${included} of ${of} clients`;
}

const COVERAGE_LINE_RE = /^(\d+) of (\d+) clients$/;

/** The compact marker text ("4 of 5") of a coverage line, or null. */
export function coverageBadge(line: string | undefined): string | null {
  const m = line === undefined ? null : COVERAGE_LINE_RE.exec(line);
  return m ? `${m[1]} of ${m[2]}` : null;
}

/**
 * Hover lines behind the `^` marker: "4 of 5 clients" for a partial rollup
 * followed by each left-out client and why ("RawBark: Missing days"), then
 * the caveats that apply to this series AND this metric. Empty means no
 * marker.
 */
export function cellNotes(series: ResultSeries, metric: WidgetMetric, cell: MetricCell, texts: CaveatTexts): string[] {
  if (cell.status !== "ok") return [];
  const lines: string[] = [];
  if (cell.coverage && cell.coverage.included < cell.coverage.of) {
    lines.push(coverageLine(cell.coverage.included, cell.coverage.of));
    for (const e of cell.excluded ?? []) lines.push(`${e.name}: ${e.reason}`);
  }
  const applicable = new Set(metric.caveats ?? []);
  for (const id of series.caveats) {
    if (applicable.has(id)) lines.push(texts[id] ?? humanize(id));
  }
  return lines;
}

/** Benchmarks of one metric that apply to a series (all of them when no series is given). */
export function benchmarksFor(result: WidgetResult, metricId: MetricId, series?: ResultSeries): BenchmarkMatch[] {
  return result.benchmarks.filter((b) => {
    if (b.metricId !== metricId) return false;
    if (!series) return true;
    const ids = series.clientIds ?? [series.id];
    return b.appliesTo.some((id) => ids.includes(id));
  });
}

/** Matches that are drawn: ok and stale with a value. no_fx is hidden (its hover says why). */
export function drawnBenchmarks(matches: readonly BenchmarkMatch[]): Array<BenchmarkMatch & { value: number }> {
  const seen = new Set<string>();
  const out: Array<BenchmarkMatch & { value: number }> = [];
  for (const b of matches) {
    if (b.status === "no_fx" || b.value === null || seen.has(b.benchmarkId)) continue;
    seen.add(b.benchmarkId);
    out.push({ ...b, value: b.value });
  }
  return out;
}

/** True when the cell has at least one plottable point (not_connected cells have no line at all). */
export function hasLine(cell: MetricCell | undefined): boolean {
  if (!cell || cell.status === "not_connected" || !cell.points) return false;
  return cell.points.some((p) => p !== null);
}

/** Series with its cell for one metric, in result order. */
export function seriesWithCell(result: WidgetResult, metricId: MetricId): Array<{ series: ResultSeries; cell: MetricCell | undefined; index: number }> {
  return result.series.map((series, index) => ({ series, cell: cellOf(series, metricId), index }));
}
