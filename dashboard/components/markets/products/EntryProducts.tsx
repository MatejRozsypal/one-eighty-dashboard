"use client";

/**
 * Entry products: which products bring new customers in. Per product, the
 * share of the market's first orders that contain it against the same share
 * at home, as two bars, with the count of first orders in brackets. A share
 * on fewer than `ENTRY_MIN_ORDERS` first orders is faded and says "low n",
 * never hidden. The index (market / home) is coloured like the mix map:
 * accent when the market leans on the product clearly more, warning when
 * clearly less. The rows carry every figure as text, so the bars are
 * aria-hidden and need no ChartSummary.
 */

import { formatNumber, formatPercent } from "@/lib/format";
import { formatIndex, MIX_BAND, type EntryItem } from "@/lib/markets/products";

function Bar({ share, orders, low, max, color }: { share: number; orders: number; low: boolean; max: number; color: string }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="h-2 rounded-r-xs" style={{ width: `${(share / max) * 70}%`, minWidth: 2, background: color, opacity: low ? 0.35 : 1 }} />
      <span className={`whitespace-nowrap font-mono text-[11.5px] tabular ${low ? "text-content-muted" : "text-content-body"}`}>
        {formatPercent(share)} ({formatNumber(orders)}){low ? " low n" : ""}
      </span>
    </span>
  );
}

export function EntryProducts({ items, market, home }: { items: EntryItem[]; market: string; home: string }) {
  const max = Math.max(0.0001, ...items.flatMap((i) => [i.share, i.homeShare]));
  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_56px] gap-3 pb-1.5 text-[11.5px] text-content-muted">
        <span>Product</span>
        <span>Share of first orders containing it (first orders)</span>
        <span className="text-right">Index</span>
      </div>
      <ul className="m-0 flex list-none flex-col p-0" aria-label={`Share of first orders per product, ${market} against ${home}`}>
        {items.map((it) => {
          const tone =
            it.index === null || it.index >= 1 + MIX_BAND ? "var(--text-accent)" : it.index <= 1 - MIX_BAND ? "var(--warning-700)" : "var(--text-muted)";
          return (
            <li key={it.product} className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_56px] items-center gap-3 border-t border-hairline py-2 text-[13px]">
              <span className="line-clamp-2 min-w-0 break-words leading-snug text-content-body" title={it.product}>
                {it.product}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="sr-only">{home}:</span>
                <Bar share={it.homeShare} orders={it.homeOrders} low={it.homeLow} max={max} color="var(--gray-300)" />
                <span className="sr-only">{market}:</span>
                <Bar share={it.share} orders={it.orders} low={it.low} max={max} color="var(--accent)" />
              </span>
              <span className="text-right font-mono tabular font-semibold" style={{ color: it.low || it.homeLow ? "var(--text-muted)" : tone }}>
                {it.index === null ? "new" : formatIndex(it.index)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
