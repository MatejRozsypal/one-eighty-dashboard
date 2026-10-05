"use client";

/**
 * Table widget: rows are series (clients, verticals, or the combined rollup),
 * columns are metrics, built on `components/ui/DataTable`.
 *
 * - A gap is `n/a` plus muted status words; it sorts last in both directions
 *   (DataTable's null rule), because its sort key is null.
 * - `^` marks a caveat (hover lists them); a low-volume figure is muted.
 * - With benchmarks on, one "Industry" row per vertical sits below the data,
 *   also sorted last.
 * - A grain other than total with a single series makes the rows buckets.
 * - Rows start ordered by the first metric (`view.sort`, default highest
 *   first); clicking a heading re-sorts in the browser.
 *
 * Owner: RS7 (widgets). Design 1.13, 2.10, 1.9.
 */

import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/ui/DataTable";
import { NoValue } from "@/components/ui/EmptyState";
import type { MetricCell, ResultSeries } from "@/lib/reports/types";
import { BenchmarkTag } from "./BenchmarkHover";
import { CellDelta, NotesMark, PendingCell, StatusText } from "./CellStatus";
import { seriesColor } from "./chartTheme";
import { formatBucket, formatMetricValue } from "./format";
import { benchmarksFor, cellNotes, cellOf, type WidgetMetric, type WidgetProps } from "./types";

/** Static class strings so Tailwind sees every template (1 to 8 metrics, plus the label column). */
const GRID_CLASS: Record<number, string> = {
  1: "grid items-center gap-2 grid-cols-[minmax(120px,1.4fr)_repeat(1,minmax(152px,1fr))]",
  2: "grid items-center gap-2 grid-cols-[minmax(120px,1.4fr)_repeat(2,minmax(152px,1fr))]",
  3: "grid items-center gap-2 grid-cols-[minmax(120px,1.4fr)_repeat(3,minmax(152px,1fr))]",
  4: "grid items-center gap-2 grid-cols-[minmax(120px,1.4fr)_repeat(4,minmax(152px,1fr))]",
  5: "grid items-center gap-2 grid-cols-[minmax(120px,1.4fr)_repeat(5,minmax(152px,1fr))]",
  6: "grid items-center gap-2 grid-cols-[minmax(120px,1.4fr)_repeat(6,minmax(152px,1fr))]",
  7: "grid items-center gap-2 grid-cols-[minmax(120px,1.4fr)_repeat(7,minmax(152px,1fr))]",
  8: "grid items-center gap-2 grid-cols-[minmax(120px,1.4fr)_repeat(8,minmax(152px,1fr))]",
};

const CELL_TEXT = "font-mono text-[12.5px] tabular";

function words(key: string): string {
  return key.replace(/_/g, " ");
}

function valueNode(args: {
  value: number | null;
  metric: WidgetMetric;
  cell: MetricCell;
  currency: string;
  notes: string[];
  showDelta: boolean;
}) {
  const { value, metric, cell, currency, notes, showDelta } = args;
  if (cell.status !== "ok") return <StatusText cell={cell} />;
  if (value === null) return <NoValue />;
  return (
    <span className="inline-flex items-baseline justify-end gap-2">
      <span className={`${CELL_TEXT} ${cell.lowVolume ? "text-content-muted" : "text-content-strong"}`} title={cell.lowVolume ? "Low volume" : undefined}>
        {formatMetricValue(value, metric.format, currency)}
      </span>
      <NotesMark lines={cell.lowVolume && notes.length ? [...notes, "Low volume"] : notes} />
      {showDelta && (
        <span className="inline-block min-w-[68px] text-left">
          <CellDelta
            delta={cell.delta}
            kind={cell.deltaKind}
            suppressed={cell.deltaSuppressed}
            goodWhen={metric.goodWhen}
            total={value}
            compareTotal={cell.compareTotal}
            format={metric.format}
            currency={currency}
          />
        </span>
      )}
    </span>
  );
}

