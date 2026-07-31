/**
 * Acquisition economics — the efficiency row, then the mix behind it.
 *
 * Promoted from a panel of small figures to the same card treatment as the
 * headline row above. These four decide whether the revenue on that row was
 * bought well, so they deserve to be read at the same weight rather than as a
 * footnote beside it.
 *
 * Every figure is recomputed from summed components, never averaged from daily
 * ratios (METRICS.md: averaging pre-divided per-day values is 10–30% wrong).
 * The polarity of each is declared explicitly, because this is where getting it
 * wrong hurts most — a rising CAC painted green inverts the meaning of the page.
 */

import { MetricCard } from "@/components/dashboard/MetricCard";
import { DeltaChip } from "@/components/ui/Delta";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/currency";
import { safeDiv } from "@/lib/coerce";
import { metric, type PnlSnapshot } from "@/lib/queries/pnl";

export function AcquisitionEconomics({
  snapshot,
  comparisonLabel,
  shopPlatform = "Shop",
}: {
  snapshot: PnlSnapshot;
  comparisonLabel?: string;
  shopPlatform?: string;
}) {
  const t = snapshot.current;
  const currency = snapshot.currency;
  const hasComparison = snapshot.previous !== null;

  const aov = (x: typeof t) =>
    x.netSales !== null && x.orders ? x.netSales / x.orders : null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-[17px] font-bold tracking-heading text-content-strong">
          Acquisition economics
        </h2>
        <span className="text-[12px] text-content-muted">
          Rates recomputed from sums, never averaged from daily ratios
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="MER"
          value={formatRatio(t.mer)}
          delta={hasComparison ? metric(snapshot, (x) => x.mer).delta : undefined}
          goodWhen="up"
          comparisonLabel={comparisonLabel}
          source="Warehouse"
        />
        <MetricCard
          label="aMER"
          value={formatRatio(t.amer)}
          delta={hasComparison ? metric(snapshot, (x) => x.amer).delta : undefined}
          goodWhen="up"
          comparisonLabel={comparisonLabel}
          source="Warehouse"
        />
        <MetricCard
          label="CAC"
          value={formatMoney(t.cac, currency)}
          delta={hasComparison ? metric(snapshot, (x) => x.cac).delta : undefined}
          // Cheaper acquisition is the good news — the one card here where a
          // falling number should be green.
          goodWhen="down"
          comparisonLabel={comparisonLabel}
          source="Warehouse"
        />
        <MetricCard
          label="Ad spend % of revenue"
          // Ad spend as a share of revenue — the Czech "podíl nákladů na
          // obratu", and the inverse of MER. Same information, but a cost
          // ratio is what people actually budget against, and lower is better.
          value={
            t.paidSpend !== null && t.revenue
              ? formatPercent(t.paidSpend / t.revenue, { decimals: 1 })
              : "—"
          }
          delta={
            hasComparison
              ? metric(snapshot, (x) =>
                  x.paidSpend !== null && x.revenue ? x.paidSpend / x.revenue : null
                ).delta
              : undefined
          }
          goodWhen="down"
          comparisonLabel={comparisonLabel}
          source="Warehouse"
        />
        <MetricCard
          label="AOV (net)"
          // Canonical AOV is net_sales ÷ orders — ex-shipping, ex-tax, the
          // version that reconciles against Shopify's own dashboard.
          value={formatMoney(aov(t), currency)}
          delta={hasComparison ? metric(snapshot, aov).delta : undefined}
          goodWhen="up"
          comparisonLabel={comparisonLabel}
          source={shopPlatform}
        />
      </div>

      <OrderMix snapshot={snapshot} comparisonLabel={comparisonLabel} />
    </section>
  );
}

/**
 * New vs returning orders — the mix, and whether each side is growing.
 *
 * A single "281 / 1,037" said nothing about proportion or direction. The bar
 * carries the mix; the two deltas carry the movement, and they are shown
 * separately on purpose: total orders can hold flat while acquisition collapses
 * and repeat purchase covers for it, which is the exact situation this panel
 * exists to expose. Both follow whatever comparison the control bar is set to.
 */
function OrderMix({
  snapshot,
  comparisonLabel,
}: {
  snapshot: PnlSnapshot;
  comparisonLabel?: string;
}) {
  const t = snapshot.current;
  const hasComparison = snapshot.previous !== null;

  const newOrders = t.newCustomerOrders;
  const retOrders = t.returningCustomerOrders;
  const total = (newOrders ?? 0) + (retOrders ?? 0);

  if (total === 0) return null;

  const newShare = safeDiv(newOrders, total);
  const retShare = safeDiv(retOrders, total);

  const segments = [
    {
      label: "New",
      count: newOrders,
      share: newShare,
      delta: hasComparison ? metric(snapshot, (x) => x.newCustomerOrders).delta : null,
      bar: "bg-accent",
      dot: "bg-accent",
    },
    {
      label: "Returning",
      count: retOrders,
      share: retShare,
      delta: hasComparison
        ? metric(snapshot, (x) => x.returningCustomerOrders).delta
        : null,
      bar: "bg-info",
      dot: "bg-info",
    },
  ];

  return (
    <div className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Eyebrow>Order mix · new vs returning</Eyebrow>
        <span className="font-mono text-[12px] tabular text-content-muted">
          {formatNumber(total)} orders
        </span>
      </div>

      <div className="flex h-3 overflow-hidden rounded-pill bg-gray-100">
        {segments.map((s) => (
          <span
            key={s.label}
            className={`block h-3 ${s.bar}`}
            style={{ width: `${(s.share ?? 0) * 100}%` }}
            aria-hidden="true"
          />
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {segments.map((s) => (
          <div key={s.label} className="flex flex-col gap-2">
            <span className="inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
              <span aria-hidden="true" className={`h-[9px] w-[9px] rounded-[3px] ${s.dot}`} />
              {s.label}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-2.5">
              <span className="font-mono text-[22px] font-semibold leading-none tracking-heading tabular text-content-strong">
                {formatNumber(s.count)}
              </span>
              <span className="font-mono text-[13px] tabular text-content-muted">
                {s.share !== null ? formatPercent(s.share, { decimals: 1 }) : "—"}
              </span>
            </span>
            {hasComparison && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                {/*
                  Neither direction is good or bad on its own: more new orders
                  is growth, more returning orders is retention, and which one
                  you wanted depends on the quarter. Colouring either would
                  assert a judgement the number doesn't carry.
                */}
                <DeltaChip delta={s.delta} goodWhen="neutral" />
                {s.delta !== null && comparisonLabel && (
                  <span className="font-mono text-[11.5px] text-content-muted">
                    {comparisonLabel}
                  </span>
                )}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
