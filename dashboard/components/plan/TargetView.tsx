/**
 * Target view: where the business is heading against the target state.
 *
 * Tiles: the goal (monthly revenue run-rate by the due date), the run-rate it
 * started from, the constant monthly growth that joins the two, and the last
 * closed month against the trajectory. Then the trajectory chart and the
 * months one by one. The trajectory formula lives in `targetTrajectory`.
 */

import { NoData } from "@/components/ui/EmptyState";
import { SectionTitle } from "@/components/plan/SectionTitle";
import { BreakdownTable } from "@/components/plan/BreakdownTable";
import { TrajectoryChart } from "@/components/plan/TrajectoryChart";
import { formatMoney, formatPercent } from "@/lib/format";
import { fmtDay, fmtMonth } from "@/lib/plan/dates";
import { breakdown, targetTrajectory, taskOf } from "@/lib/plan/model";
import type { PlanData } from "@/lib/plan/types";

const CARD =
  "flex flex-col gap-[18px] rounded-card border border-hairline bg-surface-card p-[20px_18px] shadow-sm sm:p-[24px_22px] lg:p-[24px_26px]";

/**
 * A plain figure tile, in the same language as the pacing tiles but without a
 * ring: none of these four is a pace, so none of them has one to draw.
 */
function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <article className="flex min-w-0 flex-col gap-2.5 rounded-card border border-hairline bg-surface-card p-[18px] shadow-sm">
      <span className="text-[13px] font-semibold leading-[1.35] text-content-muted">{label}</span>
      <span className="text-[26px] font-bold leading-[1.05] tracking-heading tabular text-content-strong">{value}</span>
    </article>
  );
}

export function TargetView({
  data,
  taskId,
  asOf,
  currency,
}: {
  data: PlanData;
  taskId: string;
  asOf: string | null;
  currency: string;
}) {
  const task = taskOf(data, taskId);
  if (!task || !task.start || !task.end) return <NoData />;

  const t = targetTrajectory(data, task);
  const lastClosed = [...t.points].reverse().find((p) => p.actual !== null && p.trajectory !== null) ?? null;
  const vsTrajectory = lastClosed && lastClosed.trajectory ? lastClosed.actual! / lastClosed.trajectory : null;
  const months = breakdown(data, "target", task.start, task.end);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="m-0 text-[20px] font-semibold leading-[1.25] tracking-heading text-content-strong">
            {task.name}
          </h2>
          <span className="text-[13px] text-content-muted">
            {fmtMonth(task.start)} to {fmtMonth(task.end)}
          </span>
        </div>
        {asOf && <span className="text-[13px] text-content-muted">Data through {fmtDay(asOf)}</span>}
      </div>

      <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Goal per month" value={formatMoney(t.goal, currency)} />
        <StatTile label="Start per month" value={formatMoney(t.startValue, currency)} />
        <StatTile label="Growth per month" value={formatPercent(t.growth)} />
        <StatTile
          label={lastClosed ? `${fmtMonth(lastClosed.month)} vs line` : "Last month vs line"}
          value={formatPercent(vsTrajectory)}
        />
      </div>

      <section className={CARD} aria-label="Trajectory">
        <SectionTitle>Trajectory</SectionTitle>
        {t.points.length > 0 ? <TrajectoryChart points={t.points} goal={t.goal} currency={currency} /> : <NoData />}
      </section>

      <section className={CARD} aria-label="By month">
        <SectionTitle>By month</SectionTitle>
        {months.length > 0 ? (
          <BreakdownTable rows={months} metric="revenue" currency={currency} unit="Month" showStatus />
        ) : (
          <NoData />
        )}
      </section>
    </>
  );
}
