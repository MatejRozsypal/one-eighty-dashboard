"use client";

/**
 * Portfolio: one bubble per market. x = nCAC in the period, y = GP per
 * customer at 365 d from complete cohorts (hollow when it falls back to
 * first-order GP per new customer), size = net revenue. The two diagonals are
 * LTGP:CAC 3:1 and 1:1; above 3:1 a market pays back its acquisition three
 * times, below 1:1 it does not pay it back at all.
 */

import { useId } from "react";
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChartSummary } from "@/components/ui/ChartSummary";
import { InfoTip } from "@/components/ui/InfoTip";
import { EmptyNote } from "@/components/ui/PageNotes";
import { formatMoney, formatRatio } from "@/lib/format";
import { isPlottable, niceWidth, portfolioEmptyReason, portfolioTakeaway, type PortfolioPoint } from "@/lib/markets/analysis";
import { AXIS_TICK, TooltipBox, TooltipRow, marketLabel } from "@/components/markets/trends/bits";

type Dot = PortfolioPoint & { x: number; y: number; r: number; color: string };

/** A round axis top and its ticks (about four steps of 1, 2 or 5 x 10^k). */
function niceAxis(top: number): { max: number; ticks: number[] } {
  const step = niceWidth(top, 4);
  const max = Math.ceil(top / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max, ticks };
}