export function TableWidget({ result, metrics, caveatTexts, view, pending = false }: WidgetProps) {
  const columns: DataTableColumn[] = [
    { key: "label", label: result.series.length === 1 && result.grain !== "total" ? "Period" : "Series", sortable: true },
    ...metrics.map((m): DataTableColumn => ({ key: m.id, label: m.label, align: "right", sortable: true })),
  ];

  const byBucket = result.grain !== "total" && result.series.length === 1 && result.buckets.length > 0;
  const rows: DataTableRow[] = [];

  if (byBucket) {
    const series = result.series[0];
    result.buckets.forEach((bucket, i) => {
      const partial = result.partialBuckets.includes(i);
      rows.push({
        key: bucket,
        cells: [
          <span key="l" className="inline-flex items-baseline gap-1 text-[12.5px] text-content-strong">
            {formatBucket(bucket, result.grain)}
            {partial && <NotesMark lines={["Partial period"]} />}
          </span>,
          ...metrics.map((m) => {
            const cell = cellOf(series, m.id);
            if (!cell) return pending ? <PendingCell key={m.id} /> : <StatusText key={m.id} cell={{ status: "no_data" }} />;
            const value = cell.points?.[i] ?? null;
            return (
              <span key={m.id}>{valueNode({ value, metric: m, cell, currency: result.currency, notes: [], showDelta: false })}</span>
            );
          }),
        ],
        sort: [bucket, ...metrics.map((m) => cellOf(series, m.id)?.points?.[i] ?? null)],
      });
    });
  } else {
    const first = metrics[0];
    const direction = view.sort === "asc" ? 1 : -1;
    const ordered = [...result.series].sort((a, b) => {
      const av = first ? cellOf(a, first.id) : undefined;
      const bv = first ? cellOf(b, first.id) : undefined;
      const x = av?.status === "ok" ? av.total : null;
      const y = bv?.status === "ok" ? bv.total : null;
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * direction;
    });

    for (const series of ordered) {
      rows.push(seriesRow(series, metrics, result.currency, caveatTexts, pending));
    }

    // One Industry row per vertical among the matches.
    const verticals = new Map<string, string>();
    for (const b of result.benchmarks) verticals.set(`${b.vertical}|${b.region}`, b.vertical);
    for (const [key, vertical] of verticals) {
      rows.push({
        key: `industry:${key}`,
        cells: [
          <span key="l" className="text-[12.5px] text-content-muted">
            Industry {words(vertical)}
          </span>,
          ...metrics.map((m) => {
            const match = benchmarksFor(result, m.id).find((b) => `${b.vertical}|${b.region}` === key);
            if (!m.benchmarkable || !match) return <NoValue key={m.id} />;
            return <BenchmarkTag key={m.id} match={match} metric={m} currency={result.currency} />;
          }),
        ],
        sort: columns.map(() => null),
      });
    }
  }

  const n = Math.min(Math.max(metrics.length, 1), 8);
  return (
    <div className="h-full min-h-0 overflow-auto">
      <div style={{ minWidth: 140 + 152 * n }}>
        <DataTable columns={columns} rows={rows} gridClass={GRID_CLASS[n]} emptyMessage="No data in this range." />
      </div>
    </div>
  );
}

function seriesRow(series: ResultSeries, metrics: readonly WidgetMetric[], currency: string, caveatTexts: WidgetProps["caveatTexts"], pending: boolean): DataTableRow {
  return {
    key: series.id,
    cells: [
      <span key="l" className="inline-flex min-w-0 items-center gap-2 text-[12.5px] text-content-strong">
        <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full" style={{ background: seriesColor(series.slot) }} />
        <span className="truncate">{series.label}</span>
      </span>,
      ...metrics.map((m) => {
        const cell = cellOf(series, m.id);
        if (!cell) return pending ? <PendingCell key={m.id} /> : <StatusText key={m.id} cell={{ status: "no_data" }} />;
        return (
          <span key={m.id}>
            {valueNode({ value: cell.total, metric: m, cell, currency, notes: cellNotes(series, m, cell, caveatTexts), showDelta: true })}
          </span>
        );
      }),
    ],
    sort: [series.label, ...metrics.map((m) => {
      const cell = cellOf(series, m.id);
      return cell && cell.status === "ok" ? cell.total : null;
    })],
  };
}
