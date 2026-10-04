/**
 * Landing pages of paid sessions, top 50 by sessions. `?lp=all|meta|google`
 * filters to one platform; the share columns show where a page's paid
 * sessions came from within the rows on screen, one per connected platform.
 */

import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { SegmentedControl } from "@/components/controls/SegmentedControl";
import { DataTable } from "@/components/ui/DataTable";
import { Value } from "@/components/ui/EmptyState";
import { ratio } from "@/lib/paid/math";
import type { Ga4LandingFilter, Ga4LandingRow } from "@/lib/queries/paidGa4";

const mono = "font-mono text-[12.5px] tabular text-content-strong";

/** Grid templates written out in full so Tailwind sees every class. */
const GRID = {
  both: "grid grid-cols-[2.2fr_0.8fr_0.8fr_0.8fr_0.9fr_0.8fr_0.8fr_1fr] items-center gap-2",
  one: "grid grid-cols-[2.2fr_0.8fr_0.8fr_0.9fr_0.8fr_0.8fr_1fr] items-center gap-2",
  none: "grid grid-cols-[2.2fr_0.8fr_0.9fr_0.8fr_0.8fr_1fr] items-center gap-2",
} as const;

export function LandingPages({
  rows,
  currency,
  filter,
  hasMeta,
  hasGoogle,
}: {
  rows: Ga4LandingRow[];
  currency: string;
  filter: Ga4LandingFilter;
  hasMeta: boolean;
  hasGoogle: boolean;
}) {
  const segments = [
    { value: "all", label: "All" },
    ...(hasMeta ? [{ value: "meta", label: "Meta" }] : []),
    ...(hasGoogle ? [{ value: "google", label: "Google" }] : []),
  ];

  const body = rows.map((r) => {
    const metaShare = ratio(r.metaSessions, r.sessions);
    const googleShare = ratio(r.googleSessions, r.sessions);
    const engaged = ratio(r.engagedSessions, r.sessions);
    const atc = ratio(r.sessionsAtc, r.sessions);
    const cvr = ratio(r.sessionsPurchase, r.sessions);
    const cells = [
      <span key="p" className="block truncate font-mono text-[12px] text-content-strong" title={r.path}>
        {r.path}
      </span>,
      <span key="s" className={mono}><Value>{formatNumber(r.sessions)}</Value></span>,
    ];
    const sort: Array<string | number | null> = [r.path, r.sessions];
    if (hasMeta) {
      cells.push(<span key="m" className={mono}><Value>{formatPercent(metaShare)}</Value></span>);
      sort.push(metaShare);
    }
    if (hasGoogle) {
      cells.push(<span key="g" className={mono}><Value>{formatPercent(googleShare)}</Value></span>);
      sort.push(googleShare);
    }
    cells.push(
      <span key="e" className={mono}><Value>{formatPercent(engaged)}</Value></span>,
      <span key="a" className={mono}><Value>{formatPercent(atc)}</Value></span>,
      <span key="v" className={mono}><Value>{formatPercent(cvr, { decimals: 2 })}</Value></span>,
      <span key="r" className={mono}><Value>{formatMoney(r.revenue, currency)}</Value></span>
    );
    sort.push(engaged, atc, cvr, r.revenue);
    return { key: r.path, sort, cells };
  });

  const columns = [
    { key: "path", label: "Landing page" },
    { key: "sessions", label: "Sessions", align: "right" as const },
    ...(hasMeta ? [{ key: "meta", label: "Meta share", align: "right" as const }] : []),
    ...(hasGoogle ? [{ key: "google", label: "Google share", align: "right" as const }] : []),
    { key: "engaged", label: "Engaged rate", align: "right" as const },
    { key: "atc", label: "ATC rate", align: "right" as const },
    { key: "cvr", label: "CVR", align: "right" as const },
    { key: "revenue", label: "Revenue", align: "right" as const },
  ];
  const gridClass = GRID[hasMeta && hasGoogle ? "both" : hasMeta || hasGoogle ? "one" : "none"];

  return (
    <div className="flex flex-col">
      {segments.length > 1 && (
        <div className="overflow-x-auto px-5 pb-4">
          <SegmentedControl param="lp" ariaLabel="Landing page platform" active={filter} segments={segments} />
        </div>
      )}
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          <DataTable gridClass={gridClass} columns={columns} rows={body} />
        </div>
      </div>
    </div>
  );
}
