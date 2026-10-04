"use client";

/**
 * Ranked list: one metric, series sorted by it, a bar per row.
 * Hand-written HTML (no chart library).
 *
 * - Bars share one scale from zero to the largest value (negative values
 *   extend left of the zero line). The scale also reaches any drawn
 *   benchmark, so its marker is never off the track.
 * - Rows with a gap sink below the ranked rows with their status words and
 *   no bar; `view.limit` applies to the ranked rows only.
 * - Benchmark: a dashed vertical marker on the track, hover card on the marker.
 * - Low volume: muted bar and figure. `^`: caveats on hover.
 *
 * Owner: RS7 (widgets). Design 1.13, 2.10, 1.9.
 */

import { CellDelta, HoverCard, NotesMark, StatusText } from "./CellStatus";
import { BenchmarkCardBody, benchmarkLabel } from "./BenchmarkHover";
import { seriesColor } from "./chartTheme";
import { formatMetricValue } from "./format";
import { benchmarksFor, cellNotes, cellOf, drawnBenchmarks, isOk, type WidgetProps } from "./types";

const ROW = "grid grid-cols-[minmax(64px,0.9fr)_minmax(56px,2fr)_minmax(72px,auto)_minmax(0,64px)] items-center gap-x-3 py-1.5";
const MARKER_STYLE = {
  backgroundImage: "repeating-linear-gradient(to bottom, var(--benchmark) 0, var(--benchmark) 3px, transparent 3px, transparent 5px)",
} as const;

export function RankedWidget({ result, metrics, caveatTexts, view }: WidgetProps) {
  const metric = metrics[0];
  if (!metric) return <div className="h-full" />;

  const entries = result.series.map((series) => ({ series, cell: cellOf(series, metric.id) }));
  const direction = view.sort === "asc" ? 1 : -1;
  const ranked = entries
    .filter((e) => isOk(e.cell))
    .sort((a, b) => ((a.cell?.total ?? 0) - (b.cell?.total ?? 0)) * direction);
  const shown = view.limit ? ranked.slice(0, view.limit) : ranked;
  const sunk = entries.filter((e) => !isOk(e.cell));

  // One scale for every bar, reaching zero, the largest value and any drawn benchmark.
  const bench = metric.benchmarkable ? drawnBenchmarks(benchmarksFor(result, metric.id)) : [];
  const values = [...shown.map((e) => e.cell?.total ?? 0), ...bench.map((b) => b.value), 0];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;
  const zero = pos(0);

  return (
    <ul role="list" className="h-full min-h-0 overflow-auto">
      {shown.map(({ series, cell }) => {
        if (!cell || cell.total === null) return null;
        const left = Math.min(pos(cell.total), zero);
        const width = Math.abs(pos(cell.total) - zero);
        const notes = cellNotes(series, metric, cell, caveatTexts);
        const rowMarkers = metric.benchmarkable ? drawnBenchmarks(benchmarksFor(result, metric.id, series)) : [];
        return (
          <li key={series.id} className={ROW}>
            <span className="truncate font-mono text-[12px] text-content-body">{series.label}</span>
            <div className="relative h-2 rounded-[4px] bg-gray-100" aria-hidden={rowMarkers.length === 0 ? true : undefined}>
              <div
                className="absolute inset-y-0 rounded-r-[4px]"
                style={{ left: `${left}%`, width: `${width}%`, background: seriesColor(series.slot), opacity: cell.lowVolume ? 0.4 : 1 }}
              />
              {rowMarkers.map((b) => (
                <span key={b.benchmarkId} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos(b.value)}%`, opacity: b.status === "stale" ? 0.5 : 1 }}>
                  <HoverCard
                    label={benchmarkLabel(b, metric, result.currency)}
                    className="block px-1.5 py-0.5"
                    trigger={<span className="block h-[18px] w-[2px]" style={MARKER_STYLE} />}
                  >
                    <BenchmarkCardBody match={b} metric={metric} currency={result.currency} />
                  </HoverCard>
                </span>
              ))}
            </div>
            <span className="inline-flex items-baseline justify-end">
              <span
                className={`font-mono text-[12.5px] tabular ${cell.lowVolume ? "text-content-muted" : "text-content-strong"}`}
                title={cell.lowVolume ? "Low volume" : undefined}
              >
                {formatMetricValue(cell.total, metric.format, result.currency)}
              </span>
              <NotesMark lines={cell.lowVolume && notes.length ? [...notes, "Low volume"] : notes} />
            </span>
            <span className="justify-self-end">
              <CellDelta delta={cell.delta} kind={cell.deltaKind} goodWhen={metric.goodWhen} />
            </span>
          </li>
        );
      })}

      {sunk.map(({ series, cell }) => (
        <li key={series.id} className={ROW}>
          <span className="truncate font-mono text-[12px] text-content-muted">{series.label}</span>
          <span className="col-span-3 justify-self-end"><StatusText cell={cell ?? { status: "no_data" }} /></span>
        </li>
      ))}
    </ul>
  );
}
