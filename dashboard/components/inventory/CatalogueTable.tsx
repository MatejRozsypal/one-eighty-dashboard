/**
 * The full SKU grid.
 *
 * Lives in a component rather than in the page because it is the evidence for
 * the decisions on the other two screens — a reader checking why something was
 * flagged should meet the same table, with the same columns in the same order,
 * whichever way they arrived.
 */

import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { DataTable } from "@/components/ui/DataTable";
import {
  formatCover,
  stockState,
  type AbcGrade,
  type InventoryRow,
} from "@/lib/inventory/model";
import { Eyebrow } from "@/components/ui/Eyebrow";

export function CatalogueTable({
  rows,
  currency,
  caption = true,
}: {
  rows: InventoryRow[];
  currency: string;
  /** The explainer under the table. Off when the page explains ABCD itself. */
  caption?: boolean;
}) {
  const money = (v: number | null) => formatMoney(v, currency);

  return (
    <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
        <Eyebrow>Catalogue · mart_sku_inventory</Eyebrow>
        <span className="text-[12px] text-content-muted">
          Click a heading to sort
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[960px]">
          <DataTable
            gridClass="grid grid-cols-[2fr_0.5fr_0.7fr_0.7fr_0.8fr_0.9fr_0.8fr_0.9fr] items-center gap-2"
            columns={[
              { key: "product", label: "Product" },
              { key: "abc", label: "ABCD" },
              { key: "units", label: "Units 90d", align: "right" },
              { key: "perDay", label: "Per day", align: "right" },
              { key: "onHand", label: "On hand", align: "right" },
              { key: "cover", label: "Cover", align: "right" },
              { key: "str", label: "Sell-thr.", align: "right" },
              { key: "value", label: "Stock value", align: "right" },
            ]}
            rows={rows.map((r) => ({
              key: r.sku + r.itemName,
              sort: [
                r.itemName,
                r.abc,
                r.unitsSold,
                r.velocityPerDay,
                r.onHand,
                r.daysCover,
                r.sellThrough,
                r.stockValueAtCost,
              ],
              cells: [
                <span className="flex min-w-0 flex-col">
                  <span
                    className="truncate text-[13px] text-content-strong"
                    title={r.itemName}
                  >
                    {r.itemName}
                  </span>
                  <span className="truncate font-mono text-[10.5px] text-content-muted">
                    {r.sku}
                    {!r.inCatalogue && " · not in catalogue"}
                    {!r.hasCost && " · no cost"}
                  </span>
                </span>,
                <GradeChip grade={r.abc} />,
                <span className="font-mono text-[12.5px] tabular text-content-body">
                  {formatNumber(r.unitsSold)}
                </span>,
                <span className="font-mono text-[12.5px] tabular text-content-muted">
                  {r.velocityPerDay > 0 ? r.velocityPerDay.toFixed(2) : "—"}
                </span>,
                <span
                  className={`font-mono text-[12.5px] tabular ${
                    r.negativeStock ? "text-negative" : "text-content-body"
                  }`}
                >
                  {r.onHand === null ? "—" : formatNumber(r.onHand)}
                </span>,
                <CoverCell row={r} />,
                <span className="font-mono text-[12.5px] tabular text-content-muted">
                  {r.sellThrough === null
                    ? "—"
                    : formatPercent(r.sellThrough, { decimals: 0 })}
                </span>,
                <span className="font-mono text-[12.5px] tabular text-content-strong">
                  {r.hasCost ? money(r.stockValueAtCost) : "—"}
                </span>,
              ],
            }))}
          />
        </div>
      </div>

      {caption && (
        <div className="px-5 py-3.5 text-[12px] leading-[1.6] text-content-muted">
          <strong className="font-semibold text-content-body">ABCD</strong> is
          ours, not Shopify&apos;s: it ranks on contribution margin over 90 days,
          where Shopify ranks on revenue over a fixed 28 and has no D grade at
          all. A/B/C are cumulative — first 80% of contribution, next 15%, the
          rest. <strong className="font-semibold text-content-body">D</strong>{" "}
          sold nothing in the window;{" "}
          <strong className="font-semibold text-content-body">U</strong> has
          under 8 weeks of history and is too new to grade.{" "}
          <strong className="font-semibold text-content-body">
            Sell-through
          </strong>{" "}
          is units sold ÷ (sold + still on hand) over the same 90 days — one of
          five definitions in circulation, so compare it only with itself.
        </div>
      )}
    </section>
  );
}

function GradeChip({ grade }: { grade: AbcGrade }) {
  if (!grade) {
    return <span className="font-mono text-[11px] text-content-muted">—</span>;
  }
  const tone =
    grade === "A"
      ? "bg-accent-soft text-growth-700"
      : grade === "D"
        ? "bg-negative/10 text-negative"
        : "bg-gray-100 text-content-body";
  return (
    <span
      className={`inline-flex h-[21px] w-[21px] items-center justify-center rounded-pill font-mono text-[11px] font-semibold ${tone}`}
    >
      {grade}
    </span>
  );
}

function CoverCell({ row }: { row: InventoryRow }) {
  if (row.daysCover === null) {
    return (
      <span className="font-mono text-[12.5px] tabular text-content-muted">
        —
      </span>
    );
  }
  const state = stockState(row);
  const tone =
    state === "at-risk"
      ? "text-negative"
      : state === "overstocked"
        ? "text-content-muted"
        : "text-content-body";
  return (
    <span className={`font-mono text-[12.5px] font-semibold tabular ${tone}`}>
      {formatCover(row.daysCover)}
    </span>
  );
}
