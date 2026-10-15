"use client";

/**
 * Profit waterfall for one market: gross sales down to GP after ads.
 *
 * The CM2 lines (shipping and fulfilment, payment fees) keep their place as
 * empty dashed rows until rate cards exist, so the reader sees what the
 * figure at the bottom does not yet subtract. A line the platform does not
 * send is a row with n/a and its reason, never a zero.
 */

import { useId } from "react";
import { ChartSummary } from "@/components/ui/ChartSummary";
import { NaValue } from "@/components/markets/bits";
import { isNa, NOT_YET, type PeriodMetrics } from "@/lib/markets/model";
import { formatMoney, MINUS } from "@/lib/format";

type Step =
  | { kind: "total" | "minus" | "result"; label: string; from: number; to: number; value: number }
  | { kind: "na" | "placeholder"; label: string; reason: string };

export function Waterfall({ m, currency, factor }: { m: PeriodMetrics; currency: string; factor: number }) {
  const id = useId();
  const f = (x: number) => x * factor;
  const steps: Step[] = [];
  const v = (x: { v: number } | { na: string }) => (isNa(x) ? null : f(x.v));

  const gross = v(m.grossSales);
  const disc = v(m.discounts);
  const refunds = v(m.refunds);
  const netSales = f((m.netSales as { v: number }).v);
  let level: number;

  if (gross !== null && disc !== null) {
    steps.push({ kind: "total", label: "Gross sales", from: 0, to: gross, value: gross });
    steps.push({ kind: "minus", label: "Discounts", from: gross - disc, to: gross, value: -disc });
    level = gross - disc;
    if (refunds !== null) {
      steps.push({ kind: "minus", label: "Refunds", from: level - refunds, to: level, value: -refunds });
      level -= refunds;
    } else if (isNa(m.refunds)) {
      steps.push({ kind: "na", label: "Refunds", reason: m.refunds.na });
    }
    const other = level - netSales;
    if (Math.abs(other) > Math.abs(gross) * 0.005) {
      steps.push({ kind: "minus", label: "Other adjustments", from: Math.min(level, netSales), to: Math.max(level, netSales), value: -other });
    }
  } else {
    steps.push({ kind: "na", label: "Gross sales", reason: isNa(m.grossSales) ? m.grossSales.na : (m.discounts as { na: string }).na });
  }
  steps.push({ kind: "total", label: "Net sales", from: 0, to: netSales, value: netSales });

  const gp = v(m.grossProfit);
  const spend = f((m.spend as { v: number }).v);
  if (gp !== null) {
    steps.push({ kind: "minus", label: "COGS", from: gp, to: netSales, value: -(netSales - gp) });
    steps.push({ kind: "total", label: "Gross profit (CM1)", from: 0, to: gp, value: gp });
  } else {
    steps.push({ kind: "na", label: "COGS", reason: (m.grossProfit as { na: string }).na });
  }
  steps.push({ kind: "placeholder", label: "Shipping and fulfilment", reason: NOT_YET.shipCost });
  steps.push({ kind: "placeholder", label: "Payment fees", reason: NOT_YET.payFees });
  steps.push({ kind: "placeholder", label: "CM2", reason: NOT_YET.cm2 });
  if (gp !== null) {
    const gpa = gp - spend;
    steps.push({ kind: "minus", label: "Ad spend", from: gpa, to: gp, value: -spend });
    steps.push({ kind: "result", label: "GP after ads", from: Math.min(0, gpa), to: Math.max(0, gpa), value: gpa });
  } else {
    steps.push({ kind: "minus", label: "Ad spend", from: 0, to: spend, value: -spend });
    steps.push({ kind: "na", label: "GP after ads", reason: (m.grossProfit as { na: string }).na });
  }

  const drawn = steps.filter((s): s is Extract<Step, { from: number }> => "from" in s);
  const lo = Math.min(0, ...drawn.map((s) => s.from));
  const hi = Math.max(0, ...drawn.map((s) => s.to));
  const range = hi - lo || 1;
  const pct = (x: number) => `${((x - lo) / range) * 100}%`;
  const money = (x: number) => formatMoney(x, currency, { compact: Math.abs(x) >= 10_000 });
  const signed = (s: Extract<Step, { from: number }>) =>
    s.kind === "minus" ? `${s.value < 0 ? MINUS : "+"}${money(Math.abs(s.value))}` : money(s.value);

  return (
    <div>
      <div role="img" aria-label="Profit waterfall, gross sales to GP after ads" aria-describedby={`${id}-sum`} className="flex flex-col gap-1.5">
        {steps.map((s) => {
          const isTotal = s.kind === "total" || s.kind === "result";
          return (
            <div key={s.label} className="grid grid-cols-[minmax(0,108px)_minmax(0,1fr)_minmax(0,84px)] sm:grid-cols-[minmax(0,152px)_minmax(0,1fr)_minmax(0,92px)] items-center gap-2.5">
              <span title={s.label} className={`truncate text-[12.5px] ${isTotal ? "font-semibold text-content-strong" : "text-content-body"}`}>{s.label}</span>
              <span className="relative h-[14px] rounded-xs bg-gray-50">
                {lo < 0 && <span aria-hidden="true" className="absolute inset-y-0 w-px bg-hairline-strong" style={{ left: pct(0) }} />}
                {"from" in s ? (
                  <span
                    aria-hidden="true"
                    className={`absolute inset-y-0 rounded-xs ${
                      s.kind === "result" ? (s.value >= 0 ? "bg-growth-500" : "bg-negative") : s.kind === "total" ? "bg-ink-800" : "bg-gray-300"
                    }`}
                    style={{ left: pct(s.from), width: `max(2px, ${((s.to - s.from) / range) * 100}%)` }}
                  />
                ) : (
                  <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[18%] rounded-xs border border-dashed border-hairline-strong" />
                )}
              </span>
              <span className="text-right font-mono text-[12.5px] tabular text-content-strong">
                {"from" in s ? signed(s) : <NaValue reason={s.reason} />}
              </span>
            </div>
          );
        })}
      </div>
      <ChartSummary
        id={`${id}-sum`}
        categories
        series={[{ name: "Waterfall", values: steps.map((s) => ("from" in s ? s.value : null)) }]}
        labels={steps.map((s) => s.label)}
        format={(x) => formatMoney(x, currency)}
      />
    </div>
  );
}
