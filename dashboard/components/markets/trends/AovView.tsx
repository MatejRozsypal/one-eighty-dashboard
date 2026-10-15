"use client";

/**
 * Order value vs free shipping: orders per value bin (net sales, ex VAT, ex
 * shipping), split into orders that shipped free and orders that paid, with
 * the inferred threshold marked. "Inferred" because no platform hands the
 * rule over: it is read from where zero-shipping orders take over.
 */

import { useId, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartSummary } from "@/components/ui/ChartSummary";
import { InfoTip } from "@/components/ui/InfoTip";
import { SegmentPills } from "@/components/controls/SegmentedControl";
import { formatMoney, formatNumber, formatPercent, NO_VALUE } from "@/lib/format";
import { thresholdTakeaway, THRESHOLD_SHARE, type Histogram, type HistogramBar } from "@/lib/markets/analysis";
import { AXIS_TICK, TooltipBox, TooltipRow, marketLabel } from "@/components/markets/trends/bits";

export function AovView({ histograms, currency }: { histograms: Histogram[]; currency: string }) {
  const summaryId = useId();
  const [picked, setPicked] = useState(histograms[0]?.market ?? "");
  const h = histograms.find((x) => x.market === picked) ?? histograms[0];
  if (!h) return null;
  const compact = (v: number) => formatMoney(v, currency, { compact: true });
  const binLabel = (b: HistogramBar) => (b.open ? `${compact(b.lo)}+` : compact(b.lo));
  const data = h.bars.map((b) => ({ ...b, label: binLabel(b) }));
  const t = h.threshold;
  const tBar = "value" in t ? h.bars.find((b) => t.value >= b.lo && t.value < b.hi) ?? h.bars[0] : null;
  const tLabel = tBar ? binLabel(tBar) : null;
  // The line sits on the bar's left edge when the threshold is that edge, as the inferred one usually is.
  const tAtEdge = tBar !== null && "value" in t && Math.abs(t.value - tBar.lo) < 1e-6;
  const takeaway = thresholdTakeaway(h, currency);

  return (
    <div className="flex flex-col gap-4">
      {histograms.length > 1 && (
        <div className="flex">
          <SegmentPills segments={histograms.map((x) => ({ value: x.market, label: marketLabel(x.market) }))} shown={h.market} onSelect={setPicked} ariaLabel="Market" />
        </div>
      )}
      {takeaway && <p className="m-0 text-[13px] text-content-strong">{takeaway}</p>}
      <dl className="m-0 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-[11.5px] text-content-muted">Orders</dt>
          <dd className="m-0 tabular text-content-strong">{formatNumber(h.orders)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-[11.5px] text-content-muted">Shipped free</dt>
          <dd className="m-0 tabular text-content-strong">{formatPercent(h.zeroShipShare)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="flex items-center gap-1 text-[11.5px] text-content-muted">
            Free-shipping threshold, inferred
            <InfoTip
              text={`The lowest order value from which at least ${Math.round(THRESHOLD_SHARE * 100)} % of orders, overall and just above it, shipped free. Read from the orders, not from the shop's settings, to the nearest ${formatMoney(h.width / 5, currency)}; ex VAT and ex shipping, so a threshold the shop states with VAT reads lower here.`}
              label="How the threshold is inferred"
            />
          </dt>
          <dd className="m-0 tabular text-content-strong">
            {"value" in t ? (
              <>about {formatMoney(t.value, currency)}</>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-content-muted">
                {NO_VALUE}
                <InfoTip text={t.none} label="Why there is no threshold" />
              </span>
            )}
          </dd>
        </div>
      </dl>
      <div className="h-[240px] w-full" role="img" aria-label={`Orders by value, ${marketLabel(h.market)}, free and paid shipping`} aria-describedby={summaryId}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 14, right: 8, bottom: 0, left: 0 }} barCategoryGap={1}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={18} tick={<EdgeTick />} />
            <YAxis tickLine={false} axisLine={false} width={40} tick={AXIS_TICK} allowDecimals={false} />
            <Tooltip cursor={{ fill: "var(--gray-100)", opacity: 0.6 }} content={<BinTooltip currency={currency} />} />
            <Bar dataKey="paidShip" stackId="o" fill="var(--gray-300)" isAnimationActive={false} name="Paid shipping" />
            <Bar dataKey="zeroShip" stackId="o" fill="var(--series-1)" isAnimationActive={false} radius={[2, 2, 0, 0]} name="Shipped free" />
            {tLabel && (
              <ReferenceLine x={tLabel} position={tAtEdge ? "start" : "middle"} stroke="var(--ink-800)" strokeDasharray="4 3" label={{ value: "Threshold, inferred", position: "top", style: { ...AXIS_TICK, fill: "var(--text-strong)" } }} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartSummary
        id={summaryId}
        categories
        labels={data.map((d) => d.label)}
        series={[
          { name: "Orders that shipped free", values: data.map((d) => d.zeroShip) },
          { name: "Orders that paid shipping", values: data.map((d) => d.paidShip) },
        ]}
        format={(v) => formatNumber(v)}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-content-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--series-1)" }} />
          Shipped free
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] bg-gray-300" />
          Paid shipping
        </span>
        <span>Order value: net sales, ex VAT, ex shipping; each label marks the bar&apos;s lower edge; the last bar holds the top 1 %</span>
      </div>
    </div>
  );
}

function BinTooltip({ active, payload, currency }: { active?: boolean; payload?: Array<{ payload: HistogramBar }>; currency: string }) {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload;
  const title = b.open ? `${formatMoney(b.lo, currency)} and more` : `${formatMoney(b.lo, currency)} to ${formatMoney(b.hi, currency)}`;
  return (
    <TooltipBox title={title}>
      <TooltipRow name="Orders" value={formatNumber(b.orders)} />
      <TooltipRow name="Shipped free" value={b.orders > 0 ? formatPercent(b.zeroShip / b.orders) : NO_VALUE} />
    </TooltipBox>
  );
}

/** A bin's label at its bar's left edge, where its lower bound is, not under its middle. */
function EdgeTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string; offset?: number } }) {
  if (x === undefined || y === undefined || !payload) return null;
  return (
    <text x={x - (payload.offset ?? 0)} y={y} dy="0.71em" textAnchor="middle" style={AXIS_TICK}>
      {payload.value}
    </text>
  );
}
