"use client";

/**
 * The period split one level down (quarter by month, month by ISO week, promo
 * by day, target by month), for the metric picked above the charts: target,
 * actual, gap, pace and status per row. Days carry no status (one day is
 * noise), so the column is dropped for them.
 */

import { NO_VALUE } from "@/lib/format";
import { fmtGap, fmtPace, fmtValue } from "@/lib/plan/format";
import type { BreakdownRow } from "@/lib/plan/model";
import type { PlanMetric } from "@/lib/plan/types";
import { PreliminaryMark, StatusChip } from "@/components/plan/StatusChip";

const TH = "px-3 py-2.5 font-mono text-[10.5px] font-normal uppercase tracking-[0.08em] text-content-muted";

function Cell({ text, strong = false }: { text: string; strong?: boolean }) {
  return (
    <span className={text === NO_VALUE ? "text-content-muted" : strong ? "text-content-strong" : "text-content-body"}>
      {text}
    </span>
  );
}

export function BreakdownTable({
  rows,
  metric,
  currency,
  unit,
  showStatus,
}: {
  rows: BreakdownRow[];
  metric: PlanMetric;
  currency: string;
  /** Heading of the first column: Month, Week, Day. */
  unit: string;
  showStatus: boolean;
}) {
  const fmt = (v: number | null | undefined) => fmtValue(v, metric, currency);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-hairline bg-gray-50">
            <th scope="col" className={`${TH} text-left`}>{unit}</th>
            <th scope="col" className={`${TH} text-right`}>Target</th>
            <th scope="col" className={`${TH} text-right`}>Actual</th>
            <th scope="col" className={`${TH} text-right`}>Gap</th>
            <th scope="col" className={`${TH} text-right`}>Pace</th>
            {showStatus && <th scope="col" className={`${TH} text-right`}>Status</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const row = r.byMetric[metric];
            const started = row && row.status !== "not_started";
            return (
              <tr key={r.id} className={`border-b border-hairline last:border-b-0 ${r.current ? "bg-gray-50" : ""}`}>
                <th scope="row" className="px-3 py-2.5 text-left font-normal">
                  <span className="text-content-strong">{r.label}</span>
                  {r.sub && <span className="ml-2 font-mono text-[11px] text-content-muted">{r.sub}</span>}
                </th>
                <td className="px-3 py-2.5 text-right tabular">
                  <Cell text={fmt(row?.target)} />
                </td>
                <td className="px-3 py-2.5 text-right tabular">
                  <Cell text={started ? fmt(row?.actual) : NO_VALUE} strong />
                  {started && row?.isPreliminary && <PreliminaryMark />}
                </td>
                <td className="px-3 py-2.5 text-right tabular">
                  <Cell text={started ? fmtGap(row?.gap, metric, currency) : NO_VALUE} />
                </td>
                <td className="px-3 py-2.5 text-right tabular">
                  <Cell text={started ? fmtPace(row?.pacePct) : NO_VALUE} />
                </td>
                {showStatus && (
                  <td className="px-3 py-2.5 text-right">{row ? <StatusChip row={row} /> : <Cell text={NO_VALUE} />}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
