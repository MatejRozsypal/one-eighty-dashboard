"use client";

/**
 * Bar widget. Two shapes, chosen by the result's grain:
 *
 * - grain day, week or month: columns per bucket, one bar per series
 *   (grouped), or stacked when `view.stacked` and the metric adds up (money or
 *   counts; ratios and percents never stack). Stacked segments are separated
 *   by a 2px surface gap and only the top segment has the rounded end.
 * - grain total: one horizontal bar per series, zero baseline, 4px rounded end.
 *   A series with a gap has no bar: a hatched placeholder carries its status
 *   words ("Not connected", "No data", "No cost data", "No FX Oct 2026").
 *
 * Benchmark: a dashed marker line (vertical on horizontal bars, horizontal on
 * columns); not drawn on stacked columns, where a single level means nothing.
 * Load through `next/dynamic` (index.tsx).
 *
 * Owner: RS7 (widgets). Design 1.9, 1.13, 2.10, 5.2.
 */

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Rectangle, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { NO_VALUE } from "@/lib/format";
import type { MetricId } from "@/lib/reports/registry/ids";
import { BenchmarkStrip } from "./BenchmarkHover";
import { MetricSwitch, SeriesLegend, type LegendItem } from "./CellStatus";
import { ChartFrame, TooltipCard, TooltipRow, useHatch } from "./ChartFrame";
import {
  AXIS_TICK,
  BAR_RADIUS,
  BENCHMARK,
  GRID_STROKE,
  MARGIN,
  MUTED_FILL,
  SURFACE,
  SURFACE_GAP,
  TEXT_MUTED,
  assignSeriesStyles,
} from "./chartTheme";
import { formatAxisValue, formatBucket, formatMetricValue, statusLabel } from "./format";
import { benchmarksFor, cellNotes, cellOf, drawnBenchmarks, hasLine, type ChartWidgetProps } from "./types";

type Row = Record<string, string | number | boolean | null>;

