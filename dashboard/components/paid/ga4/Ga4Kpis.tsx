/**
 * The five GA4 tiles. Paid means Meta, Google and other paid platforms; purchases
 * GA4 recorded without a session never count here, only in the share's denominator.
 *
 * Rates are sum over sum (`lib/paid/math`). Counts and money change as a relative
 * move, rates as a point move, as the Paid rules say.
 */

import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { KpiTile } from "@/components/dashboard/KpiTile";
import { pointChange, ratio, relativeChange } from "@/lib/paid/math";
import type { Ga4Kpis as Ga4KpiData, Ga4Totals } from "@/lib/queries/paidGa4";

function cvr(t: Ga4Totals): number | null {
  return ratio(t.sessionsPurchase, t.sessions);
}
function paidShare(t: Ga4Totals): number | null {
  return ratio(t.revenue, t.allRevenue);
}

export function Ga4Kpis({ kpis, currency }: { kpis: Ga4KpiData; currency: string }) {
  const c = kpis.current;
  const p = kpis.previous;

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      <KpiTile
        label="Paid sessions"
        value={formatNumber(c.sessions)}
        delta={p ? relativeChange(c.sessions, p.sessions) : null}
        goodWhen="up"
      />
      <KpiTile
        label="Paid purchases"
        value={formatNumber(c.purchases)}
        delta={p ? relativeChange(c.purchases, p.purchases) : null}
        goodWhen="up"
      />
      <div className="col-span-2 md:col-span-1 [&>div]:h-full">
        <KpiTile
          label="Paid revenue"
          value={formatMoney(c.revenue, currency)}
          delta={p ? relativeChange(c.revenue, p.revenue) : null}
          goodWhen="up"
        />
      </div>
      <KpiTile
        label="Paid CVR"
        value={formatPercent(cvr(c), { decimals: 2 })}
        delta={p ? pointChange(cvr(c), cvr(p)) : null}
        goodWhen="up"
      />
      <KpiTile
        label="Paid share"
        value={formatPercent(paidShare(c))}
        delta={p ? pointChange(paidShare(c), paidShare(p)) : null}
        goodWhen="neutral"
      />
    </div>
  );
}
