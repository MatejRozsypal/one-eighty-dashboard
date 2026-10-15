"use client";

/**
 * Weekly small multiples: one row per metric, one line per market in the
 * page's market colours. The compare period is the same colour, thin and
 * dotted (week 1 against week 1). A week the range or the data cuts short is
 * a hollow point and says "partial" in the tooltip; a week with no value is a
 * gap, never a zero.
 */

import { useId } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartSummary } from "@/components/ui/ChartSummary";
import { NO_VALUE } from "@/lib/format";
import type { TrendPoint, TrendSeries } from "@/lib/markets/analysis";
import { AXIS_TICK, MarketKey, TooltipBox, TooltipRow, formatKind, marketLabel } from "@/components/markets/trends/bits";

export function TrendCharts({
  series,
  markets,
  colors,
  currency,
  comparing,
}: {
  series: TrendSeries[];
  markets: string[];
  colors: Record<string, string>;
  currency: string;
  comparing: boolean;
}) {
  const anyPartial = series[0]?.points.some((p) => p.partial) ?? false;
  return (
    <div className="flex flex-col gap-4">
      <MarketKey
        markets={markets}
        colors={colors}
        extra={
          <>
            {comparing && (
              <span className="inline-flex items-center gap-1.5">
                <svg aria-hidden="true" width="18" height="6"><line x1="0" x2="18" y1="3" y2="3" style={{ stroke: "var(--gray-400)", strokeWidth: 1.5, strokeDasharray: "2 3" }} /></svg>
                Compare period
              </span>
            )}
            {anyPartial && (
              <span className="inline-flex items-center gap-1.5">
                <svg aria-hidden="true" width="10" height="10"><circle cx="5" cy="5" r="3.5" style={{ fill: "var(--paper)", stroke: "var(--gray-400)", strokeWidth: 1.5 }} /></svg>
                Partial week
              </span>
            )}
          </>
        }
      />
      <div className="flex flex-col divide-y divide-hairline">
        {series.map((s) => (
          <TrendRow key={s.metric} s={s} markets={markets} colors={colors} currency={currency} comparing={comparing} />
        ))}
      </div>
    </div>
  );
}

function TrendRow({
  s,
  markets,
  colors,
  currency,
  comparing,
}: {
  s: TrendSeries;
  markets: string[];
  colors: Record<string, string>;
  currency: string;
  comparing: boolean;
}) {
  const summaryId = useId();
  const data = s.points.map((p) => {
    const row: Record<string, unknown> = { label: p.label, partial: p.partial, point: p };
    for (const m of markets) {
      row[m] = p.values[m];
      row[`cmp_${m}`] = p.compare[m];
    }
    return row;
  });
  const live = markets.filter((m) => s.points.some((p) => p.values[m] !== null) || (comparing && s.points.some((p) => p.compare[m] !== null)));
  const fmt = (v: number) => formatKind(v, s.kind, currency);
  const dots = s.points.length <= 16;

  return (
    <div className="grid gap-2 py-3 first:pt-0 last:pb-0 md:grid-cols-[132px_minmax(0,1fr)] md:items-center">
      <div className="flex flex-col">
        <span className="text-[13px] font-medium text-content-strong">{s.label}</span>
        {live.length === 0 && <span className="text-[11.5px] text-content-muted">{NO_VALUE} in every week</span>}
      </div>
      <div className="h-[140px] w-full" role="img" aria-label={`${s.label} by week and market`} aria-describedby={summaryId}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} tick={AXIS_TICK} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={68}
              tick={AXIS_TICK}
              domain={s.kind === "money" ? ["auto", "auto"] : [0, "auto"]}
              tickFormatter={(v: number) => formatKind(v, s.kind, currency, true)}
            />
            <Tooltip cursor={{ stroke: "var(--gray-300)" }} content={<TrendTooltip s={s} markets={live} colors={colors} currency={currency} comparing={comparing} />} />
            {comparing &&
              live.map((m) => (
                <Line
                  key={`cmp_${m}`}
                  type="linear"
                  dataKey={`cmp_${m}`}
                  stroke={colors[m]}
                  strokeWidth={1.5}
                  strokeDasharray="2 4"
                  strokeOpacity={0.55}
                  dot={false}
                  activeDot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            {live.map((m) => (
              <Line
                key={m}
                type="linear"
                dataKey={m}
                stroke={colors[m]}
                strokeWidth={2}
                connectNulls={false}
                isAnimationActive={false}
                dot={(props: unknown) => {
                  const { cx, cy, payload, index } = props as { cx?: number; cy?: number; payload: { partial: boolean }; index: number };
                  if (cx === undefined || cy === undefined || cy === null || Number.isNaN(cy)) return <g key={`${m}-${index}`} />;
                  if (payload.partial) {
                    return <circle key={`${m}-${index}`} cx={cx} cy={cy} r={3.5} style={{ fill: "var(--paper)", stroke: colors[m], strokeWidth: 1.5 }} />;
                  }
                  return dots ? <circle key={`${m}-${index}`} cx={cx} cy={cy} r={2.5} style={{ fill: colors[m] }} /> : <g key={`${m}-${index}`} />;
                }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ChartSummary
        id={summaryId}
        labels={s.points.map((p) => `week of ${p.label}${p.partial ? ", partial" : ""}`)}
        series={live.flatMap((m) => [
          { name: marketLabel(m), values: s.points.map((p) => p.values[m]) },
          ...(comparing ? [{ name: `${marketLabel(m)}, compare period`, values: s.points.map((p) => p.compare[m]) }] : []),
        ])}
        format={fmt}
      />
    </div>
  );
}

function TrendTooltip({
  active,
  payload,
  s,
  markets,
  colors,
  currency,
  comparing,
}: {
  active?: boolean;
  payload?: Array<{ payload: { point: TrendPoint } }>;
  s: TrendSeries;
  markets: string[];
  colors: Record<string, string>;
  currency: string;
  comparing: boolean;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload.point;
  return (
    <TooltipBox title={`${s.label}, week of ${p.label}${p.partial ? " (partial)" : ""}`}>
      {markets.map((m) => (
        <div key={m}>
          <TooltipRow name={marketLabel(m)} color={colors[m]} value={p.values[m] === null ? NO_VALUE : formatKind(p.values[m], s.kind, currency)} muted={p.values[m] === null} />
          {comparing && <TooltipRow name="  compare" value={formatKind(p.compare[m], s.kind, currency)} muted />}
          {p.values[m] === null && p.reasons[m] && <div className="mb-1 max-w-[240px] whitespace-normal font-sans text-[11px] text-content-muted">{p.reasons[m]}</div>}
        </div>
      ))}
    </TooltipBox>
  );
}
