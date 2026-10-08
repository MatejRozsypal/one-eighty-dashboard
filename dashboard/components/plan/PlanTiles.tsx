/**
 * One tile per plan metric: actual to date against target to date, the goal
 * ring, and the plan figures underneath (gap, projected end with its 80%
 * range, the required daily rate, MER).
 *
 * The label takes the status colour, and the status word sits bottom left above
 * a hairline with the pace beside it, so the tile answers "how is this going"
 * from the top line and the bottom line alike. The pace reads once, in the
 * footer, because the ring is already drawing it.
 *
 * Not started: the figure is the period target. Closed: actual against the
 * final target, with the result as the status. No target for the metric in this
 * period: the actual still shows, the plan figures read n/a.
 *
 * CM3 is money. aMER is a multiple: the plan figures are ratios (the gap in
 * points of the multiple), "Required" is the aMER the spend still to come must
 * return to end on target, and "Last 7 days" is the trailing reading the scale
 * rule looks at. The aMER tile always names the paid spend the ratio is
 * computed on, so a multiple is never read without knowing how much bought it.
 */

import { MetricTooltip } from "@/components/dashboard/MetricTooltip";
import { GoalRing } from "@/components/plan/GoalRing";
import { PreliminaryMark } from "@/components/plan/StatusChip";
import { METRIC_DEFINITIONS } from "@/lib/metrics";
import { NO_VALUE, formatMoney } from "@/lib/format";
import { planStatusLabel, toneOfRow, toneVars } from "@/lib/plan/health";
import { METRIC_LABEL, fmtGap, fmtMer, fmtPace, fmtValue } from "@/lib/plan/format";
import { PLAN_METRICS, isRatioMetric, type PacingRow, type PlanMetric } from "@/lib/plan/types";
import type { MetricRows } from "@/lib/plan/model";

const FIGURE = "text-[32px] font-bold leading-[1.05] tracking-heading tabular text-content-strong";
const CAPTION = "text-[13px] leading-[1.35] text-content-muted";

/** Tooltip per tile; metrics without an entry fall back to none. */
const TILE_TIP: Partial<Record<PlanMetric, string>> = {
  revenue: "Plan revenue",
  cm3: "Plan CM3",
  amer: "Plan aMER",
};

