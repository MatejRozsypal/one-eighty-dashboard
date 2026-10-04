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
 * hidden. A gap never draws 0. The sparkline of a gap is muted and only drawn
 * when two or more buckets still have values (an fx_missing month breaks the
 * line, it does not zero it).
 *
 * Owner: RS7 (widgets).
 */

import { Sparkline } from "@/components/ui/Sparkline";
import { BenchmarkStrip } from "./BenchmarkHover";
import { CellDelta, NotesMark, StatusText } from "./CellStatus";
import { formatMetricValue } from "./format";
import { benchmarksFor, cellNotes, cellOf, type WidgetProps } from "./types";

export interface KpiWidgetProps extends WidgetProps {
  seriesId?: string;
  metricId?: string;
}

export function KpiWidget({ result, metrics, caveatTexts, seriesId, metricId }: KpiWidgetProps) {
  const metric = metrics.find((m) => m.id === metricId) ?? metrics[0];
  const series = result.series.find((s) => s.id === seriesId) ?? result.series[0];
  if (!metric || !series) return <div className="h-full" />;

  const cell = cellOf(series, metric.id);
  if (!cell) {
    // The query asked for it and the result has no cell: a gap, never a zero.
    return (
      <div className="flex h-full flex-col justify-center gap-1">
        <StatusText cell={{ status: "no_data" }} size="lg" />
      </div>
    );
  }

  const ok = cell.status === "ok" && cell.total !== null;
  const spark = cell.points && cell.points.filter((p) => p !== null).length >= 2 ? cell.points : null;
  const matches = benchmarksFor(result, metric.id, series);
  const notes = cellNotes(series, metric, cell, caveatTexts);

  return (
    <div className="flex h-full min-h-0 flex-col justify-between gap-2">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline">
          {ok ? (
            <span
              className={`font-mono text-[28px] font-medium leading-none tabular ${cell.lowVolume ? "text-content-muted" : "text-content-strong"}`}
              title={cell.lowVolume ? "Low volume" : undefined}
            >
              {formatMetricValue(cell.total, metric.format, result.currency)}
            </span>
          ) : (
            <StatusText cell={cell} size="lg" />
          )}
          {ok && <NotesMark lines={cell.lowVolume ? [...notes, ...(notes.length ? ["Low volume"] : [])] : notes} />}
        </div>

        {ok && cell.delta !== null && <CellDelta delta={cell.delta} kind={cell.deltaKind} goodWhen={metric.goodWhen} />}

        {metric.benchmarkable && <BenchmarkStrip matches={matches} metric={metric} currency={result.currency} />}
      </div>

      {spark && <Sparkline data={spark} tone={ok ? "accent" : "muted"} height={40} />}
    </div>
  );
}
