/**
 * Revenue composition — what the customer paid vs what we booked.
 *
 * This is the block that reconciles against the shop platform. `revenue` in
 * this warehouse means net sales + shipping, ex-tax, which is neither Shopify's
 * "Total sales" nor its "Net sales" — so anyone comparing the two needs to see
 * the components, not just the total.
 *
 * ── Laid out as a ledger, like Shopify's "Total sales breakdown" ────────────
 * A plain two-column list, zebra-striped, subtotals in bold. The previous
 * version gave every row an explanatory caption, which made six rows as tall
 * as a chart and buried the arithmetic they were there to show. The point of
 * this block is that the numbers add up in front of you; anything that pushes
 * the next figure further from the last one works against it.
 *
 * The captions that carried real information are kept as a short note under
 * the table rather than one per row.
 *
 * Shoptet doesn't split VAT out cleanly, so for Manami tax reads "Included"
 * rather than a number. That's a real modelling limit, stated where it matters.
 */

import { Eyebrow } from "@/components/ui/Eyebrow";
import { formatMoney } from "@/lib/currency";
import type { PnlTotals } from "@/lib/queries/pnl";

interface Row {
  label: string;
  value: string;
  /** Subtotals — the lines the ones above add up to. */
  total?: boolean;
  /** Rendered in the negative tone; the minus sign is already in `value`. */
  negative?: boolean;
}

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
  const taxUnknown = totals.taxCollected === null;

  const rows: Row[] = [
    { label: "Net sales", value: money(totals.netSales) },
    { label: "Shipping charges", value: money(totals.shippingRevenue) },
    { label: "Revenue", value: money(totals.revenue), total: true },
    {
      label: "Taxes",
      value: taxUnknown ? "Included" : money(totals.taxCollected),
    },
    {
      label: "Gross revenue incl. tax",
      value: money(totals.grossRevenueInclTax),
      total: true,
    },
    {
      label: "Discounts given",
      value: discounts === null ? "—" : `−${money(discounts)}`,
      negative: discounts !== null,
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
          against {platform}.
        </span>
      </div>

      <div className="flex flex-col overflow-hidden rounded-sm">
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={`flex items-baseline justify-between gap-4 px-3 py-[11px] ${
              i % 2 === 1 ? "bg-gray-50" : ""
            }`}
          >
            <span
              className={`min-w-0 truncate text-[13.5px] ${
                row.total
                  ? "font-semibold text-content-strong"
                  : "text-content-body"
              }`}
            >
              {row.label}
            </span>
            <span
              className={`whitespace-nowrap font-mono text-[14px] tabular ${
                row.total ? "font-semibold" : ""
              } ${row.negative ? "text-negative" : "text-content-strong"}`}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>

      <span className="flex flex-col gap-1 text-[12px] leading-[1.5] text-content-muted">
        <span>
          Net sales is ex-shipping and ex-tax — that is the figure that
          reconciles against {platform}. Discounts are booked separately, not
          deducted above.
        </span>
        {taxUnknown && (
          <span>
            {platform} does not split VAT out, so revenue here is gross of VAT.
          </span>
        )}
        <span>
          AOV on the cards above is <b className="text-content-strong">net</b> —
          net sales ÷ orders, the canonical definition. AOV including shipping
          is {aovIncl}.
        </span>
      </span>
    </div>
  );
}
