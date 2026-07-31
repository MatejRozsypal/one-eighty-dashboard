/**
 * The margin stack — how revenue becomes contribution margin.
 *
 * This is the section that justifies building this dashboard instead of buying
 * a retention tool. Retention platforms can't show contribution margin because
 * they can't see cost of goods or ad spend; this warehouse can.
 *
 * ── The two empty steps are the honest part ─────────────────────────────────
 * `cm1_other_costs` (inbound freight, duties, packaging, payment fees) and
 * `fulfilment_cost` (outbound shipping, warehousing, returns) are both hardcoded
 * to zero in `mart_daily_kpis`. They are drawn as hatched placeholders labelled
 * "not measured yet" rather than as zero-height steps, because a zero-height
 * step reads as "this business has no fulfilment costs" — which is false, and a
 * more dangerous kind of wrong than an admitted gap. When the data lands, the
 * steps fill in and nothing else on the page moves.
 *
 * Rendered as a waterfall on desktop and a vertical stepped list on mobile: a
 * horizontal waterfall does not survive a 375pt viewport.
 */

import { DeltaChip } from "@/components/ui/Delta";
import { formatMoney } from "@/lib/currency";
import { Eyebrow } from "@/components/ui/Eyebrow";
import type { PnlSnapshot } from "@/lib/queries/pnl";
import { metric } from "@/lib/queries/pnl";

const CHART_HEIGHT = 290;

interface Step {
  label: string;
  /** Null for placeholder steps. */
  value: number | null;
  /** Where the bar starts, in currency units. */
  base: number;
  /** Bar magnitude, in currency units. */
  magnitude: number;
  kind: "total" | "cost" | "placeholder";
  delta?: number | null;
  goodWhen?: "up" | "down" | "neutral";
  isHero?: boolean;
}

