/**
 * Revenue composition: what the customer paid vs what we booked.
 *
 * This is the block that reconciles against the shop platform. `revenue` in
 * this warehouse means net sales + shipping, ex-tax, which is neither a shop's
 * "Total sales" nor its "Net sales", so anyone comparing the two needs to see
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
import { MetricTooltip } from "@/components/dashboard/MetricTooltip";
import { formatMoney } from "@/lib/currency";
import { NO_VALUE } from "@/lib/format";
import { METRIC_DEFINITIONS } from "@/lib/metrics";
import type { PnlTotals } from "@/lib/queries/pnl";

interface Row {
  label: string;
  value: string;
  /** Metric whose definition is shown beside the label. */
  definition?: string;
  /** Subtotals: the lines the ones above add up to. */
  total?: boolean;
  /** Rendered in the negative tone; the minus sign is already in `value`. */
  negative?: boolean;
}

export function RevenueComposition({
  totals,
  currency,
  discounts,
}: {
  totals: PnlTotals;
  currency: string;
  /** Null when the shop platform doesn't expose it. */
  discounts: number | null;
}) {
  const money = (v: number | null) => formatMoney(v, currency);
  const taxUnknown = totals.taxCollected === null;

  const rows: Row[] = [
    { label: "Net sales", value: money(totals.netSales), definition: "Net sales" },
    { label: "Shipping charges", value: money(totals.shippingRevenue) },
    { label: "Revenue", value: money(totals.revenue), definition: "Revenue", total: true },
    {
      label: "Taxes",
      value: taxUnknown ? "Included" : money(totals.taxCollected),
    },
    {
      label: "Gross incl. tax",
      value: money(totals.grossRevenueInclTax),
      total: true,
    },
    {
      label: "Discounts given",
      value: discounts === null ? NO_VALUE : `−${money(discounts)}`,
      negative: discounts !== null,
    },
  ];

  return (
    <div className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
      <Eyebrow>Revenue composition</Eyebrow>

      <div className="flex flex-col overflow-hidden rounded-sm">
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={`flex items-baseline justify-between gap-4 px-3 py-[11px] ${
              i % 2 === 1 ? "bg-gray-50" : ""
            }`}
          >
            <span
              className={`flex min-w-0 items-center gap-1.5 text-[13.5px] ${
                row.total
                  ? "font-semibold text-content-strong"
                  : "text-content-body"
              }`}
            >
              <span className="truncate">{row.label}</span>
              {row.definition && (
                <MetricTooltip definition={METRIC_DEFINITIONS[row.definition]} />
              )}
            </span>
            <span
              className={`whitespace-nowrap font-mono text-[14px] tabular ${
                row.total ? "font-semibold" : ""
              } ${
                row.value === NO_VALUE
                  ? "text-content-muted"
                  : row.negative
                    ? "text-negative"
                    : "text-content-strong"
              }`}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
