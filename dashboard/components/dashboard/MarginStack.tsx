/**
 * The margin stack: how revenue becomes contribution margin.
 *
 * This is the section that justifies building this dashboard instead of buying
 * a retention tool. Retention platforms can't show contribution margin because
 * they can't see cost of goods or ad spend; this warehouse can.
 *
 * ── Unmeasured steps are the honest part ────────────────────────────────────
 * Other CM1 costs (inbound freight, duties, packaging, payment fees) and
 * fulfilment (outbound shipping, warehousing, returns) have no connected source.
 * They become real once someone states a per-order rate in Settings, which the
 * P&L then multiplies by orders and deducts.
 *
 * Until a rate is stated, the step is drawn hatched and labelled "Not measured"
 * rather than as a zero-height bar, because a zero-height step reads as "this
 * business has no fulfilment costs", which is false and a more dangerous kind
 * of wrong than an admitted gap.
 *
 * The same hatched style carries "No cost data": when revenue exists but no
 * product costs do (COGS is null), COGS, CM1, CM2 and CM3 are drawn hatched too,
 * never as revenue and never as zero.
 *
 * Rendered as a waterfall on desktop and a vertical stepped list on mobile: a
 * horizontal waterfall does not survive a 375pt viewport.
 */

import { DeltaChip } from "@/components/ui/Delta";
import { formatMoney } from "@/lib/currency";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { MetricTooltip } from "@/components/dashboard/MetricTooltip";
import { METRIC_DEFINITIONS } from "@/lib/metrics";
import type { PnlSnapshot } from "@/lib/queries/pnl";
import { metricChange, hasNoCostData, paidSpendChange } from "@/lib/queries/pnl";
import type { DeltaInput } from "@/lib/format";

const CHART_HEIGHT = 290;

/** The one line a hatched step shows in place of its figure. */
type Missing = "Not measured" | "No cost data";

interface Step {
  label: string;
  /** Metric whose definition is shown beside the label. */
  definition?: string;
  /** Null for placeholder steps. */
  value: number | null;
  /** Where the bar starts, in currency units. */
  base: number;
  /** Bar magnitude, in currency units. */
  magnitude: number;
  kind: "total" | "cost" | "placeholder";
  /** Current and comparison values: the chip follows the % / 123 toggle. */
  change?: DeltaInput | null;
  goodWhen?: "up" | "down" | "neutral";
  isHero?: boolean;
  /** Set on placeholder steps. */
  missing?: Missing;
}

