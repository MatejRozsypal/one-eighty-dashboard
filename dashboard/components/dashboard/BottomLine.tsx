/**
 * Estimated bottom line — EBITDA, gross margin, and lifetime economics.
 *
 * EBITDA here is `cm3 − revenue × 0.30`. That 30% operating-expense figure is a
 * hardcoded assumption, not a measurement — nothing in the warehouse knows what
 * this business spends on salaries, rent or software. The assumption is printed
 * on the card rather than hidden in a tooltip, because a number labelled EBITDA
 * carries authority it hasn't earned here. The *trend* is meaningful; the level
 * is indicative.
 *
 * When `ref.clients.opex_pct` lands, this becomes per-client and the disclaimer
 * softens to "configured", not "assumed".
 */

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { formatMoney, formatPercent } from "@/lib/currency";
import { safeDiv } from "@/lib/coerce";
import type { PnlTotals } from "@/lib/queries/pnl";
import type { LifetimeSummary, Payback } from "@/lib/queries/lifetime";

export function BottomLine({
  totals,
  currency,
  lifetime,
  customersHref,
  payback,
  opexRate,
}: {
  totals: PnlTotals;
  currency: string;
  lifetime: LifetimeSummary | null;
  customersHref: string;
  payback: Payback | null;
  /** Share of revenue, from Admin → Cost assumptions. Null = not stated. */
  opexRate: number | null;
}) {
  const money = (v: number | null) => formatMoney(v, currency);

  // Merchandise margin, ex-shipping: (net sales − COGS) ÷ net sales.
  const grossMargin =
    totals.netSales !== null && totals.cogs !== null
      ? safeDiv(totals.netSales - totals.cogs, totals.netSales)
      : null;

  return (
    <div className="flex flex-col gap-[18px] rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
      {/*
        EBITDA appears only once somebody has stated an OpEx rate in Admin.
        It used to be computed against a hardcoded 30%, which presented an
        assumption as a measurement; an absent card is the honest version of an
        unknown, and the rate is now attributable to whoever entered it.
      */}
      {opexRate !== null && totals.cm3 !== null && totals.revenue !== null && (
        <div className="flex flex-col gap-2.5 border-b border-hairline pb-[18px]">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            EBITDA (est.)
          </span>
          <span className="font-mono text-[26px] font-semibold leading-none tracking-heading tabular text-content-strong">
            {money(totals.cm3 - totals.revenue * opexRate)}
          </span>
          <span className="font-mono text-[12px] text-content-muted">
            CM3 − revenue × {formatPercent(opexRate, { decimals: 0 })} OpEx · your
            stated rate, not measured
          </span>
        </div>
      )}

      <Eyebrow>Customer payback</Eyebrow>

      {payback === null ? (
        <span className="text-[13px] leading-[1.6] text-content-muted">
          Not enough history — payback needs customers whose first 90 days have
          fully elapsed.
        </span>
      ) : (
        <div className="flex flex-col gap-2.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            90-day LTGP : CAC
          </span>
          <span className="font-mono text-[30px] font-semibold leading-none tracking-heading tabular text-content-strong">
            {payback.ltgpToCac !== null ? `${payback.ltgpToCac.toFixed(1)}×` : "—"}
          </span>
          <span className="font-mono text-[12px] text-content-muted">
            {payback.recovery30 !== null
              ? `${formatPercent(payback.recovery30, { decimals: 0 })} of CAC back in 30 days`
              : "CAC unknown"}
          </span>

          <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-control border border-hairline bg-gray-50 p-[10px_12px]">
            {[
              { k: "LTGP 30d", v: money(payback.ltgp30) },
              { k: "LTGP 90d", v: money(payback.ltgp90) },
              { k: "Blended CAC", v: money(payback.cac) },
            ].map((x) => (
              <span key={x.k} className="flex flex-col gap-1">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-content-muted">
                  {x.k}
                </span>
                <span className="font-mono text-[13px] font-semibold tabular text-content-strong">
                  {x.v}
                </span>
              </span>
            ))}
          </div>

          <span className="text-[12px] leading-[1.5] text-content-muted">
            Gross profit per new customer in their first 30 and 90 days, over
            the last 12 months. Both figures cover the same customers — those
            whose 90-day window has closed — so the pair is a real curve rather
            than two averages of different populations.
            <br />
            Blended CAC here is also the 12-month figure, so it will not match
            the CAC card above, which follows the date range you selected.
          </span>
        </div>
      )}

      <div className="flex flex-wrap justify-between gap-4 border-t border-hairline pt-4">
        <span className="flex flex-col gap-[7px]">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            Gross margin
          </span>
          <span className="font-mono text-[20px] font-semibold tracking-heading tabular text-content-strong">
            {grossMargin !== null ? formatPercent(grossMargin) : "—"}
          </span>
          <span className="text-[11.5px] text-gray-300">
            net sales − COGS ÷ net sales
          </span>
        </span>

        <span className="flex flex-col gap-[7px]">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            LTV
          </span>
          <span className="font-mono text-[20px] font-semibold tracking-heading tabular text-content-strong">
            {money(lifetime?.ltv ?? null)}
          </span>
          <span className="text-[11.5px] text-gray-300">per customer, 36m</span>
        </span>

        <span className="flex flex-col gap-[7px]">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            LTGP
          </span>
          <span className="font-mono text-[20px] font-semibold tracking-heading tabular text-growth-700">
            {money(lifetime?.ltgp ?? null)}
          </span>
          <span className="text-[11.5px] text-gray-300">
            {lifetime?.ltgpRatio != null
              ? `${formatPercent(lifetime.ltgpRatio)} of LTV survives`
              : "gross profit per customer"}
          </span>
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
