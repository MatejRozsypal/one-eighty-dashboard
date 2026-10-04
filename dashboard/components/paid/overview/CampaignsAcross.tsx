/**
 * Campaigns, all platforms: the top campaigns by spend in one table.
 *
 * Money is in the display currency on every row, so Meta and Google rows are
 * comparable. Value is what the platform reports (Meta and Google can claim the
 * same order). A row is low volume when its spend is under 1% of the table's
 * total or it has fewer than 3 purchases: its ROAS and CPA are muted, marked,
 * and sort last. The delta columns appear only when comparison is on.
 */

import Link from "next/link";
import { DataTable, type DataTableRow } from "@/components/ui/DataTable";
import { DeltaChip } from "@/components/ui/Delta";
import { Value } from "@/components/ui/EmptyState";
import { NO_VALUE, formatMoney, formatNumber, formatRatio } from "@/lib/format";
import { isLowVolume, ratio, relativeChange, unlessLowVolume } from "@/lib/paid/math";
import { campaignType, type CampaignAgg } from "@/components/paid/overview/model";

const GRID_PLAIN =
  "grid grid-cols-[minmax(220px,2.2fr)_minmax(120px,1.2fr)_repeat(5,minmax(84px,1fr))] items-center gap-2";
const GRID_COMPARE =
  "grid grid-cols-[minmax(220px,2.2fr)_minmax(120px,1.2fr)_repeat(7,minmax(84px,1fr))] items-center gap-2";

const NUM = "font-mono text-[12.5px] tabular";

export function CampaignsAcross({
  rows,
  totalSpend,
  currency,
  comparing,
  hrefFor,
}: {
  rows: CampaignAgg[];
  /** Spend of every campaign, not just the rows shown: the low volume test is against the whole table. */
  totalSpend: number | null;
  currency: string;
  comparing: boolean;
  hrefFor: (c: CampaignAgg) => string;
}) {
  const columns = [
    { key: "campaign", label: "Campaign" },
    { key: "type", label: "Type" },
    { key: "spend", label: "Spend", align: "right" as const },
    ...(comparing ? [{ key: "dspend", label: "Δ Spend", align: "right" as const }] : []),
    {
      key: "value",
      label: "Value",
      align: "right" as const,
      info: "Platform-reported value. Meta and Google can claim the same order, so values can overlap.",
    },
    { key: "roas", label: "ROAS", align: "right" as const },
    ...(comparing ? [{ key: "droas", label: "Δ ROAS", align: "right" as const }] : []),
    { key: "cpa", label: "CPA", align: "right" as const },
    { key: "purchases", label: "Purchases", align: "right" as const },
  ];

  const tableRows: DataTableRow[] = rows.map((c) => {
    const roas = ratio(c.value, c.spend);
    const cpa = ratio(c.spend, c.purchases);
    const low = isLowVolume({ spend: c.spend, purchases: c.purchases }, totalSpend);
    const dSpend = relativeChange(c.spend, c.prevSpend);
    const dRoas = relativeChange(roas, ratio(c.prevValue, c.prevSpend));
    const type = campaignType(c);
    const muted = low ? "text-content-muted" : "text-content-strong";

    const lowDot = low ? (
      <span
        title="Low volume"
        aria-label="Low volume"
        className="mr-1.5 inline-block h-[6px] w-[6px] rounded-full bg-warning align-middle"
      />
    ) : null;

    const cells = [
      <Link
        key="n"
        href={hrefFor(c)}
        title={c.name ?? c.id}
        className="inline-flex min-w-0 items-center gap-2 text-[13px] text-content-strong hover:underline"
      >
        <span
          aria-hidden="true"
          className={`h-[9px] w-[9px] flex-none rounded-[3px] ${
            c.platform === "meta" ? "bg-platform-meta" : "bg-platform-google"
          }`}
        />
        <span className="truncate">{c.name ?? c.id}</span>
      </Link>,
      <span key="t" className="block truncate text-[12.5px] text-content-body"><Value>{type ?? NO_VALUE}</Value></span>,
      <span key="s" className={`${NUM} font-semibold text-content-strong`}><Value>{formatMoney(c.spend, currency)}</Value></span>,
      ...(comparing ? [<DeltaChip key="ds" delta={dSpend} goodWhen="neutral" />] : []),
      <span key="v" className={`${NUM} text-content-strong`}><Value>{formatMoney(c.value, currency)}</Value></span>,
      <span key="r" className={`${NUM} ${muted}`}>{lowDot}<Value>{formatRatio(roas)}</Value></span>,
      ...(comparing ? [<DeltaChip key="dr" delta={low ? null : dRoas} goodWhen="up" />] : []),
      <span key="c" className={`${NUM} ${muted}`}><Value>{formatMoney(cpa, currency, { unit: true })}</Value></span>,
      <span key="p" className={`${NUM} text-content-strong`}><Value>{formatNumber(c.purchases)}</Value></span>,
    ];

    const sort: Array<number | string | null> = [
      c.name ?? c.id,
      type,
      c.spend,
      ...(comparing ? [dSpend] : []),
      c.value,
      unlessLowVolume(roas, low),
      ...(comparing ? [low ? null : dRoas] : []),
      unlessLowVolume(cpa, low),
      c.purchases,
    ];

    return { key: `${c.platform}:${c.id}`, cells, sort };
  });

  return (
    <div className="overflow-x-auto">
      <div className={comparing ? "min-w-[1040px]" : "min-w-[860px]"}>
        <DataTable columns={columns} rows={tableRows} gridClass={comparing ? GRID_COMPARE : GRID_PLAIN} />
      </div>
    </div>
  );
}
