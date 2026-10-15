"use client";

/**
 * What each market buys differently from home: per market, the products whose
 * share of net sales differs most from their share at home, in percentage
 * points, drawn as bars either side of a zero line (right: bought more than at
 * home, left: less). The bars are decoration (aria-hidden): the list itself
 * carries every figure as text, so it needs no ChartSummary.
 */

import { NaValue } from "@/components/markets/bits";
import { formatPercent } from "@/lib/format";
import { countryName } from "@/lib/markets/display";
import { formatPp, MIN_SHARE, type DiffItem, type ProductsModel } from "@/lib/markets/products";

export { formatPp };

function MarketDiff({ market, home, items }: { market: string; home: string; items: DiffItem[] }) {
  const max = Math.max(0.0001, ...items.map((i) => Math.abs(i.diff)));
  if (items.length === 0) {
    return <p className="m-0 text-[13px] text-content-muted">No product above {formatPercent(MIN_SHARE, { decimals: 0 })} of either market.</p>;
  }
  return (
    <ul aria-label={`Share of net sales in ${market} minus share in ${home}, by product`} className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((it) => {
        const w = `${(Math.abs(it.diff) / max) * 50}%`;
        return (
          <li key={it.product} className="grid grid-cols-[minmax(0,1fr)_minmax(64px,32%)_auto] items-center gap-3 text-[13px]">
            <span className="min-w-0">
              <span className="block truncate text-content-body" title={it.product}>
                {it.product}
              </span>
              <span className="block font-mono text-[11px] tabular text-content-muted">
                {formatPercent(it.share)} vs {formatPercent(it.homeShare)} in {home}
              </span>
            </span>
            <span aria-hidden="true" className="relative h-2.5">
              <span className="absolute inset-y-[-3px] left-1/2 w-px bg-hairline-strong" />
              <span
                className={`absolute inset-y-0 rounded-xs ${it.diff >= 0 ? "bg-accent" : "bg-gray-250"}`}
                style={it.diff >= 0 ? { left: "50%", width: w } : { right: "50%", width: w }}
              />
            </span>
            <span className="w-[64px] text-right font-mono tabular text-content-strong">{formatPp(it.diff)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function DiffersMost({ model }: { model: ProductsModel }) {
  const home = model.homeMarket;
  const entries = Object.entries(model.differs);
  if (entries.length === 0) return null;
  return (
    <div className={`grid gap-x-8 gap-y-5 ${entries.length > 1 ? "xl:grid-cols-2" : ""}`}>
      {entries.map(([market, res]) => (
        <section key={market} className="flex min-w-0 flex-col gap-2.5">
          <h3 className="m-0 text-[13px] font-semibold text-content-strong">
            {countryName(market)} vs {countryName(home)}
          </h3>
          {"na" in res ? (
            <span className="text-[13px]">
              <NaValue reason={res.na} />
            </span>
          ) : (
            <MarketDiff market={market} home={home} items={res.items} />
          )}
        </section>
      ))}
    </div>
  );
}
