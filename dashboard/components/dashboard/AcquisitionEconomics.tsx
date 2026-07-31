/**
 * Acquisition economics — MER, aMER, CAC, AOV, new vs returning.
 *
 * Every figure here is recomputed from summed components, never averaged from
 * daily ratios (see METRICS.md: averaging pre-divided per-day values is 10–30%
 * wrong). The polarity of each is declared explicitly, because this row is where
 * getting it wrong hurts most — a rising CAC painted green inverts the meaning
 * of the whole page.
 */

import { DeltaChip, type GoodWhen } from "@/components/ui/Delta";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { MetricTooltip } from "@/components/dashboard/MetricTooltip";
import { METRIC_DEFINITIONS } from "@/lib/metrics";
import { formatMoney, formatNumber, formatRatio } from "@/lib/currency";
import { metric, type PnlSnapshot } from "@/lib/queries/pnl";

export function AcquisitionEconomics({ snapshot }: { snapshot: PnlSnapshot }) {
  const t = snapshot.current;
  const currency = snapshot.currency;
  const hasComparison = snapshot.previous !== null;

  const items: Array<{
    label: string;
    value: string;
    delta: number | null;
    goodWhen: GoodWhen;
    source: string;
    small?: boolean;
  }> = [
    {
      label: "MER",
      value: formatRatio(t.mer),
      delta: metric(snapshot, (x) => x.mer).delta,
      goodWhen: "up",
      source: "Shop ÷ ads",
    },
    {
      label: "aMER",
      value: formatRatio(t.amer),
      delta: metric(snapshot, (x) => x.amer).delta,
      goodWhen: "up",
      source: "Shop ÷ ads",
    },
    {
      label: "CAC",
      value: formatMoney(t.cac, currency),
      // Cheaper acquisition is better — the one metric on this row where a
      // falling number is the good news.
      delta: metric(snapshot, (x) => x.cac).delta,
      goodWhen: "down",
      source: "Ads ÷ shop",
    },
    {
      label: "AOV (net)",
      // Canonical AOV is net_sales ÷ orders — ex-shipping, ex-tax. This is the
      // version that reconciles against Shopify's own dashboard.
      value: formatMoney(
        t.netSales !== null && t.orders ? t.netSales / t.orders : null,
        currency
      ),
      delta: metric(snapshot, (x) =>
        x.netSales !== null && x.orders ? x.netSales / x.orders : null
      ).delta,
      goodWhen: "up",
      source: "Shop",
    },
    {
      label: "New / Ret. orders",
      value: `${formatNumber(t.newCustomerOrders)} / ${formatNumber(t.returningCustomerOrders)}`,
      delta: metric(snapshot, (x) => x.newCustomerOrders).delta,
      goodWhen: "neutral",
      source: "Shop",
      small: true,
    },
  ];

  return (
    <div className="rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
      <div className="mb-5 flex items-center justify-between gap-4">
        <Eyebrow>Acquisition economics</Eyebrow>
        <span className="text-[12px] text-content-muted">
          Rates recomputed from sums
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-x-3 gap-y-[18px]">
        {items.map((item) => (
          <div key={item.label} className="flex min-w-0 flex-col gap-[9px] py-0.5">
            <span className="relative inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
              {item.label}
              {METRIC_DEFINITIONS[item.label] && (
                <MetricTooltip definition={METRIC_DEFINITIONS[item.label]} />
              )}
            </span>
            <span
              className={`font-mono font-semibold leading-none tracking-heading tabular text-content-strong ${
                item.small ? "text-[18px]" : "text-[22px]"
              }`}
            >
              {item.value}
            </span>
            {hasComparison && (
              <DeltaChip delta={item.delta} goodWhen={item.goodWhen} />
            )}
            <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-gray-300">
              {item.source}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
