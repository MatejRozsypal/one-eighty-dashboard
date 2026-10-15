"use client";

/**
 * Funnel by market from GA4: sessions, engaged sessions, unpaid share,
 * add-to-cart rate and purchase CVR, each rate indexed to the home market
 * (home = 100) and, with Compare on, its change in the delta mode.
 */

import { DataTable, type DataTableRow } from "@/components/ui/DataTable";
import { DeltaChip } from "@/components/ui/Delta";
import { InfoTip } from "@/components/ui/InfoTip";
import { NoValue } from "@/components/ui/EmptyState";
import { formatNumber, formatPercent } from "@/lib/format";
import { isNa, type Val } from "@/lib/markets/model";
import type { FunnelRow } from "@/lib/markets/analysis";
import { marketLabel } from "@/components/markets/trends/bits";

function RateCell({ v, prev, index, showIndex, comparing }: { v: Val; prev: Val | null; index: Val; showIndex: boolean; comparing: boolean }) {
  if (isNa(v)) {
    return (
      <span className="inline-flex items-center gap-1 text-content-muted">
        <NoValue />
        <InfoTip text={v.na} label="Why n/a" />
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="tabular text-content-strong">{formatPercent(v.v)}</span>
      <span className="flex items-center gap-2 text-[11px] text-content-muted">
        {showIndex && !isNa(index) && <span className="tabular">idx {formatNumber(index.v)}</span>}
        {comparing && prev && !isNa(prev) && <DeltaChip change={{ current: v.v, previous: prev.v, kind: "rate" }} className="text-[11px]" />}
      </span>
    </span>
  );
}

export function FunnelTable({ rows, home, comparing }: { rows: FunnelRow[]; home: string | null; comparing: boolean }) {
  const val = (v: Val) => (isNa(v) ? null : v.v);
  const tableRows: DataTableRow[] = rows.map((r) => ({
    key: r.market,
    cells: [
      <span key="m" className="font-mono text-content-strong">
        {marketLabel(r.market)}
        {r.market === home && <span className="ml-1.5 text-[11px] text-content-muted">home</span>}
      </span>,
      <span key="s" className="flex flex-col items-end gap-0.5">
        <span className="tabular text-content-strong">{formatNumber(r.sessions)}</span>
        {comparing && r.previous && (
          <DeltaChip change={{ current: r.sessions, previous: r.previous.sessions, kind: "count" }} className="text-[11px]" />
        )}
      </span>,
      <span key="e" className="tabular">{formatNumber(r.engagedSessions)}</span>,
      <RateCell key="u" v={r.unpaidShare} prev={r.previous?.unpaidShare ?? null} index={r.index.unpaidShare} showIndex={r.market !== home} comparing={comparing} />,
      <RateCell key="a" v={r.addToCartRate} prev={r.previous?.addToCartRate ?? null} index={r.index.addToCartRate} showIndex={r.market !== home} comparing={comparing} />,
      <RateCell key="c" v={r.cvr} prev={r.previous?.cvr ?? null} index={r.index.cvr} showIndex={r.market !== home} comparing={comparing} />,
    ],
    sort: [
      r.market,
      r.sessions,
      r.engagedSessions,
      val(r.unpaidShare),
      val(r.addToCartRate),
      val(r.cvr),
    ],
  }));
  return (
    <div className="-mx-4 overflow-x-auto sm:-mx-5">
      <div className="min-w-[680px]">
        <DataTable
          gridClass="grid grid-cols-[minmax(90px,1fr)_repeat(5,minmax(96px,1fr))] items-center gap-2"
          columns={[
            { key: "market", label: "Market", sortable: true },
            { key: "sessions", label: "Sessions", align: "right", sortable: true },
            { key: "engaged", label: "Engaged", align: "right", sortable: true, info: "GA4 engaged sessions: 10 seconds or more, 2 or more page views, or a conversion." },
            { key: "unpaid", label: "Unpaid", align: "right", sortable: true, info: "Unpaid engaged sessions (organic and direct) / engaged sessions. idx = this market vs the home market, home = 100." },
            { key: "atc", label: "ATC rate", align: "right", sortable: true, info: "Sessions with an add to cart / sessions. idx = vs the home market, home = 100." },
            { key: "cvr", label: "CVR", align: "right", sortable: true, info: "GA4 purchases / sessions. GA4 sees fewer purchases than the shop (consent, blockers), so read it against the home market, not as the shop's own rate." },
          ]}
          rows={tableRows}
        />
      </div>
    </div>
  );
}
