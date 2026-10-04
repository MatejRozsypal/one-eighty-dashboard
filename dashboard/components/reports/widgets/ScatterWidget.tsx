"use client";

/**
 * Scatter widget: one point per series, X and Y from `view.scatter`, optional
 * size. Load through `next/dynamic` (index.tsx).
 *
 * - A point needs an ok X and an ok Y. A series without one is omitted and a
 *   footnote says why, one line each ("Name: Meta not connected"): a gap is
 *   never plotted at 0. A missing Size only falls back to a default dot size.
 * - Points keep their client colour; with 8 points or fewer they carry a
 *   direct label (`^` after it when a caveat applies to X or Y), and the
 *   legend lists the plotted series.
 * - Benchmark: a dashed crosshair, vertical for the X benchmark and
 *   horizontal for the Y benchmark. The tags under the chart carry the hover
 *   cards, including a hidden (no_fx) benchmark's reason.
 *
 * Owner: RS7 (widgets). Design 1.9, 1.13, 2.10.
 */

import { useMemo } from "react";
import { CartesianGrid, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, type TooltipProps } from "recharts";
import { NO_VALUE } from "@/lib/format";
import type { MetricId } from "@/lib/reports/registry/ids";
import { BenchmarkStrip } from "./BenchmarkHover";
import { SeriesLegend, type LegendItem } from "./CellStatus";
import { ChartFrame, TooltipCard, TooltipRow } from "./ChartFrame";
import { AXIS_TICK, BENCHMARK, GRID_STROKE, SURFACE, TEXT_MUTED, TEXT_STRONG, assignSeriesStyles } from "./chartTheme";
import { formatAxisValue, formatMetricValue, statusReason } from "./format";
import { benchmarksFor, cellNotes, cellOf, drawnBenchmarks, isOk, type ChartWidgetProps, type WidgetMetric } from "./types";

const MAX_LABELLED_POINTS = 8;
const SIZE_RANGE: [number, number] = [64, 360];
const DEFAULT_SIZE = 120;

interface Point {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  /** Size metric present for this point. */
  sized: boolean;
  zValue: number | null;
  color: string;
  caveat: boolean;
  notes: string[];
}

