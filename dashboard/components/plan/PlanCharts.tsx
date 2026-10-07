"use client";

/**
 * The chart half of a plan view: burn-up, daily bars and the breakdown table,
 * all on one metric picked here. All four metrics arrive together, so the
 * switch is local state and costs no query (same pattern as the Paid spend
 * chart). It opens on the first metric that has a target in the period; the
 * parent keys it by period so a new period starts there again.
 */

import { useState } from "react";
import { SegmentPills } from "@/components/controls/SegmentedControl";
import { SectionTitle } from "@/components/plan/SectionTitle";
import { NoData } from "@/components/ui/EmptyState";
import { BurnUpChart } from "@/components/plan/BurnUpChart";
import { DailyChart } from "@/components/plan/DailyChart";
import { BreakdownTable } from "@/components/plan/BreakdownTable";
import { METRIC_LABEL } from "@/lib/plan/format";
import type { BreakdownRow, PromoBand, SeriesPoint } from "@/lib/plan/model";
import { PLAN_METRICS, type PlanMetric } from "@/lib/plan/types";
import type { HealthTone } from "@/lib/plan/health";

const CARD =
  "flex flex-col gap-[18px] rounded-card border border-hairline bg-surface-card p-[20px_18px] shadow-sm sm:p-[24px_22px] lg:p-[24px_26px]";

const SHORT: Record<PlanMetric, string> = {
  orders: "Orders",
  revenue: "Revenue",
  new_customers: "New",
  ad_spend: "Spend",
  cm3: "CM3",
  amer: "aMER",
};

export function PlanCharts({
  series,
  bands,
  asOf,
  currency,
  targets,
  breakdown,
  breakdownTitle,
  unit,
  showStatus,
  initialMetric,
  tones,
}: {
  series: Record<PlanMetric, SeriesPoint[]>;
  bands: PromoBand[];
  asOf: string | null;
  currency: string;
  targets: Record<PlanMetric, number | null>;
  breakdown: BreakdownRow[];
  breakdownTitle: string;
  unit: string;
  showStatus: boolean;
  /** The first metric with a target in the period. */
  initialMetric: PlanMetric;
  /** Status colour per metric: the charts draw the chosen one in its own. */
  tones: Record<PlanMetric, HealthTone>;
}) {
  const [metric, setMetric] = useState<PlanMetric>(initialMetric);
  const points = series[metric];
  const hasCurve = points.some((p) => p.cumTarget !== null || p.cumActual !== null);

  /*
   * The series colour is set here rather than inside each chart: both charts
   * read `--series-1` through `chartTheme`, so pointing that one variable at
   * the metric's status colour re-colours the plot, its fill, its legend and
   * its tooltip swatches together.
   */
  const accent = { "--series-1": `var(--h-${tones[metric]})` } as React.CSSProperties;

  const picker = (
    <SegmentPills
      ariaLabel="Chart metric"
      shown={metric}
      onSelect={(v) => setMetric(v as PlanMetric)}
      segments={PLAN_METRICS.map((m) => ({ value: m, label: SHORT[m], title: METRIC_LABEL[m] }))}
    />
  );

  return (
    <>
      <section className={CARD} style={accent} aria-label="Burn-up">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle>Burn-up</SectionTitle>
          {picker}
        </div>
        {hasCurve ? (
          <BurnUpChart
            points={points}
            bands={bands}
            asOf={asOf}
            metric={metric}
            currency={currency}
            target={targets[metric]}
          />
        ) : (
          <NoData />
        )}
      </section>

      <section className={CARD} style={accent} aria-label="Daily">
        <SectionTitle>Daily</SectionTitle>
        {hasCurve ? <DailyChart points={points} bands={bands} metric={metric} currency={currency} /> : <NoData />}
      </section>

      <section className={CARD} aria-label={breakdownTitle}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle>{breakdownTitle}</SectionTitle>
          <span className="text-[12.5px] text-content-muted">{METRIC_LABEL[metric]}</span>
        </div>
        {breakdown.length > 0 ? (
          <BreakdownTable rows={breakdown} metric={metric} currency={currency} unit={unit} showStatus={showStatus} />
        ) : (
          <NoData />
        )}
      </section>
    </>
  );
}
