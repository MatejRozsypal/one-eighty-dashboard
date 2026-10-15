"use client";

/**
 * What changed: GP after ads against the compare period. First the change by
 * market (Unallocated spend is its own bar), then, for the picked market, the
 * change split into five drivers in a fixed order: orders, AOV, discount
 * rate, COGS %, ad spend, and their sum. Gains are green, losses red; the two
 * levels are printed above the chart rather than drawn, so a small driver is
 * not dwarfed by the size of the whole.
 */

import { useId, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartSummary } from "@/components/ui/ChartSummary";
import { InfoTip } from "@/components/ui/InfoTip";
import { SegmentPills } from "@/components/controls/SegmentedControl";
import { formatMoney, NO_VALUE } from "@/lib/format";
import type { MarketChange } from "@/lib/markets/analysis";
import { AXIS_TICK, TooltipBox, TooltipRow, marketLabel } from "@/components/markets/trends/bits";

const POS = "var(--positive)";
const NEG = "var(--negative)";

export const BRIDGE_ORDER_NOTE =
  "Sequential decomposition of GP after ads = orders x AOV before discounts x (1 - discount rate) x (1 - COGS %) - ad spend. Drivers move from the compare period to this period one at a time in this order: orders, AOV, discount rate, COGS %, ad spend; each step holds the earlier drivers at this period and the later ones at the compare period, so the steps add up to the change exactly. Discount rate here includes refunds (net sales / gross sales).";

export function BridgeView({
  changes,
  currency,
  compareLabel,
}: {
  changes: MarketChange[];
  currency: string;
  compareLabel: string;
}) {
  const byMarketId = useId();
  const walkId = useId();
  const withWalk = changes.filter((c) => c.decomposition);
  const [picked, setPicked] = useState<string>(withWalk[0]?.market ?? "");
  const sel = withWalk.find((c) => c.market === picked) ?? withWalk[0];

  const known = changes.filter((c) => c.change !== null);
  const total = known.length === changes.length ? known.reduce((t, c) => t + (c.change as number), 0) : null;
  const bars = [
    ...known.map((c) => ({ name: marketLabel(c.market), value: c.change as number, kind: "change" as const })),
    ...(total !== null && known.length > 1 ? [{ name: "Total", value: total, kind: "total" as const }] : []),
  ];
  const fmt = (v: number) => formatMoney(v, currency);
  const missing = changes.filter((c) => c.change === null);

  // Driver effects from zero, then their sum: the levels themselves are printed, not drawn, so
  // a small driver is never dwarfed by the size of the whole.
  const walk = sel?.decomposition
    ? [
        ...sel.decomposition.steps.map((st) => ({ name: st.label, value: st.value, kind: "step" as const, note: st.note })),
        { name: "Change", value: sel.decomposition.after - sel.decomposition.before, kind: "total" as const, note: undefined },
      ]
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-content-strong">
          Change in GP after ads by market
          <span className="font-normal text-content-muted">{compareLabel}</span>
        </div>
        {bars.length > 0 ? (
          <div className="w-full" style={{ height: 40 + bars.length * 34 }} role="img" aria-label="Change in GP after ads by market" aria-describedby={byMarketId}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={(v: number) => formatMoney(v, currency, { compact: true })} />
                <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={84} tick={{ ...AXIS_TICK, fill: "var(--text-body)" }} />
                <ReferenceLine x={0} stroke="var(--gray-400)" />
                <Tooltip cursor={{ fill: "var(--gray-100)", opacity: 0.6 }} content={<ValueTooltip currency={currency} />} />
                <Bar dataKey="value" isAnimationActive={false} radius={[3, 3, 3, 3]} barSize={18}>
                  {bars.map((b, i) => (
                    <Cell key={i} fill={b.value >= 0 ? POS : NEG} fillOpacity={b.kind === "total" ? 1 : 0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        <ChartSummary id={byMarketId} categories labels={bars.map((b) => b.name)} series={[{ name: "Change in GP after ads", values: bars.map((b) => b.value) }]} format={fmt} />
        {missing.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px] text-content-muted">
            {missing.map((c) => (
              <li key={c.market} className="inline-flex items-center gap-1.5">
                <span className="font-mono text-content-body">{marketLabel(c.market)}</span> {NO_VALUE}
                <InfoTip text={c.why ?? "No value"} label={`Why ${marketLabel(c.market)} is n/a`} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {sel && walk && (
        <div className="flex flex-col gap-2 border-t border-hairline pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-content-strong">
              What drove {marketLabel(sel.market)}
              <InfoTip text={BRIDGE_ORDER_NOTE} label="How the drivers are split" />
            </div>
            {withWalk.length > 1 && (
              <SegmentPills
                segments={withWalk.map((c) => ({ value: c.market, label: marketLabel(c.market) }))}
                shown={sel.market}
                onSelect={setPicked}
                ariaLabel="Market"
              />
            )}
          </div>
          <p className="m-0 text-[12.5px] text-content-muted">
            GP after ads <span className="tabular text-content-strong">{fmt(sel.decomposition!.before)}</span> in the compare period,{" "}
            <span className="tabular text-content-strong">{fmt(sel.decomposition!.after)}</span> now
          </p>
          <div className="h-[230px] w-full" role="img" aria-label={`Drivers of the change in GP after ads, ${marketLabel(sel.market)}`} aria-describedby={walkId}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={walk} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} tick={AXIS_TICK} />
                <YAxis tickLine={false} axisLine={false} width={68} tick={AXIS_TICK} tickFormatter={(v: number) => formatMoney(v, currency, { compact: true })} />
                <ReferenceLine y={0} stroke="var(--gray-400)" />
                <Tooltip cursor={{ fill: "var(--gray-100)", opacity: 0.6 }} content={<WalkTooltip currency={currency} />} />
                <Bar dataKey="value" isAnimationActive={false} radius={[3, 3, 3, 3]} maxBarSize={56}>
                  {walk.map((w, i) => (
                    <Cell key={i} fill={(w.value ?? 0) >= 0 ? POS : NEG} fillOpacity={w.kind === "total" ? 1 : 0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ChartSummary
            id={walkId}
            categories
            labels={walk.map((w) => w.name)}
            series={[{ name: `Drivers of the change in GP after ads, ${marketLabel(sel.market)}`, values: walk.map((w) => w.value) }]}
            format={fmt}
          />
          {walk.some((w) => w.note) && (
            <p className="m-0 text-[12px] text-content-muted">{walk.find((w) => w.note)?.note}.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ValueTooltip({ active, payload, currency }: { active?: boolean; payload?: Array<{ payload: { name: string; value: number } }>; currency: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <TooltipBox title={p.name}>
      <TooltipRow name="Change" value={formatMoney(p.value, currency)} />
    </TooltipBox>
  );
}

function WalkTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload: { name: string; value: number | null; kind: string; note?: string } }>;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <TooltipBox title={p.kind === "total" ? "Change in GP after ads" : p.name}>
      <TooltipRow name="Effect" value={p.value === null ? NO_VALUE : formatMoney(p.value, currency)} muted={p.value === null} />
      {p.value === null && p.note && <div className="max-w-[240px] whitespace-normal font-sans text-[11px] text-content-muted">{p.note}</div>}
    </TooltipBox>
  );
}
