"use client";

/**
 * Cumulative burn-up: actual to date against the cumulative curve target,
 * then the projection from as of to the period end inside its 80% band.
 * Promo windows sit behind the plot as shaded bands, labelled with their
 * phase code. A dotted line marks the period target.
 *
 * Every number arrives finished from the server (see `buildSeries`), so this
 * only draws. CM3 can run below zero early in a period (spend comes before
 * margin), so the axis then extends below zero. For aMER the lines are the
 * ratio to date, not a running total.
 */

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartFrame, TooltipCard, TooltipRow } from "@/components/reports/widgets/ChartFrame";
import { AXIS_TICK, GRID_STROKE, MUTED_FILL, TEXT_MUTED, axisWidth, edgeMargin, seriesColor } from "@/components/reports/widgets/chartTheme";
import { fmtValue, METRIC_LABEL } from "@/lib/plan/format";
import { fmtDay } from "@/lib/plan/dates";
import type { PromoBand, SeriesPoint } from "@/lib/plan/model";
import type { PlanMetric } from "@/lib/plan/types";

const ACTUAL = seriesColor(0);
const TARGET = TEXT_MUTED;

export function BurnUpChart({
  points,
  bands,
  asOf,
  metric,
  currency,
  target,
}: {
  points: SeriesPoint[];
  bands: PromoBand[];
  asOf: string | null;
  metric: PlanMetric;
  currency: string;
  target: number | null;
}) {
  const fmt = (v: number | null | undefined) => fmtValue(v, metric, currency);
  const fmtAxis = (v: number) => fmtValue(v, metric, currency, { compact: true });
  const top = Math.max(
    target ?? 0,
    ...points.map((p) => Math.max(p.cumTarget ?? 0, p.cumActual ?? 0, p.band?.[1] ?? 0, p.projection ?? 0))
  );
  const bottom = Math.min(
    0,
    ...points.map((p) => Math.min(p.cumTarget ?? 0, p.cumActual ?? 0, p.band?.[0] ?? 0, p.projection ?? 0))
  );
  const yWidth = axisWidth([fmtAxis(top), fmtAxis(bottom)]);
  const rightMargin = edgeMargin([fmtDay(points[points.length - 1]?.date ?? "")], 8);
  const showAsOf = asOf !== null && points.some((p) => p.date === asOf) && points[points.length - 1]?.date !== asOf;

  return (
    <div className="flex flex-col gap-3">
      <Legend />
      <div
        className="h-[240px] w-full sm:h-[300px]"
        role="img"
        aria-label={`Cumulative ${METRIC_LABEL[metric].toLowerCase()}: actual against the target curve, with the projected end`}
      >
        <ChartFrame>
          <ComposedChart data={points} margin={{ top: 18, right: rightMargin, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={GRID_STROKE} vertical={false} />
            {bands.map((b) => (
              <ReferenceArea
                key={`${b.taskId}-${b.start}`}
                x1={b.start}
                x2={b.end}
                fill={MUTED_FILL}
                fillOpacity={0.9}
                ifOverflow="extendDomain"
                label={{ value: b.code, position: "insideTop", fontSize: 11, fill: TEXT_MUTED, fontFamily: "var(--font-sans)" }}
              />
            ))}
            <XAxis
              dataKey="date"
              tickFormatter={fmtDay}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
              tick={AXIS_TICK}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={yWidth}
              domain={[bottom < 0 ? "auto" : 0, "auto"]}
              tickFormatter={fmtAxis}
              tick={AXIS_TICK}
            />
            <Tooltip
              cursor={{ stroke: GRID_STROKE }}
              content={<BurnUpTooltip fmt={fmt} />}
            />
            <Area
              dataKey="band"
              stroke="none"
              fill={ACTUAL}
              fillOpacity={0.12}
              isAnimationActive={false}
              connectNulls={false}
              activeDot={false}
            />
            {target !== null && (
              <ReferenceLine y={target} stroke={TARGET} strokeDasharray="2 4" strokeOpacity={0.8} />
            )}
            {showAsOf && <ReferenceLine x={asOf!} stroke={TARGET} strokeOpacity={0.5} />}
            <Line
              dataKey="cumTarget"
              type="monotone"
              stroke={TARGET}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="projection"
              type="monotone"
              stroke={ACTUAL}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="cumActual"
              type="monotone"
              stroke={ACTUAL}
              strokeWidth={2.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartFrame>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-content-body">
      <span className="inline-flex items-center gap-[7px]">
        <span aria-hidden="true" className="h-[3px] w-4 rounded-full" style={{ background: ACTUAL }} />
        Actual
      </span>
      <span className="inline-flex items-center gap-[7px]">
        <span aria-hidden="true" className="h-[2px] w-4 rounded-full" style={{ background: TARGET }} />
        Target curve
      </span>
      <span className="inline-flex items-center gap-[7px]">
        <span
          aria-hidden="true"
          className="h-[10px] w-4 rounded-[3px]"
          style={{ background: `color-mix(in srgb, ${ACTUAL} 14%, transparent)`, borderTop: `2px dashed ${ACTUAL}` }}
        />
        Projected
      </span>
      <span className="inline-flex items-center gap-[7px]">
        <span aria-hidden="true" className="h-[10px] w-4 rounded-[3px] bg-gray-100" />
        Promo
      </span>
    </div>
  );
}

interface TipProps {
  active?: boolean;
  payload?: Array<{ payload: SeriesPoint }>;
  fmt: (v: number | null | undefined) => string;
}

function BurnUpTooltip({ active, payload, fmt }: TipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <TooltipCard title={fmtDay(p.date)}>
      {p.cumActual !== null && <TooltipRow color={ACTUAL} name="Actual" value={fmt(p.cumActual)} />}
      <TooltipRow color={TARGET} name="Target" value={fmt(p.cumTarget)} muted={p.cumTarget === null} />
      {p.projection !== null && p.cumActual === null && <TooltipRow name="Projected" value={fmt(p.projection)} />}
      {p.band && p.cumActual === null && <TooltipRow name="Range" value={`${fmt(p.band[0])} to ${fmt(p.band[1])}`} />}
    </TooltipCard>
  );
}
