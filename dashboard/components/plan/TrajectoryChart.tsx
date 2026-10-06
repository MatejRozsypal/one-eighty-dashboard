"use client";

/**
 * Target view chart, by month: the trajectory to the target state (constant
 * monthly growth from the starting run-rate to the goal), each month's own
 * plan target, the actual of closed months as bars, and the projected end of
 * the month in flight as a hatched bar.
 */

import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, TooltipCard, TooltipRow, useHatch } from "@/components/reports/widgets/ChartFrame";
import { AXIS_TICK, BAR_RADIUS, GRID_STROKE, MUTED_FILL, TEXT_MUTED, TEXT_STRONG, axisWidth, edgeMargin, seriesColor } from "@/components/reports/widgets/chartTheme";
import { formatMoney } from "@/lib/format";
import type { TrajectoryPoint } from "@/lib/plan/model";

const ACTUAL = seriesColor(0);

interface Row extends TrajectoryPoint {
  bar: number | null;
}

export function TrajectoryChart({ points, goal, currency }: { points: TrajectoryPoint[]; goal: number | null; currency: string }) {
  const { id: hatchId, defs } = useHatch();
  const rows: Row[] = points.map((p) => ({ ...p, bar: p.actual ?? p.projected }));
  const fmt = (v: number | null | undefined) => formatMoney(v, currency);
  const fmtAxis = (v: number) => formatMoney(v, currency, { compact: true });
  const top = Math.max(goal ?? 0, ...rows.map((r) => Math.max(r.bar ?? 0, r.trajectory ?? 0, r.plan ?? 0)));
  const yWidth = axisWidth([fmtAxis(top), fmtAxis(0)]);
  const rightMargin = edgeMargin([rows[rows.length - 1]?.label ?? ""], 8);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-content-body">
        <span className="inline-flex items-center gap-[7px]">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ background: ACTUAL }} />
          Actual
        </span>
        <span className="inline-flex items-center gap-[7px]">
          <span aria-hidden="true" className="h-[2px] w-4" style={{ background: TEXT_STRONG }} />
          Trajectory
        </span>
        <span className="inline-flex items-center gap-[7px]">
          <span aria-hidden="true" className="h-[2px] w-4" style={{ background: TEXT_MUTED }} />
          Month plan
        </span>
      </div>
      <div className="h-[240px] w-full sm:h-[300px]" role="img" aria-label="Monthly revenue against the trajectory to the target state">
        <ChartFrame>
          <ComposedChart data={rows} margin={{ top: 8, right: rightMargin, bottom: 0, left: 4 }} barCategoryGap="28%">
            {defs}
            <CartesianGrid stroke={GRID_STROKE} vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={20} tick={AXIS_TICK} />
            <YAxis tickLine={false} axisLine={false} width={yWidth} domain={[0, "auto"]} tickFormatter={fmtAxis} tick={AXIS_TICK} />
            <Tooltip cursor={{ fill: MUTED_FILL, opacity: 0.6 }} content={<TrajectoryTooltip fmt={fmt} />} />
            {goal !== null && <ReferenceLine y={goal} stroke={TEXT_MUTED} strokeDasharray="2 4" />}
            <Bar dataKey="bar" radius={[BAR_RADIUS, BAR_RADIUS, 0, 0]} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.month} fill={r.actual === null ? `url(#${hatchId})` : ACTUAL} fillOpacity={r.actual === null ? 1 : 0.85} />
              ))}
            </Bar>
            <Line dataKey="plan" type="step" stroke={TEXT_MUTED} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="trajectory" type="monotone" stroke={TEXT_STRONG} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ChartFrame>
      </div>
    </div>
  );
}

interface TipProps {
  active?: boolean;
  payload?: Array<{ payload: Row }>;
  fmt: (v: number | null | undefined) => string;
}

function TrajectoryTooltip({ active, payload, fmt }: TipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <TooltipCard title={p.label}>
      {p.actual !== null && <TooltipRow color={ACTUAL} name="Actual" value={fmt(p.actual)} />}
      {p.projected !== null && <TooltipRow color={ACTUAL} name="Projected" value={fmt(p.projected)} />}
      <TooltipRow color={TEXT_STRONG} name="Trajectory" value={fmt(p.trajectory)} muted={p.trajectory === null} />
      <TooltipRow color={TEXT_MUTED} name="Month plan" value={fmt(p.plan)} muted={p.plan === null} />
    </TooltipCard>
  );
}
