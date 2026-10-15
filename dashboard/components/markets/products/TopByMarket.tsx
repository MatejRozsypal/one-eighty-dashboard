"use client";

/**
 * Per market, its five best sellers by net sales: share of the market, a bar
 * scaled to the market's top product, and the change in share against the
 * comparison period (percentage points in either delta mode; a share has no
 * better direction, so the chip is neutral). A product that was not in the
 * comparison's top five says so.
 */

import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DeltaChip } from "@/components/ui/Delta";
import { InfoTip } from "@/components/ui/InfoTip";
import { formatMoney, formatPercent } from "@/lib/format";
import { MARKET_OTHER } from "@/lib/markets/types";
import { countryName } from "@/lib/markets/display";
import { TOP_PER_MARKET, type ProductsModel } from "@/lib/markets/products";

export function TopByMarket({ model, compareLabel }: { model: ProductsModel; compareLabel?: string }) {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {model.markets.map((m) => {
        const items = model.top[m.key] ?? [];
        const max = Math.max(0.0001, ...items.map((i) => i.share));
        return (
          <Card key={m.key} padding="none" className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="m-0 flex items-center gap-1.5 text-[14px] font-semibold text-content-strong">
                {m.key === MARKET_OTHER ? "Other" : `${countryName(m.key)} (${m.key})`}
                {m.isHome && (
                  <Badge variant="outline" size="sm">
                    Home
                  </Badge>
                )}
                {m.key === MARKET_OTHER && <InfoTip text="Every country outside the configured markets, pooled." />}
              </h3>
              <span className="font-mono text-[12px] tabular text-content-muted">{formatMoney(m.netSales, model.baseCurrency, { compact: true })}</span>
            </div>
            <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
              {items.map((it, i) => {
                const newEntry = model.hasCompare && (it.prevRank === null || it.prevRank > TOP_PER_MARKET);
                return (
                  <li key={it.product} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="w-3 shrink-0 font-mono text-[11px] tabular text-content-muted">{i + 1}</span>
                        <span className="line-clamp-2 min-w-0 break-words leading-snug text-content-body" title={it.product}>
                          {it.product}
                        </span>
                        {newEntry && (
                          <Badge variant="outline" size="sm">
                            {it.prevRank === null ? "new" : `was #${it.prevRank}`}
                          </Badge>
                        )}
                      </span>
                      <span className="flex shrink-0 items-baseline gap-2">
                        <span className="font-mono tabular text-content-strong">{formatPercent(it.share)}</span>
                        {model.hasCompare && (
                          <DeltaChip
                            change={{ current: it.share, previous: it.prevShare, kind: "rate" }}
                            goodWhen="neutral"
                            className="text-[11px]"
                            after={compareLabel ? <span className="sr-only">{compareLabel}</span> : undefined}
                          />
                        )}
                      </span>
                    </div>
                    <span aria-hidden="true" className="ml-5 h-1 rounded-pill bg-gray-100">
                      <span className="block h-1 rounded-pill bg-accent" style={{ width: `${(it.share / max) * 100}%` }} />
                    </span>
                  </li>
                );
              })}
            </ol>
          </Card>
        );
      })}
    </div>
  );
}
