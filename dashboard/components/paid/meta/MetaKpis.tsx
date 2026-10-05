/**
 * The two KPI rows and the funnel of the Meta tab.
 *
 * Row 1 is the outcome (spend to CPA). Row 2 is the soft metrics that explain
 * it. Every figure is a ratio of sums over the period's rows; the change chip
 * compares against the comparison period and follows the delta toggle (percent
 * or absolute for money, counts and ratios, percentage points for rates).
 */

import {
  formatMoney,
  formatNumber,
  formatPercent,
  formatRatio,
  NO_VALUE,
  type DeltaInput,
  type DeltaKind,
} from "@/lib/format";
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
import { Section } from "@/components/paid/meta/cells";

interface SoftTile {
  label: string;
  value: string;
  metricKey?: string;
  /** Both values and the kind; null when the comparison is off. Rates show points. */
  change: DeltaInput | null;
  goodWhen: GoodWhen;
}

function SoftKpi({ label, value, metricKey, change, goodWhen }: SoftTile) {
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
      <DeltaChip change={change} goodWhen={goodWhen} />
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
  const chg = (
    cur: number | null,
    prev: number | null | undefined,
    kind: DeltaKind
  ): DeltaInput | null => (p ? { current: cur, previous: prev ?? null, kind, currency } : null);

  const money = (v: number | null) => formatMoney(v, currency);
  const unit = (v: number | null) => formatMoney(v, currency, { unit: true });

  const hook = hookRate(video);
  const prevHook = previousVideo ? hookRate(previousVideo) : null;

  const soft: SoftTile[] = [
    { label: "CPM", value: unit(c.cpm), change: chg(c.cpm, p?.cpm, "money"), goodWhen: "down" },
    {
      label: "Link CTR",
      value: formatPercent(c.linkCtr, { decimals: 2 }),
      metricKey: "Link CTR",
      change: chg(c.linkCtr, p?.linkCtr, "rate"),
      goodWhen: "up",
    },
    { label: "CPC (link)", value: unit(c.cpc), change: chg(c.cpc, p?.cpc, "money"), goodWhen: "down" },
    {
      label: "Cost / LPV",
      value: unit(c.costPerLpv),
      metricKey: "Cost / LPV",
      change: chg(c.costPerLpv, p?.costPerLpv, "money"),
      goodWhen: "down",
    },
    {
      label: "Cost / ATC",
      value: unit(c.costPerAtc),
      metricKey: "Cost / ATC",
      change: chg(c.costPerAtc, p?.costPerAtc, "money"),
      goodWhen: "down",
    },
    {
      label: "ATC to purchase",
      value: formatPercent(c.atcToPurchase, { decimals: 1 }),
      metricKey: "ATC to purchase",
      change: chg(c.atcToPurchase, p?.atcToPurchase, "rate"),
      goodWhen: "up",
    },
    {
      label: "Frequency",
      value: formatNumber(c.frequency, { decimals: 2 }),
      metricKey: "Avg daily frequency",
      change: chg(c.frequency, p?.frequency, "ratio"),
      goodWhen: "neutral",
    },
    {
      label: "Hook rate",
      value: formatPercent(hook, { decimals: 1 }),
      metricKey: "Hook rate",
      change: previousVideo
        ? { current: hook, previous: prevHook, kind: "rate", currency }
        : null,
      goodWhen: "up",
    },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <KpiTile
          label="Spend"
          value={money(current.spend)}
          change={chg(current.spend, previous?.spend, "money")}
          goodWhen="neutral"
        />
        <KpiTile
          label="Purchase value"
          value={money(current.revenue)}
          change={chg(current.revenue, previous?.revenue, "money")}
        />
        <KpiTile
          label="ROAS"
          value={formatRatio(c.roas)}
          change={chg(c.roas, p?.roas, "ratio")}
        />
        <KpiTile
          label="Purchases"
          value={formatNumber(current.purchases)}
          change={chg(current.purchases, previous?.purchases, "count")}
        />
        <KpiTile
          label="CPA"
          value={unit(c.cpa)}
          change={chg(c.cpa, p?.cpa, "money")}
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
      <Funnel steps={steps.map((s) => ({ label: s.label, value: s.value }))} nonSequential />
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
