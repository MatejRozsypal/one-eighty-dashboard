"use client";

/**
 * Spend vs new customers: a week per point, the fitted diminishing-returns
 * curve (new customers = a + b ln(spend)), the marginal nCAC at the current
 * weekly spend, and a calculator that moves weekly spend from one market to
 * another and reads the change off the two fits. Every figure from the fit is
 * labelled an estimate; the fit is hidden below 8 weeks, with the reason.
 */

import { useId, useMemo, useState, type ReactNode } from "react";
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChartSummary } from "@/components/ui/ChartSummary";
import { InfoTip } from "@/components/ui/InfoTip";
import { SegmentPills } from "@/components/controls/SegmentedControl";
import { formatMoney, formatNumber, NO_VALUE } from "@/lib/format";
import { niceWidth, predict, reallocate, reallocationTakeaway, responseTakeaway, MIN_FIT_WEEKS, WEAK_FIT_R2, type MarketResponse, type ResponsePoint } from "@/lib/markets/analysis";
import { AXIS_TICK, TooltipBox, TooltipRow, marketLabel } from "@/components/markets/trends/bits";

export interface ResponseMarket extends MarketResponse {
  /** First-order GP per new customer in the period; null with `gpWhy`. */
  gpPerNew: number | null;
  gpWhy: string | null;
  /** Average nCAC over the fit weeks, for the marginal comparison. */
  avgNcac: number | null;
}

function signed(v: number, f: (x: number) => string): string {
  return v > 0 ? `+${f(v)}` : f(v);
}