function Line({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  const definition = tip ? METRIC_DEFINITIONS[tip] : undefined;
  return (
    <>
      <dt className="inline-flex items-center gap-1 text-content-muted">
        {label}
        {definition && <MetricTooltip definition={definition} />}
      </dt>
      <dd className="text-right tabular text-content-strong">{children}</dd>
    </>
  );
}

function Muted({ children }: { children: string }) {
  return children === NO_VALUE ? <span className="text-content-muted">{children}</span> : <>{children}</>;
}

const CARD =
  "flex min-w-0 flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[18px] shadow-sm sm:p-[22px]";
const DETAILS = "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-hairline pt-3.5 text-[12.5px]";

function PlanTile({ metric, row, currency }: { metric: PlanMetric; row: PacingRow | undefined; currency: string }) {
  const fmt = (v: number | null | undefined) => fmtValue(v, metric, currency);
  const tipKey = TILE_TIP[metric];
  const tip = tipKey ? METRIC_DEFINITIONS[tipKey] : undefined;
  const ratio = isRatioMetric(metric);
  const colour = toneVars(toneOfRow(row));

  if (!row) {
    return (
      <article className={CARD}>
        <span className="text-[13px] font-semibold text-content-muted">{METRIC_LABEL[metric]}</span>
        <span className={`${FIGURE} text-content-muted`}>{NO_VALUE}</span>
      </article>
    );
  }

  const untargeted =
    row.status === "no_target" || row.status === "not_measured" || (row.target === null && row.status !== "not_started");
  const notStarted = row.status === "not_started" && !untargeted;
  const closed = row.status === "closed";
  const lowHigh =
    row.projectedLow !== null && row.projectedHigh !== null
      ? `${fmtValue(row.projectedLow, metric, currency)} to ${fmtValue(row.projectedHigh, metric, currency)}`
      : null;

  // Pace, for the footer. A closed period is paced against its final target;
  // the warehouse's own pace stops at the as-of day. The ring does not use
  // this: it divides by the period total, not by the plan to date, which is
  // why the two percentages on the tile differ and why each one says so.
  const pacePct =
    untargeted || notStarted
      ? null
      : closed && row.target
        ? (100 * (row.actual ?? 0)) / row.target
        : row.pacePct;
  const paceText = fmtPace(pacePct);

  return (
    <article className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span
            style={{ color: colour.text }}
            className="relative inline-flex min-w-0 items-center gap-1.5 text-[13px] font-semibold leading-[1.35]"
          >
            {METRIC_LABEL[metric]}
            {tip && <MetricTooltip definition={tip} />}
          </span>
          <span className={`mt-[10px] ${FIGURE}`}>
            <Muted>{notStarted ? fmt(row.target) : fmt(row.actual)}</Muted>
            {!notStarted && !closed && row.isPreliminary && row.actual !== null && <PreliminaryMark />}
          </span>
          <span className={`mt-[3px] ${CAPTION}`}>
            {untargeted
              ? row.status === "not_measured" && row.target !== null
                ? `Target ${fmt(row.target)}`
                : "To date"
              : notStarted
                ? "Target"
                : closed
                  ? `of ${fmt(row.target)}`
                  : `of ${fmt(row.targetToDate)} to date · ${fmt(row.target)} ${ratio ? "period" : "total"}`}
          </span>
          {ratio && !notStarted && row.ratioDenActual !== null && (
            <span className={`mt-[2px] ${CAPTION}`}>
              on {formatMoney(row.ratioDenActual, currency)} spend
              {row.minSpend !== null && ` · needs ${formatMoney(row.minSpend, currency)}`}
            </span>
          )}
        </div>

        <GoalRing row={row} periodType={row.periodType} tone={toneOfRow(row)} />
      </div>

      {untargeted && (
        <dl className={DETAILS}>
          <Line label="Target">
            <Muted>{fmt(row.target)}</Muted>
          </Line>
          <Line label="Gap">
            <Muted>{NO_VALUE}</Muted>
          </Line>
          <Line label="Projected" tip="Projected">
            <Muted>{NO_VALUE}</Muted>
          </Line>
          {metric === "ad_spend" && (
            <Line label="MER" tip="MER (spend / revenue)">
              <Muted>{fmtMer(row.merActualPct)}</Muted>
              {row.merCapPct !== null && (
                <span className="block text-[11px] text-content-muted">cap {fmtMer(row.merCapPct)}</span>
              )}
            </Line>
          )}
        </dl>
      )}

      {!notStarted && !untargeted && (
        <dl className={DETAILS}>
          <Line label="Gap">
            <Muted>
              {fmtGap(
                closed && row.target !== null && row.actual !== null ? row.actual - row.target : row.gap,
                metric,
                currency
              )}
            </Muted>
          </Line>
          {!closed && (
            <>
              <Line label="Projected" tip="Projected">
                <Muted>{fmt(row.projected)}</Muted>
                {lowHigh && <span className="block text-[11px] text-content-muted">{lowHigh}</span>}
              </Line>
              {ratio ? (
                <>
                  <Line label="Required" tip="Required aMER">
                    <Muted>{fmt(row.requiredRatio)}</Muted>
                  </Line>
                  <Line label="Last 7 days">
                    <Muted>{fmt(row.trailing7dRatio)}</Muted>
                  </Line>
                </>
              ) : (
                <Line label="Required / day" tip="Required / day">
                  <Muted>{fmt(row.requiredDaily)}</Muted>
                </Line>
              )}
            </>
          )}
          {metric === "ad_spend" && (
            <Line label="MER" tip="MER (spend / revenue)">
              <Muted>{fmtMer(row.merActualPct)}</Muted>
              {row.merCapPct !== null && (
                <span className="block text-[11px] text-content-muted">cap {fmtMer(row.merCapPct)}</span>
              )}
            </Line>
          )}
        </dl>
      )}

      {notStarted && !ratio && (
        <dl className={DETAILS}>
          <Line label="Per day">
            <Muted>{fmt(row.requiredDaily)}</Muted>
          </Line>
          {metric === "ad_spend" && (
            <Line label="MER plan" tip="MER (spend / revenue)">
              <Muted>{fmtMer(row.merPlanPct)}</Muted>
              {row.merCapPct !== null && (
                <span className="block text-[11px] text-content-muted">cap {fmtMer(row.merCapPct)}</span>
              )}
            </Line>
          )}
        </dl>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-hairline pt-3.5">
        <span style={{ color: colour.text }} className="text-[13px] font-semibold leading-[1.35]">
          {planStatusLabel(row)}
          {row.isTooEarly && <span className="sr-only"> (too early to call)</span>}
        </span>
        <span className={`inline-flex items-center gap-1 tabular ${CAPTION}`}>
          {paceText === NO_VALUE ? NO_VALUE : `${paceText} of plan`}
          <MetricTooltip definition={METRIC_DEFINITIONS["Pace"]} />
        </span>
      </div>
    </article>
  );
}

export function PlanTiles({ rows, currency }: { rows: MetricRows; currency: string }) {
  return (
    <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-3">
      {PLAN_METRICS.map((m) => (
        <PlanTile key={m} metric={m} row={rows[m]} currency={currency} />
      ))}
    </div>
  );
}
