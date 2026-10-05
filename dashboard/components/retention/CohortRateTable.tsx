/**
 * Cohort table: one row per first-order month, one column per horizon.
 *
 * Two pooled rows sit on top, non-early only. "Last 6" pools, per column, the
 * last 6 months that are fully mature for that horizon. "All mature" pools
 * every customer whose own first order has had the horizon (the same rule as
 * the Customers page). A month cell shows once every customer in the month has
 * had the horizon; before that it reads n/a with "Matures {date}". Months from
 * the first months of data carry an Early badge and stay out of both pooled rows.
 */

import type { ReactNode } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { formatNumber } from "@/lib/format";
import { RETENTION_TIPS } from "@/lib/metrics";
import { HORIZONS, monthLabel, type CohortTable } from "@/lib/retention/model";
import { RateCell } from "@/components/retention/RateCell";

const GRID = "grid grid-cols-[1.5fr_0.9fr_repeat(5,minmax(0,1fr))] items-center gap-2";

export function CohortRateTable({ table, control }: { table: CohortTable; control?: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
        <Eyebrow>
          Cohorts
          <InfoTip text={RETENTION_TIPS.cohorts} />
        </Eyebrow>
        {control}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          <div className={`${GRID} border-b border-hairline bg-gray-50 px-5 py-3`}>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">Cohort</span>
            <span className="text-right font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">Entrants</span>
            {HORIZONS.map((h) => (
              <span key={h} className="text-right font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                {h}d
              </span>
            ))}
          </div>

          {table.summary.map((s) => (
            <div key={s.label} data-row={s.label} className={`${GRID} border-b border-hairline bg-gray-50/60 px-5 py-3`}>
              <span className="text-[13px] font-semibold text-content-strong">{s.label}</span>
              <span className="text-right font-mono text-[12.5px] tabular text-content-strong">{formatNumber(s.entrants)}</span>
              {HORIZONS.map((h) => (
                <span key={h} className="text-right">
                  <RateCell view={s.cells[h]} strong />
                </span>
              ))}
            </div>
          ))}

          {table.lines.map((l) => (
            <div key={l.month} data-row={l.month} className={`${GRID} border-b border-hairline px-5 py-2.5 last:border-b-0`}>
              <span className="flex items-center gap-2 text-[13px] text-content-body">
                <span title={l.earlyLeftOut > 0 ? `${formatNumber(l.earlyLeftOut)} customers from the first months of data are left out.` : undefined}>
                  {monthLabel(l.month)}
                  {l.earlyLeftOut > 0 && <span aria-hidden="true" className="text-content-muted"> *</span>}
                </span>
                {l.early && (
                  <span
                    title={RETENTION_TIPS.early}
                    className="rounded-pill border border-hairline-strong px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.06em] text-content-muted"
                  >
                    Early
                  </span>
                )}
              </span>
              <span className="text-right font-mono text-[12.5px] tabular text-content-body">{formatNumber(l.entrants)}</span>
              {HORIZONS.map((h) => (
                <span key={h} className="text-right">
                  <RateCell view={l.cells[h]} mature={l.cells[h].mature} maturesOn={l.cells[h].maturesOn} muted={l.early} />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <p className="border-t border-hairline px-5 py-3 text-[11.5px] text-content-muted">
        <span className="text-warning">•</span> Fewer than 100 customers.
      </p>
    </section>
  );
}