export function PortfolioChart({
  points,
  colors,
  currency,
}: {
  points: PortfolioPoint[];
  colors: Record<string, string>;
  currency: string;
}) {
  const summaryId = useId();
  const drawn = points.filter(isPlottable);
  const missing = points.filter((p) => !isPlottable(p));
  const empty = portfolioEmptyReason(points);
  const maxSize = Math.max(1, ...drawn.map((p) => p.size));
  const dots: Dot[] = drawn.map((p) => ({ ...p, r: 7 + 20 * Math.sqrt(Math.max(0, p.size) / maxSize), color: colors[p.market] ?? "var(--gray-400)" }));

  const xAxis = niceAxis(Math.max(1, ...dots.map((d) => d.x)) * 1.2);
  const xMax = xAxis.max;
  const yRaw = Math.max(1, ...dots.map((d) => d.y)) * 1.15;
  // Keep the 1:1 line in view, so a market under it never reads as fine.
  const yAxis = niceAxis(Math.max(yRaw, Math.min(xMax, yRaw * 1.6)));
  const yMax = yAxis.max;
  const yMinData = Math.min(0, ...dots.map((d) => d.y));
  const yMin = yMinData < 0 ? -niceAxis(-yMinData * 1.2).max : 0;
  const yTicks = yMin < 0 ? [yMin, ...yAxis.ticks] : yAxis.ticks;
  // Each diagonal ends where it leaves the plot, so its label sits inside.
  const end = (k: number) => (xMax * k <= yMax ? { x: xMax, y: xMax * k } : { x: yMax / k, y: yMax });
  const anyFallback = dots.some((d) => d.basis === "firstOrder");
  const fmt = (v: number) => formatMoney(v, currency, { unit: true });
  const takeaway = portfolioTakeaway(points, currency);

  const notDrawn = missing.length > 0 && (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px] text-content-muted">
      {missing.map((p) => (
        <li key={p.market} className="inline-flex items-center gap-1.5">
          <span className="font-mono text-content-body">{marketLabel(p.market)}</span> not drawn
          <InfoTip text={p.why ?? "No value"} label={`Why ${marketLabel(p.market)} is not drawn`} />
        </li>
      ))}
    </ul>
  );

  // Nothing to place: say why instead of drawing empty axes with the 3:1 and 1:1 lines.
  if (empty) {
    return (
      <div className="flex flex-col gap-3">
        <EmptyNote>{empty}</EmptyNote>
        {notDrawn}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {takeaway && <p className="m-0 text-[13px] text-content-strong">{takeaway}</p>}
      <span aria-hidden="true" className="-mb-2 font-mono text-[10.5px] text-content-muted">GP per customer</span>
      <div
        className="relative h-[300px] w-full sm:h-[340px]"
        role="img"
        aria-label="Markets by nCAC and GP per customer, bubble size is net revenue"
        aria-describedby={summaryId}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 16, bottom: 18, left: 4 }}>
            <CartesianGrid stroke="var(--border)" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, xMax]}
              ticks={xAxis.ticks}
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              tickFormatter={(v: number) => formatMoney(v, currency, { compact: true })}
              label={{ value: "nCAC", position: "insideBottomRight", offset: -8, style: { ...AXIS_TICK } }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[yMin, yMax]}
              ticks={yTicks}
              tickLine={false}
              axisLine={false}
              width={66}
              tick={AXIS_TICK}
              tickFormatter={(v: number) => formatMoney(v, currency, { compact: true })}
            />
            <ReferenceLine
              segment={[{ x: 0, y: 0 }, end(3)]}
              ifOverflow="hidden"
              stroke="var(--growth-500)"
              strokeDasharray="5 4"
              label={{ value: "3:1", position: "insideTopRight", style: { ...AXIS_TICK, fill: "var(--growth-700)" } }}
            />
            <ReferenceLine
              segment={[{ x: 0, y: 0 }, end(1)]}
              ifOverflow="hidden"
              stroke="var(--negative)"
              strokeDasharray="5 4"
              strokeOpacity={0.6}
              label={{ value: "1:1", position: "insideTopRight", style: { ...AXIS_TICK, fill: "var(--negative-text)" } }}
            />
            <Tooltip cursor={false} content={<PortfolioTooltip currency={currency} />} />
            <Scatter
              data={dots}
              isAnimationActive={false}
              shape={(props: unknown) => {
                const { cx, cy, payload } = props as { cx: number; cy: number; payload: Dot };
                const hollow = payload.basis === "firstOrder";
                return (
                  <g>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={payload.r}
                      style={{
                        fill: hollow ? "var(--paper)" : payload.color,
                        fillOpacity: hollow ? 0.6 : 0.78,
                        stroke: payload.color,
                        strokeWidth: hollow ? 2 : 1.5,
                        strokeDasharray: hollow ? "3 2" : undefined,
                      }}
                    />
                    <text x={cx + payload.r + 4} y={cy + 4} className="font-mono text-[11px]" style={{ fill: "var(--text-strong)" }}>
                      {marketLabel(payload.market)}
                    </text>
                  </g>
                );
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
        <span className="pointer-events-none absolute left-[78px] top-3 hidden font-mono sm:block text-[10px] uppercase tracking-[0.08em] text-content-muted">
          Pays back 3× or more
        </span>
        <span className="pointer-events-none absolute bottom-12 right-5 hidden font-mono sm:block text-[10px] uppercase tracking-[0.08em] text-content-muted">
          Does not pay back
        </span>
      </div>
      <ChartSummary
        id={summaryId}
        categories
        labels={dots.map((d) => marketLabel(d.market))}
        series={[
          { name: "nCAC", values: dots.map((d) => d.x) },
          { name: "GP per customer", values: dots.map((d) => d.y) },
        ]}
        format={fmt}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-content-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-gray-400" />
          GP per customer at 365 d, complete cohorts
        </span>
        {anyFallback && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border-[1.5px] border-dashed border-gray-400" />
            First-order GP per new customer (no 365 d cohorts)
          </span>
        )}
        <span>Bubble size: net revenue</span>
      </div>
      {notDrawn}
    </div>
  );
}

function PortfolioTooltip({ active, payload, currency }: { active?: boolean; payload?: Array<{ payload: Dot }>; currency: string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <TooltipBox title={marketLabel(d.market)}>
      <TooltipRow name="nCAC" value={formatMoney(d.x, currency, { unit: true })} />
      <TooltipRow name={d.basis === "ltgp365" ? "GP / customer 365 d" : "First-order GP / new"} value={formatMoney(d.y, currency, { unit: true })} />
      <TooltipRow name={d.basis === "ltgp365" ? "LTGP:CAC" : "First-order GP:CAC"} value={formatRatio(d.ratio)} />
      <TooltipRow name="Net revenue" value={formatMoney(d.size, currency)} />
    </TooltipBox>
  );
}