export function BarWidget({ result, metrics, caveatTexts, view, size }: ChartWidgetProps) {
  const [chosen, setChosen] = useState<MetricId | undefined>(metrics[0]?.id);
  const metric = metrics.find((m) => m.id === chosen) ?? metrics[0];
  const styles = useMemo(() => assignSeriesStyles(result.series), [result.series]);
  const hatch = useHatch();

  if (!metric) return <div className="h-full" />;

  const fmt = (v: number | null | undefined) => formatMetricValue(v, metric.format, result.currency);
  const total = result.grain === "total" || result.buckets.length === 0;
  const stacked = !total && view.stacked === true && (metric.unit === "money" || metric.unit === "count");

  const legend: LegendItem[] = result.series.map((s, k) => {
    const cell = cellOf(s, metric.id);
    return {
      id: s.id,
      label: s.label,
      color: styles[k].color,
      cell: cell ?? { status: "no_data" },
      notes: cell ? cellNotes(s, metric, cell, caveatTexts) : [],
    };
  });
  const anyGap = legend.some((l) => l.cell && l.cell.status !== "ok");
  const showLegend = result.series.length >= 2 || anyGap;
  const matches = metric.benchmarkable && !stacked ? benchmarksFor(result, metric.id) : [];
  const benchLines = drawnBenchmarks(matches);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      {showLegend ? <SeriesLegend items={legend} /> : <span />}
      <MetricSwitch options={metrics.map((m) => ({ id: m.id, label: m.label }))} value={metric.id} onChange={setChosen} />
    </div>
  );

  const benchLabel = (value: number) => ({
    value: `I ${fmt(value)}`,
    position: "insideTopRight" as const,
    fontSize: 10.5,
    fontFamily: "var(--font-mono)",
    fill: TEXT_MUTED,
  });

  // ---- Total: one horizontal bar per series ------------------------------------------------
  if (total) {
    const data = result.series.map((s, k) => {
      const cell = cellOf(s, metric.id);
      const ok = cell?.status === "ok" && cell.total !== null;
      return {
        id: s.id,
        name: s.label,
        v: ok ? (cell?.total ?? 0) : 0,
        gap: !ok,
        status: cell ? statusLabel(cell) : "No data",
        color: styles[k].color,
        lowVolume: cell?.lowVolume === true,
      };
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shape = (p: any) => {
      const d = p.payload as (typeof data)[number];
      if (d.gap) {
        const bx = typeof p.background?.x === "number" ? p.background.x : p.x;
        const bw = typeof p.background?.width === "number" ? p.background.width : 120;
        return (
          <g>
            <rect x={bx} y={p.y} width={bw} height={p.height} rx={BAR_RADIUS} fill={`url(#${hatch.id})`} />
            <text x={bx + 8} y={p.y + p.height / 2} dy={4} fontSize={10.5} fontFamily="var(--font-mono)" fill={TEXT_MUTED}>
              {`${NO_VALUE} ${d.status}`}
            </text>
          </g>
        );
      }
      return <Rectangle {...p} fill={d.color} fillOpacity={d.lowVolume ? 0.4 : 1} radius={[0, BAR_RADIUS, BAR_RADIUS, 0]} />;
    };

    const tooltip = ({ active, payload }: TooltipProps<number, string>) => {
      if (!active || !payload || payload.length === 0) return null;
      const d = payload[0].payload as (typeof data)[number];
      return (
        <TooltipCard title={d.name}>
          <TooltipRow color={d.color} name={metric.label} value={d.gap ? `${NO_VALUE} ${d.status}` : fmt(d.v)} muted={d.gap} />
        </TooltipCard>
      );
    };

    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        {header}
        <div className="min-h-0 flex-1" role="img" aria-label={`${metric.label} by series`}>
          <ChartFrame size={size}>
            <BarChart data={data} layout="vertical" margin={MARGIN} barCategoryGap="28%">
              {hatch.defs}
              <CartesianGrid stroke={GRID_STROKE} horizontal={false} />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
                tickFormatter={(v: number) => formatAxisValue(v, metric.format, result.currency)}
              />
              <YAxis
                type="category"
                dataKey="name"
                tickLine={false}
                axisLine={false}
                width={88}
                tick={AXIS_TICK}
                tickFormatter={(t: string) => (t.length > 12 ? `${t.slice(0, 11)}...` : t)}
              />
              <Tooltip content={tooltip} cursor={{ fill: MUTED_FILL, opacity: 0.6 }} isAnimationActive={false} />
              {benchLines.map((b) => (
                <ReferenceLine
                  key={b.benchmarkId}
                  x={b.value}
                  stroke={BENCHMARK.stroke}
                  strokeWidth={BENCHMARK.width}
                  strokeDasharray={BENCHMARK.dash}
                  strokeOpacity={b.status === "stale" ? BENCHMARK.staleOpacity : 1}
                  ifOverflow="extendDomain"
                  label={benchLabel(b.value)}
                />
              ))}
              <Bar dataKey="v" background={{ fill: "transparent" }} shape={shape} isAnimationActive={false} />
            </BarChart>
          </ChartFrame>
        </div>
        {matches.length > 0 && <BenchmarkStrip matches={matches} metric={metric} currency={result.currency} />}
      </div>
    );
  }

  // ---- Buckets: columns, grouped or stacked --------------------------------------------------
  const partial = new Set(result.partialBuckets);
  const rows: Row[] = result.buckets.map((bucket, i) => {
    const row: Row = { bucket, partial: partial.has(i) };
    result.series.forEach((s, k) => {
      row[`v${k}`] = cellOf(s, metric.id)?.points?.[i] ?? null;
    });
    return row;
  });
  const drawn = result.series.map((s, k) => ({ s, k, cell: cellOf(s, metric.id) })).filter(({ cell }) => hasLine(cell));
  const lastDrawn = drawn.length - 1;

  const tooltip = ({ active, payload }: TooltipProps<number, string>) => {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0].payload as Row;
    return (
      <TooltipCard title={`${formatBucket(String(row.bucket), result.grain)}${row.partial ? " (partial)" : ""}`}>
        {result.series.map((s, k) => {
          const cell = cellOf(s, metric.id);
          const v = row[`v${k}`];
          const text = typeof v === "number" ? fmt(v) : cell && cell.status !== "ok" ? `${NO_VALUE} ${statusLabel(cell)}` : NO_VALUE;
          return <TooltipRow key={s.id} color={styles[k].color} name={s.label} value={text} muted={typeof v !== "number"} />;
        })}
      </TooltipCard>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {header}
      <div className="min-h-0 flex-1" role="img" aria-label={`${metric.label} by period`}>
        {drawn.length === 0 ? (
          <div className="grid h-full place-items-center">
            <span className="text-content-muted">{NO_VALUE}</span>
          </div>
        ) : (
          <ChartFrame size={size}>
            <BarChart data={rows} margin={MARGIN} barGap={SURFACE_GAP} barCategoryGap="22%">
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
                tick={AXIS_TICK}
                tickFormatter={(v: number) => formatAxisValue(v, metric.format, result.currency)}
              />
              <Tooltip content={tooltip} cursor={{ fill: MUTED_FILL, opacity: 0.6 }} isAnimationActive={false} />
              {result.partialBuckets.map((i) =>
                result.buckets[i] ? <ReferenceArea key={i} x1={result.buckets[i]} x2={result.buckets[i]} fill={MUTED_FILL} fillOpacity={0.7} ifOverflow="visible" /> : null
              )}
              {benchLines.map((b) => (
                <ReferenceLine
                  key={b.benchmarkId}
                  y={b.value}
                  stroke={BENCHMARK.stroke}
                  strokeWidth={BENCHMARK.width}
                  strokeDasharray={BENCHMARK.dash}
                  strokeOpacity={b.status === "stale" ? BENCHMARK.staleOpacity : 1}
                  ifOverflow="extendDomain"
                  label={benchLabel(b.value)}
                />
              ))}
              {drawn.map(({ s, k }, i) => (
                <Bar
                  key={s.id}
                  dataKey={`v${k}`}
                  stackId={stacked ? "stack" : undefined}
                  fill={styles[k].color}
                  stroke={stacked ? SURFACE : undefined}
                  strokeWidth={stacked ? SURFACE_GAP : 0}
                  radius={!stacked || i === lastDrawn ? [BAR_RADIUS, BAR_RADIUS, 0, 0] : 0}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ChartFrame>
        )}
      </div>
      {matches.length > 0 && <BenchmarkStrip matches={matches} metric={metric} currency={result.currency} />}
    </div>
  );
}
