/**
 * The honesty strip at the top of every inventory page.
 *
 * Persistent and repeated on all three screens: somebody who lands on the
 * Buying plan from a link needs to know the count is old just as much as
 * somebody who arrives via Stock health. A snapshot older than a week gets the
 * one allowed notice ("Stock as of {date}."); cost coverage and negative stock
 * are plain facts beside it. Past 30 days the same single notice also says the
 * buying suggestions are off (Stock health and Buying plan hide them).
 */

import { formatNumber, formatPercent } from "@/lib/currency";
import { safeDiv } from "@/lib/coerce";
import {
  snapshotTooOldForBuying,
  STALE_ACTIONS_AFTER_DAYS,
  type InventorySummary,
} from "@/lib/inventory/model";
import { Notice } from "@/components/ui/Notice";

/** Past a week, a stock count is old enough that cover figures mislead. */
const STALE_AFTER_DAYS = 7;

export function TrustBar({ summary }: { summary: InventorySummary }) {
  const costCoverage = safeDiv(summary.skusWithCost, summary.skuCount);
  const stale =
    summary.snapshotAgeDays !== null &&
    summary.snapshotAgeDays > STALE_AFTER_DAYS &&
    summary.snapshotDate !== null;

  const buyingOff = snapshotTooOldForBuying(summary);

  return (
    <>
      {stale && (
        <Notice tone="warning">
          Stock as of {summary.snapshotDate}.
          {buyingOff &&
            ` Buying suggestions off: over ${STALE_ACTIONS_AFTER_DAYS} days old.`}
        </Notice>
      )}

      <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-hairline bg-paper px-5 py-3.5 text-[12px] text-content-body">
        <span>
          Cost known for{" "}
          <strong
            className={
              (costCoverage ?? 0) < 0.8
                ? "font-semibold text-negative-text"
                : "font-semibold text-content-strong"
            }
          >
            {formatPercent(costCoverage, { decimals: 0 })}
          </strong>{" "}
          of SKUs
        </span>

        {summary.negativeStockCount > 0 && (
          <>
            <span className="text-hairline-strong">·</span>
            <span className="text-negative-text">
              {formatNumber(summary.negativeStockCount)} SKUs with negative stock
            </span>
          </>
        )}
      </section>
    </>
  );
}
