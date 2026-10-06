"use client";

/**
 * Daily bars against the daily target.
 *
 * Bars are the actual of each closed day, hatched while preliminary. The step
 * line is the curve target of the day. The two thin lines are the trailing
 * 7-day means of actual and target, on the bar scale: they carry the trend,
 * a single day is noise at this volume. Bars carry no status colour.
 */

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartFrame, TooltipCard, TooltipRow, useHatch } from "@/components/reports/widgets/ChartFrame";
import { AXIS_TICK, BAR_RADIUS, GRID_STROKE, MUTED_FILL, TEXT_MUTED, TEXT_STRONG, axisWidth, edgeMargin, seriesColor } from "@/components/reports/widgets/chartTheme";
import { fmtValue, METRIC_LABEL } from "@/lib/plan/format";
import { fmtDay } from "@/lib/plan/dates";
import type { PromoBand, SeriesPoint } from "@/lib/plan/model";
import type { PlanMetric } from "@/lib/plan/types";

const ACTUAL = seriesColor(0);

export function DailyChart({
  points,
  bands,
  metric,
  currency,
}: {
  points: SeriesPoint[];
  bands: PromoBand[];
  metric: PlanMetric;
  currency: string;
}) {
  const { id: hatchId, defs } = useHatch();
  const fmt = (v: number | null | undefined) => fmtValue(v, metric, currency);
  const fmtAxis = (v: number) => fmtValue(v, metric, currency, { compact: true });
  const top = Math.max(0, ...points.map((p) => Math.max(p.actual ?? 0, p.target ?? 0)));
  const yWidth = axisWidth([fmtAxis(top), fmtAxis(0)]);
  const rightMargin = edgeMargin([fmtDay(points[points.length - 1]?.date ?? "")], 8);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-content-body">
        <span className="inline-flex items-center gap-[7px]">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ background: ACTUAL }} />
          Actual
        </span>
        <span className="inline-flex items-center gap-[7px]">
          <span aria-hidden="true" className="h-[2px] w-4" style={{ background: TEXT_MUTED }} />
          Daily target
        </span>
        <span className="inline-flex items-center gap-[7px]">
          <span aria-hidden="true" className="h-[2px] w-4" style={{ background: TEXT_STRONG }} />
          7-day avg
        </span>
        <span className="inline-flex items-center gap-[7px]">
          <span aria-hidden="true" className="h-0 w-4 border-t-2 border-dotted" style={{ borderColor: TEXT_STRONG }} />
          7-day avg target
        </span>
      </div>
      <div
        className="h-[200px] w-full sm:h-[240px]"
        role="img"
        aria-label={`Daily ${METRIC_LABEL[metric].toLowerCase()} against the daily target`}
      >
        <ChartFrame>
          <ComposedChart data={points} margin={{ top: 8, right: rightMargin, bottom: 0, left: 4 }} barCategoryGap="18%">
            {defs}
            <CartesianGrid stroke={GRID_STROKE} vertical={false} />
            {bands.map((b) => (
              <ReferenceArea key={`${b.taskId}-${b.start}`} x1={b.start} x2={b.end} fill={MUTED_FILL} fillOpacity={0.9} />
            ))}
            <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={28} tick={AXIS_TICK} />
            <YAxis tickLine={false} axisLine={false} width={yWidth} domain={[0, "auto"]} tickFormatter={fmtAxis} tick={AXIS_TICK} />
            <Tooltip cursor={{ fill: MUTED_FILL, opacity: 0.6 }} content={<DailyTooltip fmt={fmt} />} />
            <Bar dataKey="actual" radius={[BAR_RADIUS, BAR_RADIUS, 0, 0]} isAnimationActive={false}>
              {points.map((p) => (
                <Cell key={p.date} fill={p.preliminary ? `url(#${hatchId})` : ACTUAL} fillOpacity={p.preliminary ? 1 : 0.85} />
              ))}
            </Bar>
            <Line dataKey="target" type="step" stroke={TEXT_MUTED} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="avgActual" type="monotone" stroke={TEXT_STRONG} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
            <Line
              dataKey="avgTarget"
              type="monotone"
              stroke={TEXT_STRONG}
              strokeWidth={1.5}
              strokeDasharray="2 3"
              strokeOpacity={0.7}
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

interface TipProps {
  active?: boolean;
  payload?: Array<{ payload: SeriesPoint }>;
  fmt: (v: number | null | undefined) => string;
}

function DailyTooltip({ active, payload, fmt }: TipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <TooltipCard title={p.preliminary ? `${fmtDay(p.date)}, preliminary` : fmtDay(p.date)}>
      <TooltipRow color={ACTUAL} name="Actual" value={fmt(p.actual)} muted={p.actual === null} />
      <TooltipRow color={TEXT_MUTED} name="Target" value={fmt(p.target)} muted={p.target === null} />
      {p.avgActual !== null && <TooltipRow name="7-day avg" value={fmt(p.avgActual)} />}
      {p.avgTarget !== null && <TooltipRow name="7-day avg target" value={fmt(p.avgTarget)} />}
    </TooltipCard>
  );
}