export function ScatterWidget({ result, metrics, caveatTexts, view, size }: ChartWidgetProps) {
  const spec = view.scatter;
  const find = (id: MetricId | undefined): WidgetMetric | undefined => metrics.find((m) => m.id === id);
  const xm = find(spec?.x);
  const ym = find(spec?.y);
  const sm = find(spec?.size);
  const styles = useMemo(() => assignSeriesStyles(result.series), [result.series]);

  if (!xm || !ym) {
    return (
      <div className="grid h-full place-items-center">
        <span className="text-content-muted">{NO_VALUE}</span>
      </div>
    );
  }

  const points: Point[] = [];
  const omitted: string[] = [];
  const sizes = result.series.flatMap((s) => {
    const c = sm ? cellOf(s, sm.id) : undefined;
    return isOk(c) ? [c.total] : [];
  });
  const meanSize = sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 1;

  result.series.forEach((s, k) => {
    const cx = cellOf(s, xm.id);
    const cy = cellOf(s, ym.id);
    if (!isOk(cx) || !isOk(cy)) {
      const gap = !isOk(cx) ? cx : cy;
      omitted.push(`${s.label}: ${gap ? statusReason(gap) : "No data"}`);
      return;
    }
    const cs = sm ? cellOf(s, sm.id) : undefined;
    const notes = [...cellNotes(s, xm, cx, caveatTexts), ...cellNotes(s, ym, cy, caveatTexts)];
    points.push({
      id: s.id,
      label: s.label,
      x: cx.total,
      y: cy.total,
      z: sm ? (isOk(cs) ? cs.total : meanSize) : DEFAULT_SIZE,
      sized: sm ? isOk(cs) : false,
      zValue: isOk(cs) ? cs.total : null,
      color: styles[k].color,
      caveat: notes.length > 0,
      notes: Array.from(new Set(notes)),
    });
  });

  const labelled = points.length <= MAX_LABELLED_POINTS;
  const legend: LegendItem[] = points.map((p) => ({ id: p.id, label: p.label, color: p.color }));
  const xMatches = xm.benchmarkable ? benchmarksFor(result, xm.id) : [];
  const yMatches = ym.benchmarkable ? benchmarksFor(result, ym.id) : [];
  const xLines = drawnBenchmarks(xMatches);
  const yLines = drawnBenchmarks(yMatches);

  const fmtX = (v: number | null | undefined) => formatMetricValue(v, xm.format, result.currency);
  const fmtY = (v: number | null | undefined) => formatMetricValue(v, ym.format, result.currency);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shape = (p: any) => {
    const d = p.payload as Point;
    const r = Math.max(4, Math.sqrt((typeof p.size === "number" ? p.size : DEFAULT_SIZE) / Math.PI));
    return (
      <g>
        <circle cx={p.cx} cy={p.cy} r={r} fill={d.color} fillOpacity={0.9} stroke={SURFACE} strokeWidth={2} />
        {labelled && (
          <text x={p.cx + r + 4} y={p.cy} dy={4} fontSize={10.5} fontFamily="var(--font-mono)" fill={TEXT_STRONG}>
            {d.label}
            {d.caveat ? "^" : ""}
          </text>
        )}
      </g>
    );
  };

  const tooltip = ({ active, payload }: TooltipProps<number, string>) => {
    if (!active || !payload || payload.length === 0) return null;
    const d = payload[0].payload as Point;
    return (
      <TooltipCard title={d.label}>
        <TooltipRow color={d.color} name={xm.label} value={fmtX(d.x)} />
        <TooltipRow name={ym.label} value={fmtY(d.y)} />
        {sm && <TooltipRow name={sm.label} value={d.sized ? formatMetricValue(d.zValue, sm.format, result.currency) : NO_VALUE} muted={!d.sized} />}
        {d.notes.map((n) => (
          <div key={n} className="mt-1 text-content-muted">
            ^ {n}
          </div>
        ))}
      </TooltipCard>
    );
  };

  const axisTitle = (value: string, angle?: number) => ({
    value,
    angle,
    position: angle ? ("insideLeft" as const) : ("insideBottom" as const),
    offset: angle ? 4 : -4,
    fontSize: 10.5,
    fontFamily: "var(--font-mono)",
    fill: TEXT_MUTED,
  });

  const line = (b: (typeof xLines)[number], axis: "x" | "y", fmt: (v: number) => string) => (
    <ReferenceLine
      key={`${axis}-${b.benchmarkId}`}
      {...(axis === "x" ? { x: b.value } : { y: b.value })}
      stroke={BENCHMARK.stroke}
      strokeWidth={BENCHMARK.width}
      strokeDasharray={BENCHMARK.dash}
      strokeOpacity={b.status === "stale" ? BENCHMARK.staleOpacity : 1}
      ifOverflow="extendDomain"
      label={{ value: `I ${fmt(b.value)}`, position: "insideTopRight", fontSize: 10.5, fontFamily: "var(--font-mono)", fill: TEXT_MUTED }}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {points.length >= 2 && <SeriesLegend items={legend} />}

      <div className="min-h-0 flex-1" role="img" aria-label={`${ym.label} against ${xm.label}`}>
        {points.length === 0 ? (
          <div className="grid h-full place-items-center">
            <span className="text-content-muted">{NO_VALUE}</span>
          </div>
        ) : (
          <ChartFrame size={size}>
            <ScatterChart margin={{ top: 12, right: labelled ? 64 : 12, bottom: 16, left: 12 }}>
              <CartesianGrid stroke={GRID_STROKE} />
              <XAxis
                type="number"
                dataKey="x"
                name={xm.label}
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => formatAxisValue(v, xm.format, result.currency)}
                label={axisTitle(xm.label)}
              />
              <YAxis
                type="number"
                dataKey="y"
                name={ym.label}
                tickLine={false}
                axisLine={false}
                width={52}
                tick={AXIS_TICK}
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => formatAxisValue(v, ym.format, result.currency)}
                label={axisTitle(ym.label, -90)}
              />
              <ZAxis type="number" dataKey="z" range={SIZE_RANGE} />
              <Tooltip content={tooltip} cursor={{ stroke: "var(--gray-250)", strokeDasharray: "2 3" }} isAnimationActive={false} />
              {xLines.map((b) => line(b, "x", fmtX))}
              {yLines.map((b) => line(b, "y", fmtY))}
              <Scatter data={points} shape={shape} isAnimationActive={false} />
            </ScatterChart>
          </ChartFrame>
        )}
      </div>

      {(xMatches.length > 0 || yMatches.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {xMatches.length > 0 && (
            <span className="inline-flex items-center gap-2">
              <span className="font-mono text-[11px] text-content-muted">{xm.label}</span>
              <BenchmarkStrip matches={xMatches} metric={xm} currency={result.currency} />
            </span>
          )}
          {yMatches.length > 0 && (
            <span className="inline-flex items-center gap-2">
              <span className="font-mono text-[11px] text-content-muted">{ym.label}</span>
              <BenchmarkStrip matches={yMatches} metric={ym} currency={result.currency} />
            </span>
          )}
        </div>
      )}

      {omitted.length > 0 && (
        <ul className="space-y-0.5">
          {omitted.map((line) => (
            <li key={line} className="font-mono text-[11px] text-content-muted">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
