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

import { useMemo, useRef } from "react";
import { CartesianGrid, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, type TooltipProps } from "recharts";
import { NO_VALUE } from "@/lib/format";
import type { MetricId } from "@/lib/reports/registry/ids";
import { BenchmarkStrip } from "./BenchmarkHover";
import { SeriesLegend, type LegendItem } from "./CellStatus";
import { ChartFrame, TooltipCard, TooltipRow } from "./ChartFrame";
import { AXIS_TICK, BENCHMARK, GRID_STROKE, SURFACE, TEXT_MUTED, TEXT_STRONG, assignSeriesStyles, axisProbe, axisWidth, edgeMargin, textWidth, truncateLabel } from "./chartTheme";
import { formatAxisValue, formatMetricValue, statusReason } from "./format";
import { benchmarksFor, cellNotes, cellOf, drawnBenchmarks, isOk, type ChartWidgetProps, type WidgetMetric } from "./types";

const MAX_LABELLED_POINTS = 8;
const SIZE_RANGE: [number, number] = [64, 360];
const DEFAULT_SIZE = 120;
/** Point labels are cut here; the full name is on hover. */
const LABEL_MAX = 16;
/** Height of a label line, for the overlap test. */
const LABEL_H = 12;

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

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
  // Label boxes already placed in the current paint, by point order. Points are
  // drawn in order, so a point only has to avoid the ones before it.
  const placed = useRef(new Map<number, Box>());

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

  const order = new Map(points.map((p, i) => [p.id, i]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shape = (p: any) => {
    const d = p.payload as Point;
    const r = Math.max(4, Math.sqrt((typeof p.size === "number" ? p.size : DEFAULT_SIZE) / Math.PI));
    let label: { x: number; y: number; anchor: "start" | "end"; text: string } | null = null;
    if (labelled) {
      const i = order.get(d.id) ?? 0;
      const text = `${truncateLabel(d.label, LABEL_MAX)}${d.caveat ? "^" : ""}`;
      const w = textWidth(text);
      // Preferred spot first: right of the dot; then below it, above it, and
      // the same three on the left. The first one clear of earlier labels wins.
      const spots: Array<{ side: 1 | -1; dy: number }> = [
        { side: 1, dy: 0 },
        { side: 1, dy: LABEL_H },
        { side: 1, dy: -LABEL_H },
        { side: -1, dy: 0 },
        { side: -1, dy: LABEL_H },
        { side: -1, dy: -LABEL_H },
      ];
      let chosen = spots[0];
      let box: Box = { x0: 0, x1: 0, y0: 0, y1: 0 };
      for (const spot of spots) {
        const x0 = spot.side === 1 ? p.cx + r + 4 : p.cx - r - 4 - w;
        const y0 = p.cy + spot.dy - LABEL_H / 2;
        const candidate: Box = { x0, x1: x0 + w, y0, y1: y0 + LABEL_H };
        const clear = Array.from(placed.current.entries()).every(([j, b]) => j >= i || !overlaps(candidate, b));
        chosen = spot;
        box = candidate;
        if (clear) break;
      }
      placed.current.set(i, box);
      label = { x: chosen.side === 1 ? p.cx + r + 4 : p.cx - r - 4, y: p.cy + chosen.dy, anchor: chosen.side === 1 ? "start" : "end", text };
    }
    return (
      <g>
        <title>{d.label}</title>
        <circle cx={p.cx} cy={p.cy} r={r} fill={d.color} fillOpacity={0.9} stroke={SURFACE} strokeWidth={2} />
        {label && (
          <text x={label.x} y={label.y} dy={4} textAnchor={label.anchor} fontSize={10.5} fontFamily="var(--font-mono)" fill={TEXT_STRONG}>
            {label.text}
          </text>
        )}
      </g>
    );
  };

  // Room for what is printed: the widest value label of the x axis centred on
  // the right edge, and the longest point label to the right of its dot.
  const axisLabels = (vals: number[], m: WidgetMetric) => (vals.length === 0 ? [] : axisProbe(Math.min(...vals), Math.max(...vals)).map((v) => formatAxisValue(v, m.format, result.currency)));
  const xTickLabels = axisLabels(points.map((p) => p.x), xm);
  const yTickLabels = axisLabels(points.map((p) => p.y), ym);
  const longestLabel = Math.max(0, ...points.map((p) => textWidth(`${truncateLabel(p.label, LABEL_MAX)}${p.caveat ? "^" : ""}`)));
  const rightMargin = Math.max(edgeMargin(xTickLabels, 12), labelled ? longestLabel + 24 : 12);

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
            <ScatterChart margin={{ top: 12, right: rightMargin, bottom: 16, left: 12 }}>
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
                width={axisWidth(yTickLabels, 44)}
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
