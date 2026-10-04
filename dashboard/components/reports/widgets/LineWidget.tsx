"use client";

/**
 * Line widget: one line per series over the result's buckets, the comparison
 * period as a thin dotted line of the same colour, an optional benchmark.
 *
 * Load it through `next/dynamic` (see index.tsx): this file is the only place
 * besides Bar and Scatter that pulls Recharts in.
 *
 * - One axis. With several metrics a local switch picks which one is drawn;
 *   all of them arrived in one result, so switching never queries.
 * - Gaps are gaps: `connectNulls={false}`, so an fx_missing bucket or a week
 *   with no rows breaks the line instead of dropping to 0. A not-connected
 *   series has no line and is greyed in the legend with its reason.
 * - The legend is always there for two or more series; up to four series also
 *   get a direct end label.
 * - Benchmark: a dashed horizontal line per match (muted when stale), with the
 *   `I` tags and their hover cards under the chart. A hidden (no_fx) benchmark
 *   has no line; its tag explains why.
 * - A partial last bucket is shaded.
 * - Every hover shows all series with the comparison value.
 *
 * Owner: RS7 (widgets). Design 1.9, 1.13, 2.10, 5.2.
 */

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import type { MetricId } from "@/lib/reports/registry/ids";
import { NO_VALUE } from "@/lib/format";
import { BenchmarkStrip } from "./BenchmarkHover";
import { MetricSwitch, SeriesLegend, type LegendItem } from "./CellStatus";
import { ChartFrame, TooltipCard, TooltipRow } from "./ChartFrame";
import {
  AXIS_TICK,
  BENCHMARK,
  COMPARE,
  DOT_RADIUS,
  GRID_STROKE,
  LINE_WIDTH,
  MARGIN,
  MARGIN_LABELLED,
  MAX_DIRECT_LABELS,
  MAX_DOTS,
  MUTED_FILL,
  SURFACE,
  TEXT_STRONG,
  assignSeriesStyles,
} from "./chartTheme";
import { formatAxisValue, formatBucket, formatMetricValue, statusLabel } from "./format";
import { benchmarksFor, cellNotes, cellOf, drawnBenchmarks, hasLine, type ChartWidgetProps } from "./types";

type Row = Record<string, string | number | boolean | null>;