export function MarginStack({ snapshot }: { snapshot: PnlSnapshot }) {
  const t = snapshot.current;
  const currency = snapshot.currency;
  const money = (v: number | null) => formatMoney(v, currency);

  const revenue = t.revenue ?? 0;
  const cm1 = t.cm1 ?? 0;
  const cm2 = t.cm2 ?? 0;
  const cm3 = t.cm3 ?? 0;

  const steps: Step[] = [
    {
      label: "Revenue",
      value: t.revenue,
      base: 0,
      magnitude: revenue,
      kind: "total",
      delta: metric(snapshot, (x) => x.revenue).delta,
      goodWhen: "up",
    },
    {
      label: "− COGS",
      value: t.cogs === null ? null : -t.cogs,
      base: cm1,
      magnitude: t.cogs ?? 0,
      kind: "cost",
      delta: metric(snapshot, (x) => x.cogs).delta,
      goodWhen: "down",
    },
    {
      label: "− Other CM1 costs",
      value: null,
      base: cm1,
      magnitude: 0,
      kind: "placeholder",
    },
    {
      label: "CM1",
      value: t.cm1,
      base: 0,
      magnitude: cm1,
      kind: "total",
      delta: metric(snapshot, (x) => x.cm1).delta,
      goodWhen: "up",
    },
    {
      label: "− Fulfilment",
      value: null,
      base: cm1,
      magnitude: 0,
      kind: "placeholder",
    },
    {
      label: "CM2",
      value: t.cm2,
      base: 0,
      magnitude: cm2,
      kind: "total",
      delta: metric(snapshot, (x) => x.cm2).delta,
      goodWhen: "up",
    },
    {
      label: "− Paid spend",
      value: t.paidSpend === null ? null : -t.paidSpend,
      base: cm3,
      magnitude: t.paidSpend ?? 0,
      kind: "cost",
      delta: metric(snapshot, (x) => x.paidSpend).delta,
      goodWhen: "neutral",
    },
    {
      label: "CM3",
      value: t.cm3,
      base: 0,
      magnitude: cm3,
      kind: "total",
      delta: metric(snapshot, (x) => x.cm3).delta,
      goodWhen: "up",
      isHero: true,
    },
  ];

  // Scale every bar against revenue, the largest quantity in the stack.
  const px = (v: number) =>
    revenue > 0 ? Math.max(0, (v / revenue) * CHART_HEIGHT) : 0;

  return (
    <section className="flex flex-col gap-5 rounded-card border border-hairline bg-surface-card p-[24px_20px_22px] shadow-sm lg:p-[24px_28px_22px]">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <Eyebrow tone="accent">The margin stack</Eyebrow>
          <h2 className="m-0 text-[20px] font-bold tracking-heading text-content-strong">
            How revenue becomes <i className="font-medium">contribution margin.</i>
          </h2>
        </div>
        <div className="flex items-center gap-[18px]">
          {[
            { label: "Total", className: "bg-ink-700" },
            {
              label: "Cost",
              className: "border border-negative/55 bg-negative/[0.22]",
            },
            { label: "CM3", className: "bg-accent" },
          ].map((k) => (
            <span
              key={k.label}
              className="inline-flex items-center gap-[7px] font-mono text-[11px] text-content-muted"
            >
              <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-[3px] ${k.className}`} />
              {k.label}
            </span>
          ))}
        </div>
      </div>

      {/* Desktop waterfall */}
      <div className="hidden items-end gap-2.5 md:flex">
        {steps.map((step) => (
          <div key={step.label} className="flex min-w-0 flex-1 flex-col gap-3.5">
            <div className="relative" style={{ height: CHART_HEIGHT }}>
              <div
                className={`absolute inset-x-0 ${
                  step.kind === "total"
                    ? step.isHero
                      ? "rounded-t-lg bg-accent"
                      : "rounded-t-lg bg-ink-600"
                    : step.kind === "cost"
                      ? "rounded-md border border-negative/55 bg-negative/[0.18]"
                      : "hatched rounded-md border border-dashed border-hairline-strong"
                }`}
                style={{
                  bottom: `${px(step.base)}px`,
                  height:
                    step.kind === "placeholder"
                      ? "34px"
                      : `${Math.max(px(step.magnitude), 4)}px`,
                }}
              />
              {step.kind === "placeholder" && (
                <span
                  className="absolute inset-x-0 text-center font-mono text-[9.5px] uppercase tracking-[0.06em] text-gray-400"
                  style={{ bottom: `${px(step.base) + 40}px` }}
                >
                  Not measured yet
                </span>
              )}
            </div>

            <div
              className={`flex flex-col gap-[7px] border-t pt-[11px] ${
                step.isHero ? "border-accent" : "border-hairline"
              }`}
            >
              <span
                className={`font-mono text-[10.5px] uppercase tracking-[0.08em] ${
                  step.isHero ? "text-growth-700" : "text-content-muted"
                }`}
              >
                {step.label}
              </span>
              <span
                className={`whitespace-nowrap font-mono text-[15px] font-semibold tracking-heading tabular ${
                  step.kind === "placeholder" ? "text-gray-400" : "text-content-strong"
                }`}
              >
                {step.kind === "placeholder" ? "No data" : money(step.value)}
              </span>
              <span className="h-[17px]">
                {step.delta !== undefined && (
                  <DeltaChip delta={step.delta} goodWhen={step.goodWhen} />
                )}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Mobile: vertical stepped list — bar length still encodes value */}
      <div className="flex flex-col gap-3.5 md:hidden">
        {steps.map((step) => {
          const widthPct =
            step.kind === "placeholder"
              ? 22
              : revenue > 0
                ? Math.max(6, (step.magnitude / revenue) * 100)
                : 6;

          return (
            <div key={step.label} className="flex flex-col gap-[7px]">
              <div className="flex items-baseline justify-between gap-2.5">
                <span
                  className={`font-mono text-[10.5px] uppercase tracking-[0.06em] ${
                    step.isHero ? "text-growth-700" : "text-content-muted"
                  }`}
                >
                  {step.label}
                </span>
                <span
                  className={`font-mono text-[14px] font-semibold tabular ${
                    step.kind === "placeholder" ? "text-gray-400" : "text-content-strong"
                  }`}
                >
                  {step.kind === "placeholder" ? "No data" : money(step.value)}
                </span>
              </div>
              <div
                className={`rounded-xs ${
                  step.kind === "total"
                    ? step.isHero
                      ? "h-3.5 bg-accent"
                      : "h-3.5 bg-ink-600"
                    : step.kind === "cost"
                      ? "h-2.5 border border-negative/55 bg-negative/[0.18]"
                      : "hatched h-3.5 border border-dashed border-hairline-strong"
                }`}
                style={{
                  width: `${widthPct}%`,
                  marginLeft:
                    step.kind === "cost" ? `${Math.max(0, 100 - widthPct - 2)}%` : 0,
                }}
              />
              {step.kind === "placeholder" && (
                <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-gray-400">
                  Not measured yet
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col items-start gap-2.5 rounded-control border border-dashed border-hairline-strong bg-gray-50 p-[11px_14px] sm:flex-row sm:items-center">
        <span className="rounded-pill border border-dashed border-hairline-strong px-2 py-[3px] font-mono text-[9.5px] uppercase tracking-[0.1em] text-gray-400">
          No data
        </span>
        <span className="text-[12.5px] leading-[1.6] text-content-body">
          Two cost steps are hardcoded to zero:{" "}
          <b className="text-content-strong">other CM1 costs</b> (inbound freight,
          duties, packaging, payment fees) and{" "}
          <b className="text-content-strong">fulfilment</b> (shipping, warehousing).
          CM1 and CM2 are therefore identical today. Both steps are drawn empty
          rather than as zero; when the data lands they fill in and nothing else
          moves.
        </span>
      </div>
    </section>
  );
}
