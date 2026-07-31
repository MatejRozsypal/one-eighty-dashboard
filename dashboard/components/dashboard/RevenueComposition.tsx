/**
 * Revenue composition — what the customer paid vs what we booked.
 *
 * This is the block that reconciles against the shop platform. `revenue` in
 * this warehouse means net sales + shipping, ex-tax, which is neither Shopify's
 * "Total sales" nor its "Net sales" — so anyone comparing the two needs to see
 * the components, not just the total.
 *
 * Shoptet doesn't split VAT out cleanly, so for Manami tax reads "Included"
 * rather than a number. That's a real modelling limit, stated where it matters.
 */

import { Eyebrow } from "@/components/ui/Eyebrow";
import { formatMoney } from "@/lib/currency";
import type { PnlTotals } from "@/lib/queries/pnl";

export function RevenueComposition({
  totals,
  currency,
  shopPlatform,
  discounts,
}: {
  totals: PnlTotals;
  currency: string;
  shopPlatform: string;
  /** Null when the shop platform doesn't expose it. */
  discounts: number | null;
}) {
  const money = (v: number | null) => formatMoney(v, currency);
  const platform = shopPlatform[0].toUpperCase() + shopPlatform.slice(1);

  const rows: Array<{
    label: string;
    value: string;
    note?: string;
    emphasis?: boolean;
  }> = [
    {
      label: "Net sales",
      value: money(totals.netSales),
      note: `ex-shipping, ex-tax · reconciles against ${platform}`,
    },
    { label: "+ Shipping revenue", value: money(totals.shippingRevenue) },
    {
      label: "= Revenue",
      value: money(totals.revenue),
      note: "what the headline card shows",
      emphasis: true,
    },
    totals.taxCollected === null
      ? {
          label: "+ Tax collected",
          value: "Included",
          note: `${platform} does not split VAT out — revenue is gross of VAT`,
        }
      : { label: "+ Tax collected", value: money(totals.taxCollected) },
    {
      label: "= Gross revenue incl. tax",
      value: money(totals.grossRevenueInclTax),
      emphasis: true,
    },
    {
      label: "Discounts given",
      value: discounts === null ? "—" : `−${money(discounts)}`,
      note:
        discounts === null
          ? "not exposed by this shop platform"
          : "not deducted above — booked separately",
    },
  ];

  const aovIncl =
    totals.revenue !== null && totals.orders
      ? money(totals.revenue / totals.orders)
      : "—";

  return (
    <div className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
      <div className="flex flex-col gap-[5px]">
        <Eyebrow>Revenue composition</Eyebrow>
        <span className="text-[12.5px] leading-[1.5] text-content-muted">
          What the customer paid vs what we booked — the line that reconciles
          against the shop platform.
        </span>
      </div>

      <div className="flex flex-col">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-4 border-b border-hairline py-[11px]"
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span
                className={`font-mono text-[10.5px] uppercase tracking-[0.08em] ${
                  row.emphasis ? "text-content-strong" : "text-content-muted"
                }`}
              >
                {row.label}
              </span>
              {row.note && (
                <span className="text-[12px] leading-[1.4] text-gray-300">
                  {row.note}
                </span>
              )}
            </span>
            <span className="whitespace-nowrap font-mono text-[15px] font-semibold tracking-heading tabular text-content-strong">
              {row.value}
            </span>
          </div>
        ))}
      </div>

      <span className="text-[12px] leading-[1.5] text-content-muted">
        AOV above is <b className="text-content-strong">net</b> — net sales ÷
        orders, the canonical definition. AOV incl. shipping is {aovIncl}.
      </span>
    </div>
  );
}
