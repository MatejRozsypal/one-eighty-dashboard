"use client";

/**
 * The Products body: what each market buys differently from home (the units
 * mix map) and which products open its first orders (entry products), both
 * for one compared market at a time; then the product x market matrix (share
 * or price) and each market's top five.
 */

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { InfoTip } from "@/components/ui/InfoTip";
import { SegmentPills } from "@/components/controls/SegmentedControl";
import { countryName } from "@/lib/markets/display";
import {
  entryTakeaway,
  matrixTakeaway,
  mixTakeaway,
  topTakeaway,
  ENTRY_MIN_ORDERS,
  MIX_BAND,
  TOP_PER_MARKET,
  TOP_PRODUCTS,
  type ProductsModel,
} from "@/lib/markets/products";
import { NaValue } from "@/components/markets/bits";
import { MixLegend, MixMap } from "@/components/markets/products/MixMap";
import { EntryProducts } from "@/components/markets/products/EntryProducts";
import { ProductMatrix, SHARE_MIX, SHARE_STEPS, type MatrixMetric } from "@/components/markets/products/ProductMatrix";
import { TopByMarket } from "@/components/markets/products/TopByMarket";
import { formatPercent } from "@/lib/format";

export function ProductsView({ model, rangeText, compareLabel }: { model: ProductsModel; rangeText: string; compareLabel?: string }) {
  const [metric, setMetric] = useState<MatrixMetric>("share");
  const compared = Object.keys(model.mix);
  const [picked, setPicked] = useState<string | null>(null);
  const market = picked && compared.includes(picked) ? picked : compared[0] ?? null;
  const home = model.homeMarket;
  const mix = market ? model.mix[market] : null;
  const entry = market ? model.entry[market] : null;
  const period = compareLabel ? `${rangeText}, ${compareLabel}` : rangeText;
  const steps = ["0%", ...SHARE_STEPS.map((s) => formatPercent(s, { decimals: 0 }))];
  const mixLine = market && mix ? mixTakeaway(mix, market, home) : null;
  const entryLine = market && entry ? entryTakeaway(entry, market, home) : null;
  const band = Math.round(MIX_BAND * 100);
  const matrix = matrixTakeaway(model, metric);
  const top = topTakeaway(model);

  return (
    <div className="flex flex-col gap-5">
      {market && mix && entry && (
        <>
          <Card padding="none" className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <h2 className="m-0 flex items-center gap-1.5 text-[15px] font-semibold text-content-strong">
                  What sells differently from {countryName(home)}
                  <InfoTip
                    text={`By units, not net sales, so a lower price does not read as buying less. Each dot is a product: its share of ${home} units across, its share of ${market} units up. On the dashed line the market buys the same mix; the band is index ${100 - band} to ${100 + band} (index = ${market} share / ${home} share x 100). Square-root axes so small products spread out. Shipping insurance, gift cards and free lines are left out.`}
                  />
                </h2>
                <span className="text-[12px] text-content-muted">{rangeText}</span>
              </div>
              {compared.length > 1 && (
                <SegmentPills
                  segments={compared.map((k) => ({ value: k, label: k }))}
                  shown={market}
                  onSelect={setPicked}
                  ariaLabel="Market compared with home"
                />
              )}
            </div>
            {mixLine && <p className="m-0 border-l-2 border-accent pl-3 text-[13px] text-content-strong">{mixLine}</p>}
            {"na" in mix ? (
              <span className="text-[13px]">
                <NaValue reason={mix.na} />
              </span>
            ) : (
              <>
                <MixLegend market={market} excluded={mix.excluded} />
                <MixMap points={mix.points} market={market} home={home} />
              </>
            )}
          </Card>

          <Card padding="none" className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
            <div className="flex flex-col gap-0.5">
              <h2 className="m-0 flex items-center gap-1.5 text-[15px] font-semibold text-content-strong">
                Entry products, {countryName(market)} vs {countryName(home)}
                <InfoTip
                  text={`Share of first orders (new customers) that contain each product. A first order with three products counts for each, so a market's shares add up to more than 100 %. Under ${ENTRY_MIN_ORDERS} first orders a share is faded ("low n"). Index = ${market} share / ${home} share x 100.`}
                />
              </h2>
              <span className="text-[12px] text-content-muted">
                {rangeText}
                {"na" in entry ? "" : `, ${entry.newOrders.toLocaleString("en-US")} first orders in ${market}, ${entry.homeNewOrders.toLocaleString("en-US")} in ${home}`}
              </span>
            </div>
            {entryLine && <p className="m-0 text-[13px] text-content-strong">{entryLine}</p>}
            {"na" in entry ? (
              <span className="text-[13px]">
                <NaValue reason={entry.na} />
              </span>
            ) : entry.items.length === 0 ? (
              <p className="m-0 text-[13px] text-content-muted">No first order in {market} contains a product in this period.</p>
            ) : (
              <EntryProducts items={entry.items} market={market} home={home} />
            )}
          </Card>
        </>
      )}

      <Card padding="none" className="min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
          <div className="flex flex-col gap-0.5">
            <h2 className="m-0 flex items-center gap-1.5 text-[15px] font-semibold text-content-strong">
              {metric === "share" ? "Share of each market's net sales" : "Average selling price"}
              <InfoTip
                text={
                  metric === "share"
                    ? `Product net sales / market net sales, ex VAT. Top ${TOP_PRODUCTS} products by net sales across all markets; the rest pooled. Hover a cell for net sales, units and price.`
                    : `Net sales / units, ex VAT, in ${model.baseCurrency}; under it the local price where the market pays in one currency. No price index and no buying-power adjustment.`
                }
              />
            </h2>
            <span className="text-[12px] text-content-muted">{period}</span>
          </div>
          <SegmentPills
            segments={[
              { value: "share", label: "Share" },
              { value: "price", label: "Avg price" },
            ]}
            shown={metric}
            onSelect={(v) => setMetric(v as MatrixMetric)}
            ariaLabel="Matrix shows"
          />
          {matrix && <p className="m-0 w-full text-[13px] text-content-strong">{matrix}</p>}
        </div>
        <ProductMatrix model={model} metric={metric} compareLabel={compareLabel} periodLabel={rangeText} />
        {metric === "share" && (
          <div className="flex flex-wrap items-center gap-1 px-4 py-3 text-[11.5px] text-content-muted sm:px-5">
            <span>Share</span>
            {SHARE_MIX.map((m, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <span aria-hidden="true" className="h-3 w-4" style={{ backgroundColor: `color-mix(in srgb, var(--accent) ${m}%, transparent)` }} />
                <span className="font-mono tabular">{i === SHARE_MIX.length - 1 ? `${steps[i]}+` : steps[i]}</span>
              </span>
            ))}
          </div>
        )}
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="m-0 flex items-center gap-1.5 text-[15px] font-semibold text-content-strong">
          Top {TOP_PER_MARKET} per market
          {model.hasCompare && <InfoTip text="Change in share in percentage points against the comparison period." />}
        </h2>
        {top && <p className="m-0 text-[13px] text-content-strong">{top}</p>}
        <TopByMarket model={model} compareLabel={compareLabel} />
      </div>
    </div>
  );
}
