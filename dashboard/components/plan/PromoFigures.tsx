/**
 * Promo view: the figures that only a promo window has, always shown together
 * so none is read alone.
 *
 *   Attributed:   orders that used the promo mechanic, against the promo's
 *                 own target (n/a until both exist, and n/a while the task
 *                 names no code, SKU or UTM its mechanic needs).
 *   Mechanic:     the task's Mechanic field.
 *   Whole store:  every order in the window, against the window's slice of
 *                 the curve. This is the number that adds up to the month.
 *   Units:        when the promo has Target units: units sold against it.
 *   Lift:         against a no-promo baseline. Not measured yet: n/a.
 *   MER:          ad spend over plan revenue in the window, against its cap.
 */

import { MetricTooltip } from "@/components/dashboard/MetricTooltip";
import { METRIC_DEFINITIONS } from "@/lib/metrics";
import { NO_VALUE } from "@/lib/format";
import { fmtCount, fmtMer, fmtPace } from "@/lib/plan/format";
import { attributedOrders, promoPerfOf, taskOf, type MetricRows, type PeriodOption } from "@/lib/plan/model";
import { PLAN_METRICS, type PacingRow } from "@/lib/plan/types";
import { StatusChip } from "@/components/plan/StatusChip";
import type { PlanData } from "@/lib/plan/types";

function Figure({
  label,
  value,
  of,
  sub,
  tip,
  chip,
}: {
  label: string;
  value: string;
  of?: string;
  sub?: string;
  tip?: string;
  /** A pacing row whose status chip sits beside the label. */
  chip?: PacingRow;
}) {
  const definition = tip ? METRIC_DEFINITIONS[tip] : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="relative inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
        {label}
        {definition && <MetricTooltip definition={definition} />}
        {chip && <StatusChip row={chip} className="ml-1" />}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span
          className={`font-mono text-[20px] font-semibold leading-none tracking-heading tabular ${
            value === NO_VALUE ? "text-content-muted" : "text-content-strong"
          }`}
        >
          {value}
        </span>
        {of && <span className="text-[12px] text-content-muted">{of}</span>}
      </span>
      {sub && <span className="font-mono text-[11px] text-content-muted">{sub}</span>}
    </div>
  );
}

export function PromoFigures({
  data,
  period,
  rows,
}: {
  data: PlanData;
  period: PeriodOption;
  rows: MetricRows;
  currency: string;
}) {
  const taskId = PLAN_METRICS.map((m) => rows[m]?.taskId).find(Boolean) ?? period.id;
  const perf = promoPerfOf(data, taskId);
  const task = taskOf(data, taskId);
  const attributed = attributedOrders(data, taskId);
  const orders = rows.orders;
  const spend = rows.ad_spend;
  const started = orders !== undefined && orders.status !== "not_started";
  const running = started && orders.status !== "closed";
  const cap = spend?.merCapPct ?? orders?.merCapPct ?? perf?.merCapPct ?? null;
  const attrShare = attributed !== null && perf?.storeOrders ? attributed / perf.storeOrders : null;

  // Units: the plan's own units row when the promo has Target units (units
  // sold, judged by the warehouse), else the task's Target units against the
  // attributed units, measurable on the same terms as attributed orders.
  const unitsRow = rows.units?.target != null ? rows.units : undefined;
  const unitsTarget = unitsRow?.target ?? task?.targetUnits ?? null;
  const unitsStarted = unitsRow ? unitsRow.status !== "not_started" : started;
  const unitsActual = unitsRow ? unitsRow.actual : attributed !== null ? (perf?.attrUnits ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      {task?.mechanic && <span className="font-mono text-[11.5px] text-content-muted">{task.mechanic}</span>}
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
        <Figure
          label="Attributed orders"
          value={started ? fmtCount(attributed) : NO_VALUE}
          of={`of ${fmtCount(task?.targetOrders)}`}
          sub={attrShare !== null ? `${fmtPace(attrShare * 100)} of store orders` : undefined}
        />
        <Figure
          label="Whole store"
          value={started ? fmtCount(orders?.actual) : NO_VALUE}
          of={running ? `of ${fmtCount(orders?.targetToDate)} to date` : `of ${fmtCount(orders?.target)}`}
          sub={running ? `${fmtCount(orders?.target)} in window · pace ${fmtPace(orders?.pacePct)}` : started ? `pace ${fmtPace(orders?.pacePct)}` : undefined}
          tip="Pace"
        />
        {unitsTarget !== null && (
          <Figure
            label="Units"
            value={unitsStarted ? fmtCount(unitsActual) : NO_VALUE}
            of={`of ${fmtCount(unitsTarget)}`}
            sub={unitsRow && unitsStarted ? `pace ${fmtPace(unitsRow.pacePct)}` : undefined}
            chip={unitsRow}
          />
        )}
        <Figure label="Lift vs baseline" value={NO_VALUE} />
        <Figure
          label="MER (spend / revenue)"
          value={started ? fmtMer(spend?.merActualPct) : NO_VALUE}
          of={cap !== null ? `cap ${fmtMer(cap)}` : `plan ${fmtMer(spend?.merPlanPct)}`}
          tip="MER (spend / revenue)"
        />
      </div>
    </div>
  );
}
