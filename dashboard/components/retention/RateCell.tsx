/**
 * One rate in a table cell, with the page's display rules (design 1.11):
 * fewer than 30 customers shows n/a ("Too few customers"), an immature cell
 * shows n/a ("Matures {date}"), 30 to 99 customers shows the value with a low
 * count marker, and hover gives "k of n, 95% CI a to b".
 */

import { NO_VALUE, formatNumber, formatPercent } from "@/lib/format";
import { dayLabel, type RateView } from "@/lib/retention/model";

/** "9.5 to 15.3%" from a Wilson range. */
export function ciText(ci: { lo: number; hi: number }): string {
  return `${(ci.lo * 100).toFixed(1)} to ${formatPercent(ci.hi)}`;
}

export function rateTitle(view: RateView): string {
  return view.ci ? `${formatNumber(view.k)} of ${formatNumber(view.n)}, 95% CI ${ciText(view.ci)}` : "Too few customers";
}

export function RateCell({
  view,
  mature = true,
  maturesOn,
  strong = false,
  muted = false,
}: {
  view: RateView;
  /** False for a month that has not had the full horizon yet. */
  mature?: boolean;
  /** The cut-off date an immature month needs. */
  maturesOn?: string;
  strong?: boolean;
  /** Early rows are drawn quieter. */
  muted?: boolean;
}) {
  if (!mature) {
    return (
      <span title={maturesOn ? `Matures ${dayLabel(maturesOn)}` : "Not mature yet"} className="font-mono text-[12.5px] text-content-muted">
        {NO_VALUE}
      </span>
    );
  }
  if (view.state === "few" || view.p === null) {
    return (
      <span title="Too few customers" className="font-mono text-[12.5px] text-content-muted">
        {NO_VALUE}
      </span>
    );
  }
  const tone = muted ? "text-content-body" : strong ? "font-semibold text-content-strong" : "text-content-strong";
  return (
    <span title={rateTitle(view)} className={`font-mono text-[12.5px] tabular ${tone}`}>
      {formatPercent(view.p)}
      {view.state === "low" && (
        <span aria-label="Fewer than 100 customers" className="ml-0.5 text-warning">
          •
        </span>
      )}
    </span>
  );
}
