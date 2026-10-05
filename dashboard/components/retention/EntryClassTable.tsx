/**
 * Entry products: what the first order contained and how those customers
 * behave. Every rate pools the mature, non-early customers of the class
 * (customer level), so the All row equals the Customers page tile. Fewer than
 * 30 mature customers shows n/a; hover gives k, n and the 95% range.
 */

import { InfoTip } from "@/components/ui/InfoTip";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { formatNumber, formatPercent } from "@/lib/format";
import { RETENTION_TIPS } from "@/lib/metrics";
import type { EntryLine } from "@/lib/retention/model";
import { RateCell } from "@/components/retention/RateCell";

const GRID = "grid grid-cols-[1.4fr_repeat(6,minmax(0,1fr))] items-center gap-2";
const TH = "text-right font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted";

export function EntryClassTable({ lines, earlyLeftOut }: { lines: EntryLine[]; earlyLeftOut: number }) {
  if (lines.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
        <Eyebrow>
          Entry products
          <InfoTip text={RETENTION_TIPS.entryProducts} />
        </Eyebrow>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className={`${GRID} border-b border-hairline bg-gray-50 px-5 py-3`}>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">Entry</span>
            <span className={TH}>Customers</span>
            <span className={TH}>Share</span>
            <span className={TH}>Repeat 90d</span>
            <span className={TH}>Repeat 365d</span>
            <span className={TH}>Full size 365d</span>
            <span className={TH}>3rd order 180d</span>
          </div>
          {lines.map((l) => (
            <div
              key={l.entry}
              data-row={l.entry}
              className={`${GRID} border-b border-hairline px-5 py-2.5 last:border-b-0 ${l.entry === "all" ? "bg-gray-50/60" : ""}`}
            >
              <span className={`text-[13px] ${l.entry === "all" ? "font-semibold text-content-strong" : "text-content-body"}`}>{l.label}</span>
              <span className="text-right font-mono text-[12.5px] tabular text-content-strong">{formatNumber(l.customers)}</span>
              <span className="text-right font-mono text-[12.5px] tabular text-content-body">{l.share === null ? "n/a" : formatPercent(l.share)}</span>
              <span className="text-right">
                <RateCell view={l.repeat90} strong={l.entry === "all"} />
              </span>
              <span className="text-right">
                <RateCell view={l.repeat365} strong={l.entry === "all"} />
              </span>
              <span className="text-right">
                <RateCell view={l.full365} strong={l.entry === "all"} />
              </span>
              <span className="text-right">
                <RateCell view={l.third180} strong={l.entry === "all"} />
              </span>
            </div>
          ))}
        </div>
      </div>
      <p className="border-t border-hairline px-5 py-3 text-[11.5px] text-content-muted">
        <span className="text-warning">•</span> Fewer than 100 customers.
        {earlyLeftOut > 0 && <> {formatNumber(earlyLeftOut)} customers from the first months of data are left out.</>}
      </p>
    </section>
  );
}