export function ResponseView({
  markets,
  colors,
  currency,
  windowText,
}: {
  markets: ResponseMarket[];
  colors: Record<string, string>;
  currency: string;
  windowText: string;
}) {
  const summaryId = useId();
  const [picked, setPicked] = useState(markets[0]?.market ?? "");
  const m = markets.find((x) => x.market === picked) ?? markets[0];
  const color = colors[m?.market ?? ""] ?? "var(--ink-700)";

  const curve = useMemo(() => {
    if (!m?.fit) return [];
    const lo = m.fit.minX * 0.85;
    const hi = m.fit.maxX * 1.15;
    return Array.from({ length: 40 }, (_, i) => {
      const x = lo + ((hi - lo) * i) / 39;
      return { spend: x, newCustomers: Math.max(0, predict(m.fit!, x)) };
    });
  }, [m]);

  if (!m) return null;
  // The spend axis starts near the lowest week, not at zero, so the cloud of
  // weeks and the bend of the curve fill the plot instead of its right half.
  const spends = m.points.map((p) => p.spend).filter((v) => v > 0);
  const xStep = spends.length ? niceWidth(Math.max(...spends) * 1.15 - Math.min(...spends) * 0.85, 4) : 1;
  const xFrom = spends.length ? Math.max(0, Math.floor((Math.min(...spends) * 0.85) / xStep) * xStep) : 0;
  const xTop = Math.max(xFrom + xStep, ...spends.map((v) => v * 1.15), m.currentSpend ?? 0);
  const xTo = Math.ceil(xTop / xStep) * xStep;
  const xTicks = Array.from({ length: Math.round((xTo - xFrom) / xStep) + 1 }, (_, i) => xFrom + i * xStep);
  const money = (v: number) => formatMoney(v, currency);
  const unitMoney = (v: number | null) => formatMoney(v, currency, { unit: true });
  const takeaway = responseTakeaway(m, currency);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {markets.length > 1 ? (
            <SegmentPills segments={markets.map((x) => ({ value: x.market, label: marketLabel(x.market) }))} shown={m.market} onSelect={setPicked} ariaLabel="Market" />
          ) : (
            <span />
          )}
          <span className="text-[12px] text-content-muted">Complete weeks, {windowText}</span>
        </div>
        {takeaway && <p className="m-0 text-[13px] text-content-strong">{takeaway}</p>}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <div className="h-[260px] w-full" role="img" aria-label={`Weekly spend against new customers, ${marketLabel(m.market)}`} aria-describedby={summaryId}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: 0 }}>
                <CartesianGrid stroke="var(--border)" />
                <XAxis
                  type="number"
                  dataKey="spend"
                  domain={[xFrom, xTo]}
                  ticks={xTicks}
                  tickLine={false}
                  axisLine={false}
                  tick={AXIS_TICK}
                  tickFormatter={(v: number) => formatMoney(v, currency, { compact: true })}
                  label={{ value: "Weekly spend", position: "insideBottomRight", offset: -8, style: { ...AXIS_TICK } }}
                />
                <YAxis
                  type="number"
                  dataKey="newCustomers"
                  domain={[0, "auto"]}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tick={AXIS_TICK}
                  label={{ value: "New customers", angle: -90, position: "insideLeft", offset: 12, style: { ...AXIS_TICK } }}
                />
                {m.currentSpend !== null && m.currentSpend > 0 && (
                  <ReferenceLine x={m.currentSpend} stroke="var(--gray-400)" strokeDasharray="3 3" label={{ value: "Now", position: "insideTopRight", style: { ...AXIS_TICK } }} />
                )}
                <Tooltip cursor={false} content={<PointTooltip currency={currency} />} />
                <Scatter data={m.points} isAnimationActive={false} fill={color} fillOpacity={0.75} />
                {m.fit && (
                  <Scatter
                    data={curve}
                    isAnimationActive={false}
                    line={{ stroke: "var(--ink-800)", strokeWidth: 2 }}
                    shape={() => <g />}
                    legendType="none"
                    tooltipType="none"
                  />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <ChartSummary
            id={summaryId}
            categories
            labels={m.points.map((p) => `week of ${p.week}`)}
            series={[
              { name: "Weekly spend", values: m.points.map((p) => p.spend) },
              { name: "New customers", values: m.points.map((p) => p.newCustomers) },
            ]}
            format={(v) => formatNumber(v, { decimals: 0 })}
          />
        </div>

        <dl className="m-0 grid content-start gap-3 text-[13px]">
          {m.fit ? (
            <>
              <Stat
                label="Fit"
                info="Least squares of weekly new customers on the natural log of weekly spend. Each extra unit of spend buys b / spend new customers, so returns fall as spend rises. An estimate from past weeks, not a forecast."
                value={
                  <span className="font-mono text-[12px]">
                    new = {formatNumber(m.fit.a, { decimals: 1 })} {m.fit.b >= 0 ? "+" : "-"} {formatNumber(Math.abs(m.fit.b), { decimals: 2 })} × ln(spend)
                  </span>
                }
              />
              <Stat
                label="R²"
                value={
                  <span className="flex flex-col gap-0.5">
                    <span>{`${formatNumber(m.fit.r2, { decimals: 2 })} over ${m.fit.n} weeks`}</span>
                    {m.fit.r2 < WEAK_FIT_R2 && (
                      <span className="text-[12px] text-warning-700">Weak fit: spend explains little of the weekly swing; read the margin as a direction, not a number.</span>
                    )}
                  </span>
                }
              />
              <Stat
                label="Marginal nCAC now"
                info="Spend that buys one more new customer at the current weekly spend (average of the complete weeks in the selected range), read off the fit: spend / b. Compare with the average nCAC: a gap means the last unit of spend works harder or softer than the average."
                value={m.marginal === null ? NO_VALUE : `${unitMoney(m.marginal)} at ${money(m.currentSpend ?? 0)} a week`}
              />
              <Stat label="Average nCAC, same weeks" value={m.avgNcac === null ? NO_VALUE : unitMoney(m.avgNcac)} />
            </>
          ) : (
            <Stat
              label="Fit"
              value={
                <span className="inline-flex items-center gap-1.5 text-content-muted">
                  {NO_VALUE}
                  <InfoTip text={m.why ?? `Needs ${MIN_FIT_WEEKS} complete weeks with spend`} label="Why there is no fit" />
                </span>
              }
            />
          )}
        </dl>
      </div>

      <Calculator markets={markets} currency={currency} />
    </div>
  );
}

function Stat({ label, value, info }: { label: string; value: ReactNode; info?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="flex items-center gap-1 text-[11.5px] text-content-muted">
        {label}
        {info && <InfoTip text={info} label={`About ${label}`} />}
      </dt>
      <dd className="m-0 tabular text-content-strong">{value}</dd>
    </div>
  );
}

