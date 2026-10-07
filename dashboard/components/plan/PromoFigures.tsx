/**
 * Promo view: everything one promo window can be judged on, in three rows so
 * none of it is read alone.
 *
 * Row 1, the window
 *   Attributed:   orders that used the promo mechanic, against the promo's own
 *                 target, with their share of the store. Dropped entirely when
 *                 the promo counts every order in its window (nothing to match
 *                 on, or a store wide mechanic): then there is no subset and
 *                 the figures are the whole store in the window.
 *   Whole store:  every order in the window against the window's slice of the
 *                 curve. This is the number that adds up to the month.
 *   Units:        when the promo has Target units.
 *   MER:          ad spend over plan revenue in the window, against its cap.
 *
 * Row 2, who bought
 *   New and returning customers, the code split and how many orders carried a
 *   discount, so "new customers or a discount for the existing ones" is one
 *   glance. The code split is n/a on a platform whose export has no codes.
 *
 * Row 3, what it earned
 *   Revenue, the price given away, COGS, the margin after COGS, and the whole
 *   store's CM3 over the window beside it. The promo's own ad spend and the
 *   margin after it appear only where campaigns are named on the task.
 *
 * Every figure covers the window days up to the day the data runs to, the same
 * days as the store figures next to it.
 */

import { MetricTooltip } from "@/components/dashboard/MetricTooltip";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { METRIC_DEFINITIONS } from "@/lib/metrics";
import { NO_VALUE, formatMoney } from "@/lib/format";
import { fmtCount, fmtMer, fmtPace, fmtValue } from "@/lib/plan/format";
import { promoImpact, type MetricRows, type PeriodOption } from "@/lib/plan/model";
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

/** A smaller figure for the detail rows: label over value, one line of context. */
function Detail({ label, value, sub, tip }: { label: string; value: string; sub?: string; tip?: string }) {
  const definition = tip ? METRIC_DEFINITIONS[tip] : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="relative inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
        {label}
        {definition && <MetricTooltip definition={definition} />}
      </span>
      <span
        className={`font-mono text-[15px] font-semibold leading-none tabular ${
          value === NO_VALUE ? "text-content-muted" : "text-content-strong"
        }`}
      >
        {value}
      </span>
      {sub && <span className="font-mono text-[10.5px] text-content-muted">{sub}</span>}
    </div>
  );
}

const DETAIL_GRID = "grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-5";

