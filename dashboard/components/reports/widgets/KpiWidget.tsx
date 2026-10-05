"use client";

/**
 * KPI tile: one figure, its change, an optional benchmark tag, a sparkline.
 * Hand-written HTML plus `Sparkline` (no chart library).
 *
 * Shows the first series and the first metric of the result (a KPI is one
 * metric split "combined"); `seriesId` and `metricId` pick another for tests
 * or a caller that lays several tiles out itself. The widget title is the
 * frame's job, so the tile carries no label of its own.
 *
 * Gaps (design 2.10): the value is `n/a` with a muted status and the delta is
 * hidden. A gap never draws 0. A gap draws no sparkline either (a trend next
 * to "n/a" reads as data); an ok value gets one when two or more buckets have
 * values (an fx_missing month breaks the line, it does not zero it).
 *
 * Owner: RS7 (widgets).
 */

import { Sparkline } from "@/components/ui/Sparkline";
import { formatNumber } from "@/lib/format";
import type { MetricReference } from "@/lib/reports/registry/types";
import { BenchmarkStrip } from "./BenchmarkHover";
import { CellDelta, NotesMark, PendingCell, StatusText } from "./CellStatus";
import { formatMetricValue } from "./format";
import { benchmarksFor, cellNotes, cellOf, type WidgetProps } from "./types";

export interface KpiWidgetProps extends WidgetProps {
  seriesId?: string;
  metricId?: string;
}

export function KpiWidget({ result, metrics, caveatTexts, seriesId, metricId, pending = false }: KpiWidgetProps) {
  const metric = metrics.find((m) => m.id === metricId) ?? metrics[0];
  const series = result.series.find((s) => s.id === seriesId) ?? result.series[0];
  if (!metric || !series) return <div className="h-full" />;

  const cell = cellOf(series, metric.id);
  if (!cell) {
    // The query asked for it and the result has no cell: a gap, never a zero.
    return (
      <div className="flex h-full flex-col justify-center gap-1">
        {pending ? <PendingCell size="lg" /> : <StatusText cell={{ status: "no_data" }} size="lg" />}
      </div>
    );
  }

  const ok = cell.status === "ok" && cell.total !== null;
  // No sparkline behind an n/a: a trend line next to "no data" reads as data.
  const spark = ok && cell.points && cell.points.filter((p) => p !== null).length >= 2 ? cell.points : null;
  const matches = benchmarksFor(result, metric.id, series);
  // A fixed reference value (hit rate ~5%) is named on hover, never drawn as a benchmark.
  const reference = (metric as { reference?: MetricReference }).reference;
  const notes = [...cellNotes(series, metric, cell, caveatTexts), ...(reference ? [reference.label] : [])];

  return (
    <div className="flex h-full min-h-0 flex-col justify-between gap-2">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-y-1">
          {ok ? (
            <span
              className={`kpi-value font-mono text-[28px] font-medium leading-none tabular ${cell.lowVolume ? "text-content-muted" : "text-content-strong"}`}
              title={cell.lowVolume ? "Low volume" : undefined}
            >
              {formatMetricValue(cell.total, metric.format, result.currency)}
            </span>
          ) : (
            <StatusText cell={cell} size="lg" />
          )}
          {ok && <NotesMark lines={cell.lowVolume ? [...notes, ...(notes.length ? ["Low volume"] : [])] : notes} />}
        </div>

        {ok && cell.counts && (
          <span className="font-mono text-[12px] tabular text-content-muted">
            {formatNumber(cell.counts.part, { decimals: 0 })} of {formatNumber(cell.counts.whole, { decimals: 0 })} {cell.counts.noun}
          </span>
        )}

        {ok && !cell.deltaSuppressed && (cell.delta !== null || cell.compareTotal !== null) && (
          <CellDelta
            delta={cell.delta}
            kind={cell.deltaKind}
            suppressed={cell.deltaSuppressed}
            goodWhen={metric.goodWhen}
            total={cell.total}
            compareTotal={cell.compareTotal}
            format={metric.format}
            currency={result.currency}
          />
        )}

        {metric.benchmarkable && <BenchmarkStrip matches={matches} metric={metric} currency={result.currency} />}
      </div>

      {spark && <Sparkline data={spark} tone="accent" height={40} />}
    </div>
  );
}
