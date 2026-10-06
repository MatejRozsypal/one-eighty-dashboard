"use client";

/**
 * The chart half of a plan view: burn-up, daily bars and the breakdown table,
 * all on one metric picked here. All four metrics arrive together, so the
 * switch is local state and costs no query (same pattern as the Paid spend
 * chart).
 */

import { useState } from "react";
import { SegmentPills } from "@/components/controls/SegmentedControl";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { NoData } from "@/components/ui/EmptyState";
import { BurnUpChart } from "@/components/plan/BurnUpChart";
import { DailyChart } from "@/components/plan/DailyChart";
import { BreakdownTable } from "@/components/plan/BreakdownTable";
import { METRIC_LABEL } from "@/lib/plan/format";
import type { BreakdownRow, PromoBand, SeriesPoint } from "@/lib/plan/model";
import { PLAN_METRICS, type PlanMetric } from "@/lib/plan/types";

const CARD = "flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]";

const SHORT: Record<PlanMetric, string> = {
  orders: "Orders",
  revenue: "Revenue",
  new_customers: "New",
  ad_spend: "Spend",
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
}) {
  const [metric, setMetric] = useState<PlanMetric>("orders");
  const points = series[metric];
  const hasCurve = points.some((p) => p.cumTarget !== null);

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
      <section className={CARD} aria-label="Burn-up">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Eyebrow>Burn-up</Eyebrow>
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

      <section className={CARD} aria-label="Daily">
        <Eyebrow>Daily</Eyebrow>
        {hasCurve ? <DailyChart points={points} bands={bands} metric={metric} currency={currency} /> : <NoData />}
      </section>

      <section className={CARD} aria-label={breakdownTitle}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Eyebrow>{breakdownTitle}</Eyebrow>
          <span className="font-mono text-[11px] text-content-muted">{METRIC_LABEL[metric]}</span>
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
