/**
 * The freshness-and-honesty strip that sits at the top of every inventory page.
 *
 * Persistent, not a footnote, and repeated on all three screens rather than
 * shown once on the first: the published literature puts inventory record
 * inaccuracy at 65%, and this warehouse already shows a stale snapshot, missing
 * costs and negative stock. Somebody who lands on the Buying plan from a link
 * needs to know the count is 76 days old just as much as somebody who arrives
 * via Stock health.
 *
 * Trust erodes gradually and terminally — a reader who finds one wrong number
 * unaided stops believing the right ones.
 */

import { formatNumber, formatPercent } from "@/lib/currency";
import { safeDiv } from "@/lib/coerce";
import type { InventorySummary } from "@/lib/inventory/model";

/** Past a week, a stock count is old enough that cover figures mislead. */
const STALE_AFTER_DAYS = 7;

export function TrustBar({ summary }: { summary: InventorySummary }) {
  const costCoverage = safeDiv(summary.skusWithCost, summary.skuCount);
  const stale =
    summary.snapshotAgeDays !== null &&
    summary.snapshotAgeDays > STALE_AFTER_DAYS;

  return (
    <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-hairline bg-paper px-5 py-3.5 text-[12px] text-content-body">
      <span>
        Stock counted{" "}
        <strong className="font-semibold text-content-strong">
          {summary.snapshotDate ?? "—"}
        </strong>
        {summary.snapshotAgeDays !== null && (
          <span className={stale ? "text-negative" : "text-content-muted"}>
            {" "}
            · {formatNumber(summary.snapshotAgeDays)} days ago
          </span>
        )}
      </span>

      <span className="text-hairline-strong">·</span>

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

      <span className="text-hairline-strong">·</span>

      {/* Named, not hidden: velocity divided by calendar days understates any
          SKU that spent part of the window out of stock, and understating
          velocity is what causes the next stockout. */}
      <span className="text-content-muted">
        Velocity on calendar days — stockout days not yet excluded
      </span>
    </section>
  );
}
