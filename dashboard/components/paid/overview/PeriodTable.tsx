/**
 * Period: one row per day, week or month (the same grain as the chart), newest
 * first. Every ratio is taken from the row's own sums.
 */

import { DataTable, type DataTableRow } from "@/components/ui/DataTable";
import { Value } from "@/components/ui/EmptyState";
import { formatMoney, formatNumber, formatRatio } from "@/lib/format";
import { efficiency, bucketLabel, type Bucket } from "@/components/paid/overview/model";
import type { Grain } from "@/lib/paid/types";

const GRID =
  "grid grid-cols-[minmax(150px,1.4fr)_repeat(9,minmax(84px,1fr))] items-center gap-2";
const NUM = "font-mono text-[12.5px] tabular text-content-strong";

export function PeriodTable({
  buckets,
  grain,
  currency,
  hasMeta,
  hasGoogle,
}: {
  /** Oldest first, as built; the table shows them newest first. */
  buckets: Bucket[];
  grain: Grain;
  currency: string;
  hasMeta: boolean;
  hasGoogle: boolean;
}) {
  const columns = [
    { key: "period", label: "Period" },
    { key: "spend", label: "Paid spend", align: "right" as const },
    { key: "meta", label: "Meta", align: "right" as const },
    { key: "google", label: "Google", align: "right" as const },
    { key: "revenue", label: "Revenue", align: "right" as const },
    { key: "nc", label: "New-customer revenue", align: "right" as const },
    { key: "mer", label: "MER", align: "right" as const },
    { key: "amer", label: "aMER", align: "right" as const },
    { key: "ncac", label: "nCAC", align: "right" as const },
    { key: "customers", label: "New customers", align: "right" as const },
  ];

  const rows: DataTableRow[] = [...buckets].reverse().map((b) => {
    const e = efficiency(b);
    const label = bucketLabel(b, grain);
    // A platform the client does not have is "n/a", not a zero.
    const meta = hasMeta ? b.metaSpend : null;
    const google = hasGoogle ? b.googleSpend : null;
    return {
      key: b.start,
      sort: [b.start, b.paidSpend, meta, google, b.revenue, b.newCustomerRevenue, e.mer, e.amer, e.ncac, b.newCustomerOrders],
      cells: [
        <span key="p" className="block truncate text-[13px] text-content-strong">{label}</span>,
        <span key="s" className={`${NUM} font-semibold`}><Value>{formatMoney(b.paidSpend, currency)}</Value></span>,
        <span key="m" className={NUM}><Value>{formatMoney(meta, currency)}</Value></span>,
        <span key="g" className={NUM}><Value>{formatMoney(google, currency)}</Value></span>,
        <span key="r" className={NUM}><Value>{formatMoney(b.revenue, currency)}</Value></span>,
        <span key="n" className={NUM}><Value>{formatMoney(b.newCustomerRevenue, currency)}</Value></span>,
        <span key="mer" className={NUM}><Value>{formatRatio(e.mer)}</Value></span>,
        <span key="amer" className={NUM}><Value>{formatRatio(e.amer)}</Value></span>,
        <span key="ncac" className={NUM}><Value>{formatMoney(e.ncac, currency, { unit: true })}</Value></span>,
        <span key="c" className={NUM}><Value>{formatNumber(b.newCustomerOrders)}</Value></span>,
      ],
    };
  });

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1000px]">
        <DataTable columns={columns} rows={rows} gridClass={GRID} />
      </div>
    </div>
  );
}
