"use client";

/**
 * Spend and efficiency: stacked Meta and Google spend as bars, one efficiency
 * metric as a line, the same metric over the comparison period as a dotted line.
 *
 * The server hands over finished points (every ratio already taken from its
 * bucket's own sums), so nothing here averages anything. The metric switch is
 * local state: all three series arrive together, so flipping it costs no query.
 *
 * A bucket with no value for the chosen metric is a gap in the line, not a zero.
 * Below 400px wide the comparison line is dropped (the tiles still carry the
 * delta).
 */

import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney, formatRatio } from "@/lib/format";
import type { ChartPoint } from "@/components/paid/overview/model";

type MetricKey = "amer" | "mer" | "ncac";

const METRICS: Array<{ key: MetricKey; label: string; compare: keyof ChartPoint; money: boolean }> = [
  { key: "amer", label: "aMER", compare: "cAmer", money: false },
  { key: "mer", label: "MER", compare: "cMer", money: false },
  { key: "ncac", label: "nCAC", compare: "cNcac", money: true },
];

export function SpendEfficiencyChart({
  points,
  currency,
  showMeta,
  showGoogle,
  comparing,
}: {
  points: ChartPoint[];
  currency: string;
  showMeta: boolean;
  showGoogle: boolean;
  comparing: boolean;
}) {
  const [metric, setMetric] = useState<MetricKey>("amer");
  const def = METRICS.find((m) => m.key === metric) ?? METRICS[0];

  const fmtMetric = (v: number | null | undefined) =>
    def.money ? formatMoney(v, currency, { unit: true }) : formatRatio(v);
  const fmtMoney = (v: number | null | undefined) => formatMoney(v, currency);

  const hasLine = points.some((p) => p[metric] !== null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          {showMeta && (
            <span className="inline-flex items-center gap-[7px] font-mono text-[11px] text-content-body">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] bg-platform-meta" />
              Meta
            </span>
          )}
          {showGoogle && (
            <span className="inline-flex items-center gap-[7px] font-mono text-[11px] text-content-body">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] bg-platform-google" />
              Google
            </span>
          )}
        </div>

        <div role="group" aria-label="Efficiency metric" className="flex gap-0.5 rounded-pill bg-gray-100 p-[3px]">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={m.key === metric}
              onClick={() => setMetric(m.key)}
              className={`whitespace-nowrap rounded-pill px-2.5 py-1.5 font-mono text-[11px] transition-colors duration-fast ${
                m.key === metric
                  ? "bg-paper text-content-strong shadow-sm"
                  : "text-content-muted hover:text-content-body"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="h-[180px] w-full sm:h-[260px] [&_.cmp-line]:max-[400px]:hidden"
        role="img"
        aria-label={`Spend by platform with ${def.label} over time`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              minTickGap={28}
              tick={{ fontSize: 10.5, fill: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
            />
            <YAxis
              yAxisId="spend"
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v: number) => formatMoney(v, currency, { compact: true })}
              tick={{ fontSize: 10.5, fill: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
            />
            <YAxis
              yAxisId="metric"
              orientation="right"
              tickLine={false}
              axisLine={false}
              width={48}
              domain={[0, "auto"]}
              tickFormatter={(v: number) => (def.money ? formatMoney(v, currency, { compact: true }) : formatRatio(v, { decimals: 1 }))}
              tick={{ fontSize: 10.5, fill: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
            />
            <Tooltip
              cursor={{ fill: "var(--gray-100)", opacity: 0.6 }}
              content={<ChartTooltip fmtMoney={fmtMoney} fmtMetric={fmtMetric} label={def.label} metric={metric} compare={def.compare} comparing={comparing} showMeta={showMeta} showGoogle={showGoogle} />}
            />
            {showMeta && (
              <Bar yAxisId="spend" dataKey="meta" stackId="spend" fill="var(--meta)" fillOpacity={0.85} isAnimationActive={false} />
            )}
            {showGoogle && (
              <Bar yAxisId="spend" dataKey="google" stackId="spend" fill="var(--google)" fillOpacity={0.85} isAnimationActive={false} />
            )}
            {hasLine && (
              <Line
                yAxisId="metric"
                type="monotone"
                dataKey={metric}
                stroke="var(--ink-900)"
                strokeWidth={2}
                dot={points.length <= 14}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            {comparing && hasLine && (
              <Line
                yAxisId="metric"
                className="cmp-line"
                type="monotone"
                dataKey={def.compare}
                stroke="var(--ink-900)"
                strokeWidth={1.5}
                strokeDasharray="2 4"
                strokeOpacity={0.6}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  fmtMoney: (v: number | null | undefined) => string;
  fmtMetric: (v: number | null | undefined) => string;
  label: string;
  metric: MetricKey;
  compare: keyof ChartPoint;
  comparing: boolean;
  showMeta: boolean;
  showGoogle: boolean;
}

function ChartTooltip({ active, payload, fmtMoney, fmtMetric, label, metric, compare, comparing, showMeta, showGoogle }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  const row = (name: string, value: string) => (
    <div className="flex items-center justify-between gap-6">
      <span className="text-content-muted">{name}</span>
      <span className="tabular text-content-strong">{value}</span>
    </div>
  );
  return (
    <div className="min-w-[170px] rounded-md border border-hairline bg-surface-card p-[10px_12px] font-mono text-[11.5px] shadow-lg">
      <div className="mb-1.5 text-content-strong">{p.label}</div>
      {showMeta && row("Meta", fmtMoney(p.meta))}
      {showGoogle && row("Google", fmtMoney(p.google))}
      {row(label, fmtMetric(p[metric] as number | null))}
      {comparing && row(`${label} before`, fmtMetric(p[compare] as number | null))}
    </div>
  );
}
