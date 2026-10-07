/**
 * The Plan page body for a Month, Quarter, Promo or Target period, and the
 * dispatch between them. Server component; the page only resolves the client,
 * the view and the period, then hands over here.
 */

import {
  breakdown,
  buildSeries,
  defaultMetric,
  hasAnyRow,
  promoBands,
  rowsOf,
  timeline,
  type BreakdownRow,
  type PeriodOption,
} from "@/lib/plan/model";
import { daysBetween, fmtDay, fmtRange } from "@/lib/plan/dates";
import { PLAN_METRICS, type PlanData, type PlanMetric, type PlanView } from "@/lib/plan/types";
import { NoData } from "@/components/ui/EmptyState";
import { OnPlanMark } from "@/components/plan/PaceRing";
import { SectionTitle } from "@/components/plan/SectionTitle";
import { toneOfRow, type HealthTone } from "@/lib/plan/health";
import { PlanTiles } from "@/components/plan/PlanTiles";
import { PlanCharts } from "@/components/plan/PlanCharts";
import { PromoTimeline } from "@/components/plan/PromoTimeline";
import { PromoFigures } from "@/components/plan/PromoFigures";
import { TargetView } from "@/components/plan/TargetView";

const CARD =
  "flex flex-col gap-[18px] rounded-card border border-hairline bg-surface-card p-[20px_18px] shadow-sm sm:p-[24px_22px] lg:p-[24px_26px]";

const BREAKDOWN: Record<Exclude<PlanView, "target">, { title: string; unit: string }> = {
  month: { title: "By week", unit: "Week" },
  quarter: { title: "By month", unit: "Month" },
  promo: { title: "By day", unit: "Day" },
};

/** "Oct 1 to Oct 31 · day 5 of 31". */
function periodLine(p: PeriodOption, asOf: string | null): string {
  const range = fmtRange(p.start, p.end);
  if (!asOf || asOf < p.start || asOf >= p.end) return range;
  const total = daysBetween(p.start, p.end) + 1;
  return `${range} · day ${daysBetween(p.start, asOf) + 1} of ${total}`;
}

function PeriodHeading({ period, asOf, planStatus }: { period: PeriodOption; asOf: string | null; planStatus?: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="m-0 text-[20px] font-semibold leading-[1.25] tracking-heading text-content-strong">
          {period.label}
        </h2>
        <span className="text-[13px] text-content-muted">{periodLine(period, asOf)}</span>
        {planStatus === "planning" && (
          <span className="rounded-pill bg-gray-100 px-2.5 py-[3px] text-[11.5px] font-semibold text-content-muted">
            Planning
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {/* What the dot on every ring means. */}
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-content-muted">
          <OnPlanMark />
          On plan for today
        </span>
        {asOf && <span className="text-[13px] text-content-muted">Data through {fmtDay(asOf)}</span>}
      </div>
    </div>
  );
}

function PeriodView({
  data,
  view,
  period,
  asOf,
  currency,
}: {
  data: PlanData;
  view: Exclude<PlanView, "target">;
  period: PeriodOption;
  asOf: string | null;
  currency: string;
}) {
  const rows = rowsOf(data, view, period.id);
  const series = Object.fromEntries(
    PLAN_METRICS.map((m) => [m, buildSeries(data, m, period.start, period.end, rows[m])])
  ) as Record<PlanMetric, ReturnType<typeof buildSeries>>;
  const targets = Object.fromEntries(PLAN_METRICS.map((m) => [m, rows[m]?.target ?? null])) as Record<PlanMetric, number | null>;
  const bands = promoBands(data, period.start, period.end);
  const split: BreakdownRow[] = breakdown(data, view, period.start, period.end);
  const items = view === "quarter" ? timeline(data, period.start, period.end) : [];
  const planStatus = rows.orders?.planStatus ?? null;
  // The burn-up and the daily bars draw the metric in its own status colour,
  // so a tile and its chart are never two different colours for one number.
  const tones = Object.fromEntries(PLAN_METRICS.map((m) => [m, toneOfRow(rows[m])])) as Record<PlanMetric, HealthTone>;

  return (
    <>
      <PeriodHeading period={period} asOf={asOf} planStatus={planStatus} />
      <PlanTiles rows={rows} currency={currency} />

      {view === "promo" && (
        <section className={CARD} aria-label="Promo">
          <SectionTitle>Promo</SectionTitle>
          <PromoFigures data={data} period={period} rows={rows} currency={currency} />
        </section>
      )}

      <PlanCharts
        key={`${view}:${period.id}`}
        initialMetric={defaultMetric(rows)}
        series={series}
        bands={bands}
        asOf={asOf}
        currency={currency}
        targets={targets}
        breakdown={split}
        breakdownTitle={BREAKDOWN[view].title}
        unit={BREAKDOWN[view].unit}
        showStatus={view !== "promo"}
        tones={tones}
      />

      {view === "quarter" && (
        <section className={CARD} aria-label="Promos and checkpoints">
          <SectionTitle>Promos and checkpoints</SectionTitle>
          {items.length > 0 ? <PromoTimeline items={items} start={period.start} end={period.end} asOf={asOf} currency={currency} /> : <NoData />}
        </section>
      )}
    </>
  );
}

export function PlanBody({
  data,
  view,
  period,
  asOf,
  currency,
}: {
  data: PlanData;
  view: PlanView;
  period: PeriodOption | null;
  asOf: string | null;
  currency: string;
}) {
  if (!period) return <NoData />;
  if (view === "target") return <TargetView data={data} taskId={period.id} asOf={asOf} currency={currency} />;
  if (!hasAnyRow(rowsOf(data, view, period.id))) return <NoData />;
  return <PeriodView data={data} view={view} period={period} asOf={asOf} currency={currency} />;
}
