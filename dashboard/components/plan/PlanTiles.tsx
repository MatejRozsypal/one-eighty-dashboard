/**
 * One tile per plan metric: actual to date against target to date, with pace,
 * gap, projected end (80% range), required daily rate and the status chip.
 *
 * Same card, label and figure styles as `KpiTile`; a pacing tile carries more
 * than one figure, so it is its own component rather than a stretched KpiTile.
 *
 * Not started: the figure is the period target. Closed: actual against the
 * final target, with the result as the chip. No target for the metric in this
 * period: the actual still shows, the plan figures read n/a.
 *
 * CM3 is money. aMER is a multiple: the plan figures are ratios (pace, the gap
 * in points of the multiple), "Required" is the aMER the spend still to come
 * must return to end on target, and "Last 7 days" is the trailing reading the
 * scale rule looks at. The aMER tile always names the paid spend the ratio is
 * computed on, so a multiple is never read without knowing how much bought it.
 */

import { MetricTooltip } from "@/components/dashboard/MetricTooltip";
import { PreliminaryMark, StatusChip } from "@/components/plan/StatusChip";
import { METRIC_DEFINITIONS } from "@/lib/metrics";
import { NO_VALUE, formatMoney } from "@/lib/format";
import { METRIC_LABEL, fmtGap, fmtMer, fmtPace, fmtValue } from "@/lib/plan/format";
import { PLAN_METRICS, isRatioMetric, type PacingRow, type PlanMetric } from "@/lib/plan/types";
import type { MetricRows } from "@/lib/plan/model";

const LABEL = "font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted";

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

function PlanTile({ metric, row, currency }: { metric: PlanMetric; row: PacingRow | undefined; currency: string }) {
  const fmt = (v: number | null | undefined) => fmtValue(v, metric, currency);
  const tipKey = TILE_TIP[metric];
  const tip = tipKey ? METRIC_DEFINITIONS[tipKey] : undefined;
  const ratio = isRatioMetric(metric);

  if (!row) {
    return (
      <div className="flex min-w-0 flex-col gap-[9px] rounded-card border border-hairline bg-surface-card p-[16px_18px] shadow-sm">
        <span className={LABEL}>{METRIC_LABEL[metric]}</span>
        <span className="font-mono text-[22px] font-semibold leading-none text-content-muted">{NO_VALUE}</span>
      </div>
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

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-card border border-hairline bg-surface-card p-[16px_18px] shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className={`relative inline-flex min-w-0 items-center gap-1.5 ${LABEL}`}>
          {METRIC_LABEL[metric]}
          {tip && <MetricTooltip definition={tip} />}
        </span>
        <StatusChip row={row} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[22px] font-semibold leading-none tracking-heading tabular text-content-strong">
          <Muted>{notStarted ? fmt(row.target) : fmt(row.actual)}</Muted>
          {!notStarted && !closed && row.isPreliminary && row.actual !== null && <PreliminaryMark />}
        </span>
        <span className="text-[12px] text-content-muted">
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
          <span className="text-[11.5px] text-content-muted">
            on {formatMoney(row.ratioDenActual, currency)} spend
            {row.minSpend !== null && ` · needs ${formatMoney(row.minSpend, currency)}`}
          </span>
        )}
      </div>

      {untargeted && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-hairline pt-3 font-mono text-[11.5px]">
          <Line label="Target">
            <Muted>{fmt(row.target)}</Muted>
          </Line>
          <Line label="Pace" tip="Pace">
            <Muted>{NO_VALUE}</Muted>
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
                <span className="block text-[10.5px] text-content-muted">cap {fmtMer(row.merCapPct)}</span>
              )}
            </Line>
          )}
        </dl>
      )}

      {!notStarted && !untargeted && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-hairline pt-3 font-mono text-[11.5px]">
          <Line label="Pace" tip="Pace">
            <Muted>{fmtPace(closed && row.target ? (100 * (row.actual ?? 0)) / row.target : row.pacePct)}</Muted>
          </Line>
          <Line label="Gap">
            <Muted>{fmtGap(closed && row.target !== null && row.actual !== null ? row.actual - row.target : row.gap, metric, currency)}</Muted>
          </Line>
          {!closed && (
            <>
              <Line label="Projected" tip="Projected">
                <Muted>{fmt(row.projected)}</Muted>
                {lowHigh && <span className="block text-[10.5px] text-content-muted">{lowHigh}</span>}
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
                <span className="block text-[10.5px] text-content-muted">cap {fmtMer(row.merCapPct)}</span>
              )}
            </Line>
          )}
        </dl>
      )}

      {notStarted && !ratio && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-hairline pt-3 font-mono text-[11.5px]">
          <Line label="Per day">
            <Muted>{fmt(row.requiredDaily)}</Muted>
          </Line>
          {metric === "ad_spend" && (
            <Line label="MER plan" tip="MER (spend / revenue)">
              <Muted>{fmtMer(row.merPlanPct)}</Muted>
              {row.merCapPct !== null && (
                <span className="block text-[10.5px] text-content-muted">cap {fmtMer(row.merCapPct)}</span>
              )}
            </Line>
          )}
        </dl>
      )}
    </div>
  );
}

export function PlanTiles({ rows, currency }: { rows: MetricRows; currency: string }) {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
      {PLAN_METRICS.map((m) => (
        <PlanTile key={m} metric={m} row={rows[m]} currency={currency} />
      ))}
    </div>
  );
}
