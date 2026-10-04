/**
 * Paid sessions by channel. Every rate is summed numerator over summed
 * denominator, per row. Rows arrive biggest first; headings re-sort.
 */

import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { DataTable } from "@/components/ui/DataTable";
import { Value } from "@/components/ui/EmptyState";
import { ratio } from "@/lib/paid/math";
import type { Ga4ChannelRow } from "@/lib/queries/paidGa4";

const mono = "font-mono text-[12.5px] tabular text-content-strong";

export function Ga4Channels({ rows, currency }: { rows: Ga4ChannelRow[]; currency: string }) {
  const body = rows.map((r) => {
    const engaged = ratio(r.engagedSessions, r.sessions);
    const atc = ratio(r.sessionsAtc, r.sessions);
    const cvr = ratio(r.sessionsPurchase, r.sessions);
    const aov = ratio(r.revenue, r.purchases);
    return {
      key: r.channel,
      sort: [r.channel, r.sessions, engaged, atc, cvr, r.purchases, r.revenue, aov],
      cells: [
        <span key="c" className="text-[13px] text-content-strong">{r.channel}</span>,
        <span key="s" className={mono}><Value>{formatNumber(r.sessions)}</Value></span>,
        <span key="e" className={mono}><Value>{formatPercent(engaged)}</Value></span>,
        <span key="a" className={mono}><Value>{formatPercent(atc)}</Value></span>,
        <span key="v" className={mono}><Value>{formatPercent(cvr, { decimals: 2 })}</Value></span>,
        <span key="p" className={mono}><Value>{formatNumber(r.purchases)}</Value></span>,
        <span key="r" className={mono}><Value>{formatMoney(r.revenue, currency)}</Value></span>,
        <span key="o" className={mono}><Value>{formatMoney(aov, currency, { unit: true })}</Value></span>,
      ],
    };
  });

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[820px]">
        <DataTable
          gridClass="grid grid-cols-[1.4fr_0.9fr_0.9fr_0.9fr_0.8fr_0.8fr_1fr_0.9fr] items-center gap-2"
          columns={[
            {
              key: "channel",
              label: "Channel",
              info: "Sessions tagged as Meta are shown under Paid Social, even where GA4 filed them elsewhere.",
            },
            { key: "sessions", label: "Sessions", align: "right" },
            { key: "engaged", label: "Engaged rate", align: "right" },
            { key: "atc", label: "ATC rate", align: "right" },
            { key: "cvr", label: "CVR", align: "right" },
            { key: "purchases", label: "Purchases", align: "right" },
            { key: "revenue", label: "Revenue", align: "right" },
            { key: "aov", label: "AOV", align: "right" },
          ]}
          rows={body}
        />
      </div>
    </div>
  );
}
