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
import { ASSUMED_OPEX_RATE } from "@/lib/metrics";
import type { PnlTotals } from "@/lib/queries/pnl";
import type { LifetimeSummary } from "@/lib/queries/lifetime";

export function BottomLine({
  totals,
  currency,
  lifetime,
  customersHref,
}: {
  totals: PnlTotals;
  currency: string;
  lifetime: LifetimeSummary | null;
  customersHref: string;
}) {
  const money = (v: number | null) => formatMoney(v, currency);

  const ebitda =
    totals.cm3 !== null && totals.revenue !== null
      ? totals.cm3 - totals.revenue * ASSUMED_OPEX_RATE
      : null;
  const ebitdaPct = safeDiv(ebitda, totals.revenue);

  // Merchandise margin, ex-shipping: (net sales − COGS) ÷ net sales.
  const grossMargin =
    totals.netSales !== null && totals.cogs !== null
      ? safeDiv(totals.netSales - totals.cogs, totals.netSales)
      : null;

  return (
    <div className="flex flex-col gap-[18px] rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
      <Eyebrow>Estimated bottom line</Eyebrow>

      <div className="flex flex-col gap-2.5">
        <span className="inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
          EBITDA (est.)
          <Badge variant="outline" size="sm">
            Estimate
          </Badge>
        </span>
        <span className="font-mono text-[30px] font-semibold leading-none tracking-heading tabular text-content-strong">
          {money(ebitda)}
        </span>
        <span className="font-mono text-[12px] text-content-muted">
          {ebitdaPct !== null ? formatPercent(ebitdaPct) : "—"} of revenue
        </span>
        <span className="rounded-control border border-dashed border-hairline-strong bg-gray-50 p-[10px_12px] text-[12px] leading-[1.5] text-content-body">
          Assumes{" "}
          <b className="text-content-strong">
            {formatPercent(ASSUMED_OPEX_RATE, { decimals: 0 })} OpEx
          </b>{" "}
          — a hardcoded figure, not measured. Formula: cm3 − revenue ×{" "}
          {ASSUMED_OPEX_RATE}.
        </span>
      </div>

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
