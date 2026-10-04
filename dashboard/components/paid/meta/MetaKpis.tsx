/**
 * The two KPI rows and the funnel of the Meta tab.
 *
 * Row 1 is the outcome (spend to CPA). Row 2 is the soft metrics that explain
 * it. Every figure is a ratio of sums over the period's rows; the change chip
 * compares against the comparison period, in percent for money, counts and
 * ratios and in percentage points for rates.
 */

import { formatMoney, formatNumber, formatPercent, formatRatio, NO_VALUE } from "@/lib/format";
import { relativeChange, pointChange } from "@/lib/paid/math";
import { KpiTile } from "@/components/dashboard/KpiTile";
import { MetricTooltip } from "@/components/dashboard/MetricTooltip";
import { DeltaChip, type GoodWhen } from "@/components/ui/Delta";
import { METRIC_DEFINITIONS } from "@/lib/metrics";
import { Funnel } from "@/components/dashboard/Funnel";
import {
  funnelSteps,
  hookRate,
  ratesOf,
  type MetaSums,
  type VideoSums,
} from "@/components/paid/meta/aggregate";
import { PpChip, Section } from "@/components/paid/meta/cells";

interface SoftTile {
  label: string;
  value: string;
  metricKey?: string;
  /** Rates show a point change, everything else a relative one. */
  chip: { kind: "rel"; delta: number | null; goodWhen: GoodWhen } | { kind: "pp"; delta: number | null; goodWhen: GoodWhen };
}

function SoftKpi({ label, value, metricKey, chip }: SoftTile) {
  const definition = metricKey ? METRIC_DEFINITIONS[metricKey] : undefined;
  const missing = value === NO_VALUE;
  return (
    <div className="flex flex-col gap-2 rounded-card border border-hairline bg-surface-card p-[13px_15px] shadow-sm">
      <span className="relative inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
        {label}
        {definition && <MetricTooltip definition={definition} />}
      </span>
      <span
        className={`font-mono text-[18px] font-semibold leading-none tracking-heading tabular ${
          missing ? "text-content-muted" : "text-content-strong"
        }`}
      >
        {value}
      </span>
      {chip.kind === "rel" ? (
        <DeltaChip delta={chip.delta} goodWhen={chip.goodWhen} />
      ) : (
        <PpChip delta={chip.delta} goodWhen={chip.goodWhen} />
      )}
    </div>
  );
}

export function MetaKpis({
  current,
  previous,
  video,
  previousVideo,
  currency,
}: {
  current: MetaSums;
  /** Null when the comparison is off: no chips. */
  previous: MetaSums | null;
  video: VideoSums;
  previousVideo: VideoSums | null;
  /** Ad account currency. */
  currency: string;
}) {
  const c = ratesOf(current);
  const p = previous ? ratesOf(previous) : null;
  const rel = (cur: number | null, prev: number | null | undefined) =>
    p ? relativeChange(cur, prev ?? null) : null;
  const pp = (cur: number | null, prev: number | null | undefined) =>
    p ? pointChange(cur, prev ?? null) : null;

  const money = (v: number | null) => formatMoney(v, currency);
  const unit = (v: number | null) => formatMoney(v, currency, { unit: true });

  const hook = hookRate(video);
  const prevHook = previousVideo ? hookRate(previousVideo) : null;

  const soft: SoftTile[] = [
    { label: "CPM", value: unit(c.cpm), chip: { kind: "rel", delta: rel(c.cpm, p?.cpm), goodWhen: "down" } },
    {
      label: "Link CTR",
      value: formatPercent(c.linkCtr, { decimals: 2 }),
      metricKey: "Link CTR",
      chip: { kind: "pp", delta: pp(c.linkCtr, p?.linkCtr), goodWhen: "up" },
    },
    { label: "CPC (link)", value: unit(c.cpc), chip: { kind: "rel", delta: rel(c.cpc, p?.cpc), goodWhen: "down" } },
    {
      label: "Cost / LPV",
      value: unit(c.costPerLpv),
      metricKey: "Cost / LPV",
      chip: { kind: "rel", delta: rel(c.costPerLpv, p?.costPerLpv), goodWhen: "down" },
    },
    {
      label: "Cost / ATC",
      value: unit(c.costPerAtc),
      metricKey: "Cost / ATC",
      chip: { kind: "rel", delta: rel(c.costPerAtc, p?.costPerAtc), goodWhen: "down" },
    },
    {
      label: "ATC to purchase",
      value: formatPercent(c.atcToPurchase, { decimals: 1 }),
      metricKey: "ATC to purchase",
      chip: { kind: "pp", delta: pp(c.atcToPurchase, p?.atcToPurchase), goodWhen: "up" },
    },
    {
      label: "Frequency",
      value: formatNumber(c.frequency, { decimals: 2 }),
      metricKey: "Avg daily frequency",
      chip: { kind: "rel", delta: rel(c.frequency, p?.frequency), goodWhen: "neutral" },
    },
    {
      label: "Hook rate",
      value: formatPercent(hook, { decimals: 1 }),
      metricKey: "Hook rate",
      chip: { kind: "pp", delta: previousVideo ? pointChange(hook, prevHook) : null, goodWhen: "up" },
    },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <KpiTile
          label="Spend"
          value={money(current.spend)}
          delta={rel(current.spend, previous?.spend)}
          goodWhen="neutral"
        />
        <KpiTile
          label="Purchase value"
          value={money(current.revenue)}
          delta={rel(current.revenue, previous?.revenue)}
        />
        <KpiTile
          label="ROAS"
          value={formatRatio(c.roas)}
          delta={rel(c.roas, p?.roas)}
        />
        <KpiTile
          label="Purchases"
          value={formatNumber(current.purchases)}
          delta={rel(current.purchases, previous?.purchases)}
        />
        <KpiTile
          label="CPA"
          value={unit(c.cpa)}
          delta={rel(c.cpa, p?.cpa)}
          goodWhen="down"
        />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {soft.map((t) => (
          <SoftKpi key={t.label} {...t} />
        ))}
      </div>
    </section>
  );
}

/**
 * The funnel with its cost per step. The Funnel itself draws counts and step
 * rates; the costs are a row beneath it, so they do not depend on the funnel's
 * horizontal scroll to stay readable.
 */
export function MetaFunnel({ sums, currency }: { sums: MetaSums; currency: string }) {
  const steps = funnelSteps(sums);
  if (steps.length < 2) return null;

  return (
    <Section title="Funnel">
      <Funnel steps={steps.map((s) => ({ label: s.label, value: s.value }))} />
      <dl className="flex flex-wrap gap-x-7 gap-y-3 border-t border-hairline pt-4">
        {steps.map((s) => (
          <div key={s.key} className="flex flex-col gap-1">
            <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-content-muted">
              {s.costLabel}
            </dt>
            <dd
              className={`font-mono text-[13.5px] font-semibold tabular ${
                s.cost === null ? "text-content-muted" : "text-content-strong"
              }`}
            >
              {formatMoney(s.cost, currency, { unit: true })}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
