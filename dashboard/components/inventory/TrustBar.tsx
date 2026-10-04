/**
 * The honesty strip at the top of every inventory page.
 *
 * Persistent and repeated on all three screens: somebody who lands on the
 * Buying plan from a link needs to know the count is old just as much as
 * somebody who arrives via Stock health. A snapshot older than a week gets the
 * one allowed notice ("Stock as of {date}."); cost coverage and negative stock
 * are plain facts beside it.
 */

import { formatNumber, formatPercent } from "@/lib/currency";
import { safeDiv } from "@/lib/coerce";
import type { InventorySummary } from "@/lib/inventory/model";
import { Notice } from "@/components/ui/Notice";

/** Past a week, a stock count is old enough that cover figures mislead. */
const STALE_AFTER_DAYS = 7;

export function TrustBar({ summary }: { summary: InventorySummary }) {
  const costCoverage = safeDiv(summary.skusWithCost, summary.skuCount);
  const stale =
    summary.snapshotAgeDays !== null &&
    summary.snapshotAgeDays > STALE_AFTER_DAYS &&
    summary.snapshotDate !== null;

  return (
    <>
      {stale && <Notice tone="warning">Stock as of {summary.snapshotDate}.</Notice>}

      <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-hairline bg-paper px-5 py-3.5 text-[12px] text-content-body">
        <span>
          Cost known for{" "}
          <strong
            className={
              (costCoverage ?? 0) < 0.8
                ? "font-semibold text-negative"
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
            <span className="text-negative">
              {formatNumber(summary.negativeStockCount)} SKUs with negative stock
            </span>
          </>
        )}
      </section>
    </>
  );
}
