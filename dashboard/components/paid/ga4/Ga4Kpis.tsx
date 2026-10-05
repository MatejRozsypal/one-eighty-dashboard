/**
 * The five GA4 tiles. Paid means Meta, Google and other paid platforms; purchases
 * GA4 recorded without a session never count here, only in the share's denominator.
 *
 * Rates are sum over sum (`lib/paid/math`). Each tile's change follows the delta
 * toggle (percent or absolute); rates are always a point move, as the Paid rules say.
 */

import {
  formatMoney,
  formatNumber,
  formatPercent,
  type DeltaInput,
  type DeltaKind,
} from "@/lib/format";
import { KpiTile } from "@/components/dashboard/KpiTile";
import { ratio } from "@/lib/paid/math";
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
  const chg = (cur: number | null, prev: number | null, kind: DeltaKind): DeltaInput | null =>
    p ? { current: cur, previous: prev, kind, currency } : null;

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      <KpiTile
        label="Paid sessions"
        value={formatNumber(c.sessions)}
        change={p ? chg(c.sessions, p.sessions, "count") : null}
        goodWhen="up"
      />
      <KpiTile
        label="Paid purchases"
        value={formatNumber(c.purchases)}
        change={p ? chg(c.purchases, p.purchases, "count") : null}
        goodWhen="up"
      />
      <div className="col-span-2 md:col-span-1 [&>div]:h-full">
        <KpiTile
          label="Paid revenue"
          value={formatMoney(c.revenue, currency)}
          change={p ? chg(c.revenue, p.revenue, "money") : null}
          goodWhen="up"
        />
      </div>
      <KpiTile
        label="Paid CVR"
        value={formatPercent(cvr(c), { decimals: 2 })}
        change={p ? chg(cvr(c), cvr(p), "rate") : null}
        goodWhen="up"
      />
      <KpiTile
        label="Paid share"
        value={formatPercent(paidShare(c))}
        change={p ? chg(paidShare(c), paidShare(p), "rate") : null}
        goodWhen="neutral"
      />
    </div>
  );
}