function Calculator({ markets, currency }: { markets: ResponseMarket[]; currency: string }) {
  const fitted = markets.filter((x) => x.fit && x.currentSpend !== null && x.currentSpend > 0);
  const [fromKey, setFrom] = useState(fitted[0]?.market ?? "");
  const [toKey, setTo] = useState(fitted[1]?.market ?? "");
  const from = fitted.find((x) => x.market === fromKey);
  const to = fitted.find((x) => x.market === toKey && x.market !== fromKey) ?? fitted.find((x) => x.market !== fromKey);
  const [amountText, setAmount] = useState(() => (fitted[0]?.currentSpend ? String(Math.round(fitted[0].currentSpend * 0.1)) : "0"));
  const amount = Math.max(0, Number(amountText.replace(/[^0-9.]/g, "")) || 0);

  if (fitted.length < 2 || !from || !to) {
    return (
      <div className="flex items-center gap-1.5 border-t border-hairline pt-4 text-[12.5px] text-content-muted">
        Move spend between markets: {NO_VALUE}
        <InfoTip text="Needs a fitted curve in at least two markets, each with spend in the selected range." label="Why the calculator is off" />
      </div>
    );
  }

  const r = reallocate(
    { fit: from.fit!, spend: from.currentSpend!, gpPerNew: from.gpPerNew },
    { fit: to.fit!, spend: to.currentSpend!, gpPerNew: to.gpPerNew },
    amount
  );
  const n1 = (v: number) => formatNumber(v, { decimals: 1 });
  const takeaway = reallocationTakeaway(from.market, to.market, r, currency);
  const gpWhy = from.gpPerNew === null ? from.gpWhy : to.gpPerNew === null ? to.gpWhy : null;
  const select = "h-8 rounded-sm border border-hairline-strong bg-paper px-2 font-mono text-[12px] text-content-strong";

  return (
    <div className="flex flex-col gap-3 border-t border-hairline pt-4">
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-content-strong">
        Move weekly spend
        <InfoTip
          text="Estimate from the two fits: new customers lost in the giving market and won in the receiving one, at their current weekly spend. GP after ads changes by those customers times each market's first-order GP per new customer; total spend stays the same."
          label="How the estimate is made"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-content-body">
        <label className="inline-flex items-center gap-1.5">
          Move
          <input
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={`Weekly spend to move, ${currency}`}
            className={`${select} w-[96px] text-right`}
          />
          <span className="font-mono text-[11.5px] text-content-muted">{currency}/wk</span>
        </label>
        <label className="inline-flex items-center gap-1.5">
          from
          <select value={from.market} onChange={(e) => setFrom(e.target.value)} className={select} aria-label="From market">
            {fitted.map((x) => (
              <option key={x.market} value={x.market}>
                {marketLabel(x.market)}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5">
          to
          <select value={to.market} onChange={(e) => setTo(e.target.value)} className={select} aria-label="To market">
            {fitted.filter((x) => x.market !== from.market).map((x) => (
              <option key={x.market} value={x.market}>
                {marketLabel(x.market)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {takeaway && <p className="m-0 text-[13px] text-content-strong">{takeaway}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={`New customers, ${marketLabel(from.market)}`} value={`${signed(r.newFrom, n1)} a week`} />
        <Stat label={`New customers, ${marketLabel(to.market)}`} value={`${signed(r.newTo, n1)} a week`} />
        <Stat
          label="GP after ads, estimate"
          value={
            r.gp === null ? (
              <span className="inline-flex items-center gap-1.5 text-content-muted">
                {NO_VALUE}
                <InfoTip text={gpWhy ?? "No first-order GP"} label="Why n/a" />
              </span>
            ) : (
              <span className={r.gp >= 0 ? "text-positive-text" : "text-negative-text"}>{signed(r.gp, (v) => formatMoney(v, currency))} a week</span>
            )
          }
        />
      </div>
      {r.move < amount && (
        <p className="m-0 text-[12px] text-content-muted">Capped at {marketLabel(from.market)}&apos;s current weekly spend of {formatMoney(from.currentSpend, currency)}.</p>
      )}
      {(from.fit!.r2 < WEAK_FIT_R2 || to.fit!.r2 < WEAK_FIT_R2) && (
        <p className="m-0 text-[12px] text-warning-700">
          Weak fit in {[from, to].filter((x) => x.fit!.r2 < WEAK_FIT_R2).map((x) => marketLabel(x.market)).join(" and ")}: read the estimate as a direction.
        </p>
      )}
      {r.extrapolates && (
        <p className="m-0 text-[12px] text-warning-700">Beyond the weekly spend these fits have seen: the estimate extrapolates the curve.</p>
      )}
    </div>
  );
}

function PointTooltip({ active, payload, currency }: { active?: boolean; payload?: Array<{ payload: ResponsePoint & { week?: string } }>; currency: string }) {
  if (!active || !payload?.length || !payload[0].payload.week) return null;
  const p = payload[0].payload;
  return (
    <TooltipBox title={`Week of ${p.week}`}>
      <TooltipRow name="Spend" value={formatMoney(p.spend, currency)} />
      <TooltipRow name="New customers" value={formatNumber(p.newCustomers)} />
      <TooltipRow name="nCAC" value={p.newCustomers > 0 ? formatMoney(p.spend / p.newCustomers, currency, { unit: true }) : NO_VALUE} />
    </TooltipBox>
  );
}