export function PromoFigures({
  data,
  period,
  rows,
  currency,
}: {
  data: PlanData;
  period: PeriodOption;
  rows: MetricRows;
  currency: string;
}) {
  const taskId = PLAN_METRICS.map((m) => rows[m]?.taskId).find(Boolean) ?? period.id;
  const impact = promoImpact(data, taskId);
  const { perf, task, wholeStore } = impact;
  const orders = rows.orders;
  const spend = rows.ad_spend;
  const started = orders !== undefined && orders.status !== "not_started";
  const running = started && orders.status !== "closed";
  const cap = spend?.merCapPct ?? orders?.merCapPct ?? perf?.merCapPct ?? null;
  const money = (v: number | null | undefined) => formatMoney(v ?? null, currency);

  // Costs are shown only on a fully costed set of orders: a partial sum would
  // read as the real margin.
  const costed = perf !== null && perf.attrCm1 !== null;
  const detail = started && perf !== null;
  const revenueLabel = wholeStore ? "Revenue in window" : "Attributed revenue";

  // Units: the plan's own units row when the promo has Target units (units
  // sold, judged by the warehouse), else the task's Target units against the
  // attributed units, measurable on the same terms as attributed orders.
  const unitsRow = rows.units?.target != null ? rows.units : undefined;
  const unitsTarget = unitsRow?.target ?? task?.targetUnits ?? null;
  const unitsStarted = unitsRow ? unitsRow.status !== "not_started" : started;
  const unitsActual = unitsRow
    ? unitsRow.actual
    : impact.attributed !== null
      ? (perf?.attrUnits ?? null)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {task?.mechanic && <span className="font-mono text-[11.5px] text-content-muted">{task.mechanic}</span>}
        {wholeStore && (
          <span className="rounded-pill bg-gray-100 px-2 py-[3px] font-mono text-[10.5px] uppercase tracking-[0.04em] text-content-muted">
            Whole store in the window
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
        {!wholeStore && (
          <Figure
            label="Attributed orders"
            value={started ? fmtCount(impact.attributed) : NO_VALUE}
            of={`of ${fmtCount(task?.targetOrders)}`}
            sub={impact.share !== null ? `${fmtPace(impact.share * 100)} of store orders` : undefined}
          />
        )}
        <Figure
          label="Whole store"
          value={started ? fmtCount(orders?.actual) : NO_VALUE}
          of={running ? `of ${fmtCount(orders?.targetToDate)} to date` : `of ${fmtCount(orders?.target)}`}
          sub={
            running
              ? `${fmtCount(orders?.target)} in window · pace ${fmtPace(orders?.pacePct)}`
              : started
                ? `pace ${fmtPace(orders?.pacePct)}`
                : undefined
          }
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
        <Figure
          label="MER (spend / revenue)"
          value={started ? fmtMer(spend?.merActualPct) : NO_VALUE}
          of={cap !== null ? `cap ${fmtMer(cap)}` : `plan ${fmtMer(spend?.merPlanPct)}`}
          tip="MER (spend / revenue)"
        />
      </div>

      {detail && (
        <div className="flex flex-col gap-3 border-t border-hairline pt-5">
          <Eyebrow>Who bought</Eyebrow>
          <div className={DETAIL_GRID}>
            <Detail
              label="New customers"
              value={fmtCount(perf.attrNewCustomers)}
              sub={`store ${fmtCount(perf.storeNewCustomers)}`}
            />
            <Detail
              label="Returning"
              value={fmtCount(perf.attrReturningCustomers)}
              sub={
                perf.storeOrders !== null && perf.storeNewCustomers !== null
                  ? `store ${fmtCount(perf.storeOrders - perf.storeNewCustomers)}`
                  : undefined
              }
            />
            <Detail label="With a code" value={fmtCount(impact.codeOrders)} />
            <Detail label="Without a code" value={fmtCount(impact.noCodeOrders)} />
            <Detail
              label="Discounted orders"
              value={fmtCount(perf.attrDiscountedOrders)}
              sub={`gift units ${fmtCount(perf.attrGiftUnits)}`}
            />
          </div>
        </div>
      )}

      {detail && (
        <div className="flex flex-col gap-3 border-t border-hairline pt-5">
          <Eyebrow>What it earned</Eyebrow>
          <div className={DETAIL_GRID}>
            <Detail
              label={revenueLabel}
              value={money(perf.attrRevenue)}
              sub={wholeStore ? undefined : `store ${money(perf.storeRevenue)}`}
            />
            <Detail
              label="Discount given"
              value={money(perf.attrDiscountGiven)}
              tip="Promo discount given"
            />
            <Detail label="COGS" value={costed ? money(perf.attrCogs) : NO_VALUE} />
            <Detail
              label="Margin after COGS"
              value={costed ? money(perf.attrCm1) : NO_VALUE}
              sub={costed && perf.attrCm1Pct !== null ? `${fmtPace(perf.attrCm1Pct)} of revenue` : undefined}
              tip="Margin after COGS"
            />
            {perf.attrMetaSpend !== null && (
              <Detail label="Promo ad spend" value={money(perf.attrMetaSpend)} />
            )}
            {perf.attrCm3 !== null && (
              <Detail label="Margin after ads" value={money(perf.attrCm3)} />
            )}
            <Detail
              label="Store CM3 in window"
              value={fmtValue(perf.storeCm3, "cm3", currency)}
              tip="Plan CM3"
            />
          </div>
          {!wholeStore && impact.matched.length > 0 && (
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
              {`Matched on ${impact.matched.map((m) => `${fmtCount(m.count)} ${m.label}`).join(" · ")}`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
