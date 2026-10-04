/**
 * Estimated bottom line: EBITDA, gross margin, and lifetime economics.
 *
 * EBITDA here is `CM3 - revenue x stated OpEx rate`. The rate is an assumption
 * somebody entered in Settings, not a measurement, so the card only appears
 * once a rate exists and its tooltip says where the rate comes from. The trend
 * is meaningful; the level is indicative.
 *
 * Lifetime and payback figures are native-currency numbers, so they are
 * formatted with `lifetimeCurrency` even when the P&L above is converted.
 */

import Link from "next/link";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { MetricTooltip } from "@/components/dashboard/MetricTooltip";
import { formatMoney, formatPercent, formatRatio } from "@/lib/currency";
import { safeDiv } from "@/lib/coerce";
import { METRIC_DEFINITIONS } from "@/lib/metrics";
import { hasNoCostData, type PnlTotals } from "@/lib/queries/pnl";
import type { LifetimeSummary, Payback } from "@/lib/queries/lifetime";

export function BottomLine({
  totals,
  currency,
  lifetime,
  lifetimeCurrency,
  customersHref,
  payback,
  opexRate,
}: {
  totals: PnlTotals;
  currency: string;
  lifetime: LifetimeSummary | null;
  /** Currency of the lifetime and payback figures (the client's own). */
  lifetimeCurrency: string;
  customersHref: string;
  payback: Payback | null;
  /** Share of revenue, from Settings. Null = not stated. */
  opexRate: number | null;
}) {
  const money = (v: number | null) => formatMoney(v, currency);
  const lifeMoney = (v: number | null) => formatMoney(v, lifetimeCurrency);

  // Merchandise margin, ex-shipping: (net sales - COGS) / net sales.
  const noCost = hasNoCostData(totals);
  const grossMargin =
    totals.netSales !== null && totals.cogs !== null
      ? safeDiv(totals.netSales - totals.cogs, totals.netSales)
      : null;

  return (
    <div className="flex flex-col gap-[18px] rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
      {/*
        EBITDA appears only once somebody has stated an OpEx rate in Settings.
        An absent card is the honest version of an unknown, and the rate is
        attributable to whoever entered it.
      */}
      {opexRate !== null && totals.cm3 !== null && totals.revenue !== null && (
        <div className="flex flex-col gap-2.5 border-b border-hairline pb-[18px]">
          <span className="relative inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            EBITDA (est.)
            <MetricTooltip definition={METRIC_DEFINITIONS.EBITDA} />
          </span>
          <span className="font-mono text-[26px] font-semibold leading-none tracking-heading tabular text-content-strong">
            {money(totals.cm3 - totals.revenue * opexRate)}
          </span>
        </div>
      )}

      <span className="inline-flex items-center gap-1.5">
        <Eyebrow>Customer payback</Eyebrow>
        <MetricTooltip definition={METRIC_DEFINITIONS.Payback} />
      </span>

      {payback === null ? (
        <span className="text-[13px] leading-[1.6] text-content-muted">
          Not enough history yet.
        </span>
      ) : (
        <div className="flex flex-col gap-2.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            90-day LTGP : CAC
          </span>
          <span
            className={`font-mono text-[30px] font-semibold leading-none tracking-heading tabular ${
              payback.ltgpToCac === null ? "text-content-muted" : "text-content-strong"
            }`}
          >
            {formatRatio(payback.ltgpToCac, { decimals: 1 })}
          </span>
          <span className="font-mono text-[12px] text-content-muted">
            {payback.recovery30 !== null
              ? `${formatPercent(payback.recovery30, { decimals: 0 })} of CAC in 30 days`
              : "CAC unknown"}
          </span>

          <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-control border border-hairline bg-gray-50 p-[10px_12px]">
            {[
              { k: "LTGP 30d", v: lifeMoney(payback.ltgp30) },
              { k: "LTGP 90d", v: lifeMoney(payback.ltgp90) },
              { k: "Blended CAC", v: formatMoney(payback.cac, lifetimeCurrency, { unit: true }) },
            ].map((x) => (
              <span key={x.k} className="flex flex-col gap-1">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-content-muted">
                  {x.k}
                </span>
                <span
                  className={`font-mono text-[13px] font-semibold tabular ${
                    x.v === "n/a" ? "text-content-muted" : "text-content-strong"
                  }`}
                >
                  {x.v}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-between gap-4 border-t border-hairline pt-4">
        <span className="flex flex-col gap-[7px]">
          <span className="relative inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            Gross margin
            <MetricTooltip definition={METRIC_DEFINITIONS["Gross margin"]} />
          </span>
          {noCost ? (
            <span className="text-[13px] leading-[1.6] text-content-muted">No cost data</span>
          ) : (
            <span
              className={`font-mono text-[20px] font-semibold tracking-heading tabular ${
                grossMargin === null ? "text-content-muted" : "text-content-strong"
              }`}
            >
              {formatPercent(grossMargin)}
            </span>
          )}
        </span>

        <span className="flex flex-col gap-[7px]">
          <span className="relative inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            LTV
            <MetricTooltip definition={METRIC_DEFINITIONS.LTV} />
          </span>
          <span
            className={`font-mono text-[20px] font-semibold tracking-heading tabular ${
              lifetime?.ltv == null ? "text-content-muted" : "text-content-strong"
            }`}
          >
            {lifeMoney(lifetime?.ltv ?? null)}
          </span>
        </span>

        <span className="flex flex-col gap-[7px]">
          <span className="relative inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            LTGP
            <MetricTooltip definition={METRIC_DEFINITIONS.LTGP} />
          </span>
          <span
            className={`font-mono text-[20px] font-semibold tracking-heading tabular ${
              lifetime?.ltgp == null ? "text-content-muted" : "text-growth-700"
            }`}
          >
            {lifeMoney(lifetime?.ltgp ?? null)}
          </span>
          {lifetime?.ltgpRatio != null && (
            <span className="text-[11.5px] text-gray-300">
              {formatPercent(lifetime.ltgpRatio)} of LTV
            </span>
          )}
        </span>
      </div>

      <Link
        href={customersHref}
        className="font-mono text-[11.5px] uppercase tracking-[0.06em] text-growth-600 transition-colors duration-fast hover:text-growth-700"
      >
        Customers →
      </Link>
    </div>
  );
}
