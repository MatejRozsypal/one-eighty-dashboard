/**
 * Acquisition economics, the efficiency row, then the mix behind it.
 *
 * Promoted from a panel of small figures to the same card treatment as the
 * headline row above. These four decide whether the revenue on that row was
 * bought well, so they deserve to be read at the same weight rather than as a
 * footnote beside it.
 *
 * Every figure is recomputed from summed components, never averaged from daily
 * ratios (METRICS.md: averaging pre-divided per-day values is 10-30% wrong).
 * The polarity of each is declared explicitly, because this is where getting it
 * wrong hurts most, a rising CAC painted green inverts the meaning of the page.
 */

import { MetricCard, type MetricState } from "@/components/dashboard/MetricCard";
import { DeltaChip } from "@/components/ui/Delta";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/currency";
import { NO_VALUE } from "@/lib/format";
import { safeDiv } from "@/lib/coerce";
import { metricChange, type PnlSnapshot } from "@/lib/queries/pnl";

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

  // Leading spend gap: revenue covers days the ad spend does not, so every
  // ratio over spend says so instead of showing an inflated figure.
  const gapState: MetricState | undefined = t.leadingSpendGap
    ? { kind: "no-data", reason: "Missing days" }
    : undefined;

  const aov = (x: typeof t) =>
    x.netSales !== null && x.orders ? x.netSales / x.orders : null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="m-0 text-[17px] font-bold tracking-heading text-content-strong">
        Acquisition economics
      </h2>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="MER"
          value={formatRatio(t.mer)}
          change={hasComparison ? metricChange(snapshot, (x) => x.mer, "ratio") : undefined}
          goodWhen="up"
          comparisonLabel={comparisonLabel}
          source="Warehouse"
          state={gapState}
        />
        <MetricCard
          label="aMER"
          value={formatRatio(t.amer)}
          change={hasComparison ? metricChange(snapshot, (x) => x.amer, "ratio") : undefined}
          goodWhen="up"
          comparisonLabel={comparisonLabel}
          source="Warehouse"
          state={gapState}
        />
        <MetricCard
          label="CAC"
          value={formatMoney(t.cac, currency, { unit: true })}
          change={hasComparison ? metricChange(snapshot, (x) => x.cac, "money") : undefined}
          // Cheaper acquisition is the good news, the one card here where a
          // falling number should be green.
          goodWhen="down"
          comparisonLabel={comparisonLabel}
          source="Warehouse"
          state={gapState}
        />
        <MetricCard
          label="Ad spend share"
          // Ad spend as a share of revenue, the inverse of MER. Same
          // information, but a cost ratio is what people actually budget
          // against, and lower is better.
          value={
            !t.leadingSpendGap && t.paidSpend !== null && t.revenue
              ? formatPercent(t.paidSpend / t.revenue, { decimals: 1 })
              : NO_VALUE
          }
          // A share is a rate: percentage points in both modes.
          change={
            hasComparison
              ? metricChange(
                  snapshot,
                  (x) =>
                    !x.leadingSpendGap && x.paidSpend !== null && x.revenue
                      ? x.paidSpend / x.revenue
                      : null,
                  "rate"
                )
              : undefined
          }
          goodWhen="down"
          comparisonLabel={comparisonLabel}
          source="Warehouse"
          state={gapState}
        />
        <MetricCard
          label="AOV (net)"
          // Canonical AOV is net sales / orders: ex-shipping, ex-tax, the
          // version that reconciles against the shop platform's own dashboard.
          value={formatMoney(aov(t), currency)}
          change={hasComparison ? metricChange(snapshot, aov, "money") : undefined}
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
 * New vs returning orders, the mix, and whether each side is growing.
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
      change: hasComparison
        ? metricChange(snapshot, (x) => x.newCustomerOrders, "count")
        : null,
      bar: "bg-accent",
      dot: "bg-accent",
    },
    {
      label: "Returning",
      count: retOrders,
      share: retShare,
      change: hasComparison
        ? metricChange(snapshot, (x) => x.returningCustomerOrders, "count")
        : null,
      bar: "bg-info",
      dot: "bg-info",
    },
  ];

  return (
    <div className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Eyebrow>Order mix</Eyebrow>
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
                {formatPercent(s.share, { decimals: 1 })}
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
                <DeltaChip
                  change={s.change}
                  goodWhen="neutral"
                  after={
                    comparisonLabel ? (
                      <span className="font-mono text-[11.5px] text-content-muted">
                        {comparisonLabel}
                      </span>
                    ) : undefined
                  }
                />
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
