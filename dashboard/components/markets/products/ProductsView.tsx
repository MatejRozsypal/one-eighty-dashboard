"use client";

/**
 * The Products body: what each market buys differently from home, the
 * product x market matrix (share or price), and each market's top five.
 */

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { InfoTip } from "@/components/ui/InfoTip";
import { SegmentPills } from "@/components/controls/SegmentedControl";
import { countryName } from "@/lib/markets/display";
import { MIN_SHARE, TOP_PER_MARKET, TOP_PRODUCTS, type ProductsModel } from "@/lib/markets/products";
import { DiffersMost } from "@/components/markets/products/DiffersMost";
import { ProductMatrix, SHARE_MIX, SHARE_STEPS, type MatrixMetric } from "@/components/markets/products/ProductMatrix";
import { TopByMarket } from "@/components/markets/products/TopByMarket";
import { formatPercent } from "@/lib/format";

export function ProductsView({ model, rangeText, compareLabel }: { model: ProductsModel; rangeText: string; compareLabel?: string }) {
  const [metric, setMetric] = useState<MatrixMetric>("share");
  const period = compareLabel ? `${rangeText}, ${compareLabel}` : rangeText;
  const steps = ["0%", ...SHARE_STEPS.map((s) => formatPercent(s, { decimals: 0 }))];

  return (
    <div className="flex flex-col gap-5">
      {Object.keys(model.differs).length > 0 && (
        <Card padding="none" className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="m-0 flex items-center gap-1.5 text-[15px] font-semibold text-content-strong">
              What sells differently from {countryName(model.homeMarket)}
              <InfoTip
                text={`A product's share of the market's net sales minus its share at home, in percentage points. Products under ${formatPercent(MIN_SHARE, { decimals: 0 })} in both are left out; Other is never compared.`}
              />
            </h2>
            <span className="text-[12px] text-content-muted">{rangeText}</span>
          </div>
          <DiffersMost model={model} />
        </Card>
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
        <TopByMarket model={model} compareLabel={compareLabel} />
      </div>
    </div>
  );
}
