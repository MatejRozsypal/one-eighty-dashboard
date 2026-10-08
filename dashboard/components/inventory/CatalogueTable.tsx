/**
 * The full SKU grid.
 *
 * Lives in a component rather than in the page because it is the evidence for
 * the decisions on the other two screens, a reader checking why something was
 * flagged should meet the same table, with the same columns in the same order,
 * whichever way they arrived.
 */

import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { DataTable } from "@/components/ui/DataTable";
import { NoValue, Value } from "@/components/ui/EmptyState";
import { NO_VALUE } from "@/lib/format";
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
}: {
  rows: InventoryRow[];
  currency: string;
}) {
  const money = (v: number | null) => formatMoney(v, currency);

  return (
    <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
      <div className="border-b border-hairline px-5 py-4">
        <Eyebrow>Catalogue</Eyebrow>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[960px]">
          <DataTable
            gridClass="grid grid-cols-[2fr_0.5fr_0.7fr_0.7fr_0.8fr_0.9fr_0.8fr_0.9fr] items-center gap-2"
            columns={[
              { key: "product", label: "Product" },
              {
                key: "abc",
                label: "ABCD",
                info: "Ranked on contribution margin over 90 days. A is the first 80%, B the next 15%, C the rest. D sold nothing. U has under 8 weeks of history.",
              },
              { key: "units", label: "Units 90d", align: "right" },
              { key: "perDay", label: "Per day", align: "right" },
              { key: "onHand", label: "On hand", align: "right" },
              { key: "cover", label: "Cover", align: "right" },
              {
                key: "str",
                label: "Sell-thr.",
                align: "right",
                info: "Units sold divided by units sold plus on hand, over 90 days.",
              },
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
                  <Value>
                    {r.velocityPerDay > 0 ? r.velocityPerDay.toFixed(2) : NO_VALUE}
                  </Value>
                </span>,
                <span
                  className={`font-mono text-[12.5px] tabular ${
                    r.negativeStock ? "text-negative-text" : "text-content-body"
                  }`}
                >
                  <Value>{formatNumber(r.onHand)}</Value>
                </span>,
                <CoverCell row={r} />,
                <span className="font-mono text-[12.5px] tabular text-content-muted">
                  <Value>{formatPercent(r.sellThrough, { decimals: 0 })}</Value>
                </span>,
                <span className="font-mono text-[12.5px] tabular text-content-strong">
                  <Value>{r.hasCost ? money(r.stockValueAtCost) : NO_VALUE}</Value>
                </span>,
              ],
            }))}
          />
        </div>
      </div>

    </section>
  );
}

function GradeChip({ grade }: { grade: AbcGrade }) {
  if (!grade) {
    return <NoValue />;
  }
  const tone =
    grade === "A"
      ? "bg-accent-soft text-growth-700"
      : grade === "D"
        ? "bg-negative/10 text-negative-700"
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
    return <NoValue />;
  }
  const state = stockState(row);
  const tone =
    state === "at-risk"
      ? "text-negative-text"
      : state === "overstocked"
        ? "text-content-muted"
        : "text-content-body";
  return (
    <span className={`font-mono text-[12.5px] font-semibold tabular ${tone}`}>
      {formatCover(row.daysCover)}
    </span>
  );
}
