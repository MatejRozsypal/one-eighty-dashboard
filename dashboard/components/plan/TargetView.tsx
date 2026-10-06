/**
 * Target view: where the business is heading against the target state.
 *
 * Tiles: the goal (monthly revenue run-rate by the due date), the run-rate it
 * started from, the constant monthly growth that joins the two, and the last
 * closed month against the trajectory. Then the trajectory chart and the
 * months one by one. The trajectory formula lives in `targetTrajectory`.
 */

import { KpiTile } from "@/components/dashboard/KpiTile";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { NoData } from "@/components/ui/EmptyState";
import { BreakdownTable } from "@/components/plan/BreakdownTable";
import { TrajectoryChart } from "@/components/plan/TrajectoryChart";
import { formatMoney, formatPercent } from "@/lib/format";
import { fmtDay, fmtMonth } from "@/lib/plan/dates";
import { breakdown, targetTrajectory, taskOf } from "@/lib/plan/model";
import type { PlanData } from "@/lib/plan/types";

const CARD = "flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]";

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
          <h2 className="m-0 text-[17px] font-bold tracking-heading text-content-strong">{task.name}</h2>
          <span className="font-mono text-[11.5px] text-content-muted">
            {fmtMonth(task.start)} to {fmtMonth(task.end)}
          </span>
        </div>
        {asOf && <span className="font-mono text-[11.5px] text-content-muted">Data through {fmtDay(asOf)}</span>}
      </div>

      <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiTile label="Goal per month" value={formatMoney(t.goal, currency)} />
        <KpiTile label="Start per month" value={formatMoney(t.startValue, currency)} />
        <KpiTile label="Growth per month" value={formatPercent(t.growth)} />
        <KpiTile
          label={lastClosed ? `${fmtMonth(lastClosed.month)} vs line` : "Last month vs line"}
          value={formatPercent(vsTrajectory)}
        />
      </div>

      <section className={CARD} aria-label="Trajectory">
        <Eyebrow>Trajectory</Eyebrow>
        {t.points.length > 0 ? <TrajectoryChart points={t.points} goal={t.goal} currency={currency} /> : <NoData />}
      </section>

      <section className={CARD} aria-label="By month">
        <Eyebrow>By month</Eyebrow>
        {months.length > 0 ? (
          <BreakdownTable rows={months} metric="revenue" currency={currency} unit="Month" showStatus />
        ) : (
          <NoData />
        )}
      </section>
    </>
  );
}