export function MarginStack({ snapshot }: { snapshot: PnlSnapshot }) {
  const t = snapshot.current;
  const noCost = hasNoCostData(snapshot.current);
  const currency = snapshot.currency;
  const money = (v: number | null) => formatMoney(v, currency);

  const revenue = t.revenue ?? 0;
  const cm1 = t.cm1 ?? 0;
  const cm2 = t.cm2 ?? 0;
  const cm3 = t.cm3 ?? 0;

  // A placeholder step: hatched, no figure, one line saying why.
  const gap = (label: string, missing: Missing, extra: Partial<Step> = {}): Step => ({
    label,
    value: null,
    base: 0,
    magnitude: 0,
    kind: "placeholder",
    missing,
    ...extra,
  });

  const steps: Step[] = [
    {
      label: "Revenue",
      value: t.revenue,
      base: 0,
      magnitude: revenue,
      kind: "total",
      change: metricChange(snapshot, (x) => x.revenue, "money"),
      goodWhen: "up",
    },
    noCost
      ? gap("\u2212 COGS", "No cost data")
      : {
          label: "\u2212 COGS",
          value: t.cogs === null ? null : -t.cogs,
          base: cm1,
          magnitude: t.cogs ?? 0,
          kind: "cost",
          change: metricChange(snapshot, (x) => x.cogs, "money"),
          goodWhen: "down",
        },
    noCost
      ? gap("CM1", "No cost data")
      : {
          label: "CM1",
          value: t.cm1,
          base: 0,
          magnitude: cm1,
          kind: "total",
          change: metricChange(snapshot, (x) => x.cm1, "money"),
          goodWhen: "up",
        },
    t.otherCm1Cost === null
      ? gap("\u2212 Other CM1", "Not measured", { base: noCost ? 0 : cm1 })
      : {
          label: "\u2212 Other CM1",
          value: -t.otherCm1Cost,
          base: noCost ? 0 : cm1,
          magnitude: t.otherCm1Cost,
          kind: "cost",
          goodWhen: "down",
        },
    t.fulfilmentCost === null
      ? gap("\u2212 Fulfilment", "Not measured", {
          base: noCost ? 0 : cm2,
          definition: "Fulfilment",
        })
      : {
          label: "\u2212 Fulfilment",
          definition: "Fulfilment",
          value: -t.fulfilmentCost,
          base: noCost ? 0 : cm2,
          magnitude: t.fulfilmentCost,
          kind: "cost",
          goodWhen: "down",
        },
    noCost
      ? gap("CM2", "No cost data")
      : {
          label: "CM2",
          value: t.cm2,
          base: 0,
          magnitude: cm2,
          kind: "total",
          change: metricChange(snapshot, (x) => x.cm2, "money"),
          goodWhen: "up",
        },
    {
      label: "\u2212 Paid spend",
      value: t.paidSpend === null ? null : -t.paidSpend,
      base: noCost ? 0 : cm3,
      magnitude: t.paidSpend ?? 0,
      kind: "cost",
      // Same rule as the Paid spend tile: no delta against a comparison that
      // only partly had spend.
      change: paidSpendChange(snapshot),
      goodWhen: "neutral",
    },
    noCost
      ? gap("CM3", "No cost data", { isHero: true })
      : {
          label: "CM3",
          value: t.cm3,
          base: 0,
          magnitude: cm3,
          kind: "total",
          change: metricChange(snapshot, (x) => x.cm3, "money"),
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
            Revenue to CM3
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
                      : "hatched rounded-md border border-hairline-strong"
                }`}
                style={{
                  bottom: `${px(step.base)}px`,
                  height:
                    step.kind === "placeholder"
                      ? "34px"
                      : `${Math.max(px(step.magnitude), 4)}px`,
                }}
              />
            </div>

            <div
              className={`flex flex-col gap-[7px] border-t pt-[11px] ${
                step.isHero ? "border-accent" : "border-hairline"
              }`}
            >
              <span
                className={`relative inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] ${
                  step.isHero ? "text-growth-700" : "text-content-muted"
                }`}
              >
                {step.label}
                {step.definition && <MetricTooltip definition={METRIC_DEFINITIONS[step.definition]} />}
              </span>
              <span
                className={`whitespace-nowrap font-mono text-[15px] font-semibold tracking-heading tabular ${
                  step.kind === "placeholder" || step.value === null
                    ? "text-gray-400"
                    : "text-content-strong"
                }`}
              >
                {step.kind === "placeholder" ? step.missing : money(step.value)}
              </span>
              <span className="h-[17px]">
                {step.change !== undefined && (
                  <DeltaChip change={step.change} goodWhen={step.goodWhen} />
                )}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Mobile: vertical stepped list, bar length still encodes value */}
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
                    step.kind === "placeholder" || step.value === null
                      ? "text-gray-400"
                      : "text-content-strong"
                  }`}
                >
                  {step.kind === "placeholder" ? step.missing : money(step.value)}
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
                      : "hatched h-3.5 border border-hairline-strong"
                }`}
                style={{
                  width: `${widthPct}%`,
                  marginLeft:
                    step.kind === "cost" ? `${Math.max(0, 100 - widthPct - 2)}%` : 0,
                }}
              />
            </div>
          );
        })}
      </div>

    </section>
  );
}