export function LineWidget({ result, metrics, caveatTexts, size }: ChartWidgetProps) {
  const [chosen, setChosen] = useState<MetricId | undefined>(metrics[0]?.id);
  const metric = metrics.find((m) => m.id === chosen) ?? metrics[0];
  const styles = useMemo(() => assignSeriesStyles(result.series), [result.series]);
  const partial = useMemo(() => new Set(result.partialBuckets), [result.partialBuckets]);

  const rows: Row[] = useMemo(() => {
    if (!metric) return [];
    return result.buckets.map((bucket, i) => {
      const row: Row = { bucket, partial: partial.has(i) };
      result.series.forEach((s, k) => {
        const cell = cellOf(s, metric.id);
        row[`v${k}`] = cell?.points?.[i] ?? null;
        row[`c${k}`] = cell?.comparePoints?.[i] ?? null;
      });
      return row;
    });
  }, [result.buckets, result.series, metric, partial]);

  if (!metric) return <div className="h-full" />;

  const drawn = result.series
    .map((s, k) => ({ s, k, cell: cellOf(s, metric.id) }))
    .filter(({ cell }) => hasLine(cell));
  const comparing = result.comparison !== null && drawn.some(({ cell }) => cell?.comparePoints?.some((p) => p !== null));
  const labelled = drawn.length >= 2 && drawn.length <= MAX_DIRECT_LABELS;

  const legend: LegendItem[] = result.series.map((s, k) => {
    const cell = cellOf(s, metric.id);
    return {
      id: s.id,
      label: s.label,
      color: styles[k].color,
      dash: styles[k].dash,
      cell: cell ?? { status: "no_data" },
      notes: cell ? cellNotes(s, metric, cell, caveatTexts) : [],
    };
  });
  const anyGap = legend.some((l) => l.cell && l.cell.status !== "ok");
  const matches = metric.benchmarkable ? benchmarksFor(result, metric.id) : [];
  const lines = metric.benchmarkable ? drawnBenchmarks(matches) : [];

  const lastPartial = result.partialBuckets.length > 0 ? Math.max(...result.partialBuckets) : -1;
  const shade = lastPartial > 0 && result.buckets[lastPartial] ? { from: result.buckets[lastPartial - 1], to: result.buckets[lastPartial] } : null;

  const fmt = (v: number | null | undefined) => formatMetricValue(v, metric.format, result.currency);

  function endLabel(lastIndex: number, text: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return function EndLabel(p: any) {
      if (p.index !== lastIndex || typeof p.x !== "number" || typeof p.y !== "number") return <g key={p.index} />;
      return (
        <text key={p.index} x={p.x + 8} y={p.y} dy={4} fontSize={10.5} fontFamily="var(--font-mono)" fill={TEXT_STRONG}>
          {text.length > 10 ? `${text.slice(0, 9)}...` : text}
        </text>
      );
    };
  }

  function tooltip({ active, payload }: TooltipProps<number, string>) {
    if (!active || !payload || payload.length === 0 || !metric) return null;
    const row = payload[0].payload as Row;
    const bucket = String(row.bucket);
    return (
      <TooltipCard title={`${formatBucket(bucket, result.grain)}${row.partial ? " (partial)" : ""}`}>
        {result.series.map((s, k) => {
          const cell = cellOf(s, metric.id);
          const v = row[`v${k}`];
          const c = row[`c${k}`];
          const value = typeof v === "number" ? fmt(v) : cell && cell.status !== "ok" ? `${NO_VALUE} ${statusLabel(cell)}` : NO_VALUE;
          return (
            <div key={s.id}>
              <TooltipRow color={styles[k].color} name={s.label} value={value} muted={typeof v !== "number"} />
              {comparing && typeof c === "number" && <TooltipRow name="before" value={fmt(c)} muted />}
            </div>
          );
        })}
      </TooltipCard>
    );
  }

  const showLegend = result.series.length >= 2 || anyGap;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {showLegend ? <SeriesLegend items={legend} /> : <span />}
        <MetricSwitch options={metrics.map((m) => ({ id: m.id, label: m.label }))} value={metric.id} onChange={setChosen} />
      </div>

      <div className="min-h-0 flex-1" role="img" aria-label={`${metric.label} over time`}>
        {drawn.length === 0 || rows.length === 0 ? (
          <div className="grid h-full place-items-center">
            <span className="text-content-muted">{NO_VALUE}</span>
          </div>
        ) : (
          <ChartFrame size={size}>
            <LineChart data={rows} margin={labelled ? MARGIN_LABELLED : MARGIN}>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis
                dataKey="bucket"
                tickLine={false}
                axisLine={false}
                minTickGap={28}
                tick={AXIS_TICK}
                tickFormatter={(b: string) => formatBucket(b, result.grain)}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={52}
                domain={["auto", "auto"]}
                tick={AXIS_TICK}
                tickFormatter={(v: number) => formatAxisValue(v, metric.format, result.currency)}
              />
              <Tooltip content={tooltip} cursor={{ stroke: "var(--gray-250)", strokeWidth: 1 }} isAnimationActive={false} />
              {shade && <ReferenceArea x1={shade.from} x2={shade.to} fill={MUTED_FILL} fillOpacity={0.7} ifOverflow="visible" />}
              {lines.map((b) => (
                <ReferenceLine
                  key={b.benchmarkId}
                  y={b.value}
                  stroke={BENCHMARK.stroke}
                  strokeWidth={BENCHMARK.width}
                  strokeDasharray={BENCHMARK.dash}
                  strokeOpacity={b.status === "stale" ? BENCHMARK.staleOpacity : 1}
                  ifOverflow="extendDomain"
                  label={{ value: `I ${fmt(b.value)}`, position: "insideTopRight", fontSize: 10.5, fontFamily: "var(--font-mono)", fill: "var(--text-muted)" }}
                />
              ))}
              {comparing &&
                drawn.map(({ s, k }) => (
                  <Line
                    key={`${s.id}-compare`}
                    dataKey={`c${k}`}
                    stroke={styles[k].color}
                    strokeWidth={COMPARE.width}
                    strokeDasharray={COMPARE.dash}
                    strokeOpacity={COMPARE.opacity}
                    dot={false}
                    activeDot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                    legendType="none"
                  />
                ))}
              {drawn.map(({ s, k, cell }) => {
                const points = cell?.points ?? [];
                let last = -1;
                points.forEach((p, i) => {
                  if (p !== null) last = i;
                });
                return (
                  <Line
                    key={s.id}
                    dataKey={`v${k}`}
                    stroke={styles[k].color}
                    strokeWidth={LINE_WIDTH}
                    strokeDasharray={styles[k].dash}
                    dot={rows.length <= MAX_DOTS ? { r: DOT_RADIUS, fill: styles[k].color, stroke: SURFACE, strokeWidth: 2 } : false}
                    activeDot={{ r: DOT_RADIUS + 1, fill: styles[k].color, stroke: SURFACE, strokeWidth: 2 }}
                    connectNulls={false}
                    isAnimationActive={false}
                    label={labelled ? endLabel(last, s.label) : undefined}
                  />
                );
              })}
            </LineChart>
          </ChartFrame>
        )}
      </div>

      {metric.benchmarkable && <BenchmarkStrip matches={matches} metric={metric} currency={result.currency} />}
    </div>
  );
}
