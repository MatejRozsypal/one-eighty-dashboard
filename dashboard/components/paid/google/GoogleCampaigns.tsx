/**
 * The campaigns table: one row per campaign with delivery in the range.
 *
 * Three column sets (Outcome, Auction, Budget) share the leading columns. The
 * campaign name links to `?campaign=` and opens the detail block below. Rates
 * come from summed components; a low-volume row mutes ROAS and CPA and sorts
 * them last. Delta columns exist only while a comparison is on.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/ui/DataTable";
import { DeltaChip } from "@/components/ui/Delta";
import { SegmentedControl, type Segment } from "@/components/controls/SegmentedControl";
import { NO_VALUE, formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import {
  absTopImpressionShare,
  isLowVolume,
  lostBudgetShare,
  lostRankShare,
  ratio,
  ratioOfSums,
  relativeChange,
  searchImpressionShare,
  sumOf,
  topImpressionShare,
  unlessLowVolume,
} from "@/lib/paid/math";
import type { BrandClass } from "@/lib/paid/types";
import type { GadsCampaignAgg } from "@/lib/queries/paidGoogle";
import { BRAND_CLASSES, rates } from "./aggregate";
import { biddingLabel, channelLabel, CLASS_LABEL } from "./labels";
import { NumCell, RatioCell, Section, SpendCell } from "./parts";

export type CampaignCols = "outcome" | "auction" | "budget";
export type ClassFilter = BrandClass | "all";

/**
 * Grid templates and minimum widths. Tailwind only emits classes it can read
 * whole in the source, so each combination is spelled out here.
 */
const GRID: Record<CampaignCols, { plain: string; compare: string }> = {
  outcome: {
    plain: "grid grid-cols-[minmax(0,2.4fr)_repeat(10,minmax(0,1fr))] items-center gap-2",
    compare: "grid grid-cols-[minmax(0,2.4fr)_repeat(12,minmax(0,1fr))] items-center gap-2",
  },
  auction: {
    plain: "grid grid-cols-[minmax(0,2.4fr)_repeat(9,minmax(0,1fr))] items-center gap-2",
    compare: "grid grid-cols-[minmax(0,2.4fr)_repeat(10,minmax(0,1fr))] items-center gap-2",
  },
  budget: {
    plain: "grid grid-cols-[minmax(0,2.4fr)_repeat(7,minmax(0,1fr))] items-center gap-2",
    compare: "grid grid-cols-[minmax(0,2.4fr)_repeat(8,minmax(0,1fr))] items-center gap-2",
  },
};

const MIN_WIDTH: Record<CampaignCols, { plain: string; compare: string }> = {
  outcome: { plain: "min-w-[1100px]", compare: "min-w-[1280px]" },
  auction: { plain: "min-w-[1000px]", compare: "min-w-[1100px]" },
  budget: { plain: "min-w-[900px]", compare: "min-w-[1000px]" },
};

function deltaCell(delta: number | null, goodWhen: "up" | "down" | "neutral"): ReactNode {
  return delta === null ? NO_VALUE : <DeltaChip delta={delta} goodWhen={goodWhen} />;
}

export function GoogleCampaigns({
  campaigns,
  currency,
  compare,
  cols,
  cls,
  selectedId,
  hrefFor,
}: {
  campaigns: GadsCampaignAgg[];
  currency: string;
  compare: boolean;
  cols: CampaignCols;
  cls: ClassFilter;
  selectedId: string | null;
  /** The link that selects a campaign (and keeps the rest of the view). */
  hrefFor: (campaignId: string) => string;
}) {
  const live = campaigns.filter((c) => c.current !== null && (c.current.spend ?? 0) > 0);
  const present = BRAND_CLASSES.filter((k) => live.some((c) => c.brandClass === k));
  const shown = (cls === "all" ? live : live.filter((c) => c.brandClass === cls)).sort(
    (a, b) => (b.current?.spend ?? 0) - (a.current?.spend ?? 0)
  );
  const tableSpend = sumOf(shown, (c) => c.current?.spend ?? null);

  const classSegments: Segment[] = [
    { value: "all", label: "All" },
    ...present.map((k) => ({ value: k, label: CLASS_LABEL[k] })),
  ];
  const colSegments: Segment[] = [
    { value: "outcome", label: "Outcome" },
    { value: "auction", label: "Auction" },
    { value: "budget", label: "Budget" },
  ];

  const money = (v: number | null) => formatMoney(v, currency);
  const unit = (v: number | null) => formatMoney(v, currency, { unit: true });

  const columns: DataTableColumn[] = [
    { key: "campaign", label: "Campaign" },
    { key: "type", label: "Type" },
    { key: "class", label: "Class" },
    { key: "spend", label: "Spend", align: "right" },
  ];
  if (compare) columns.push({ key: "dSpend", label: "Δ Spend", align: "right" });

  if (cols === "outcome") {
    columns.push({ key: "value", label: "Value", align: "right" });
    columns.push({ key: "roas", label: "ROAS", align: "right", info: "Purchase conversion value divided by spend." });
    if (compare) columns.push({ key: "dRoas", label: "Δ ROAS", align: "right" });
    columns.push(
      {
        key: "conv",
        label: "Conv.",
        align: "right",
        info: "Purchase conversions only.",
      },
      { key: "cpa", label: "CPA", align: "right" },
      { key: "cvr", label: "CVR", align: "right", info: "Conversions divided by clicks." },
      { key: "ctr", label: "CTR", align: "right" },
      { key: "cpc", label: "CPC", align: "right" }
    );
  } else if (cols === "auction") {
    columns.push(
      {
        key: "is",
        label: "Search IS",
        align: "right",
        info: "Impressions over eligible impressions. Shares under 10% are reported as a floor value.",
      },
      { key: "top", label: "Top IS", align: "right" },
      { key: "abs", label: "Abs. top IS", align: "right" },
      {
        key: "lostB",
        label: "Lost IS budget",
        align: "right",
        info: "Upper bound. Google reports shares under 10% as a floor value.",
      },
      {
        key: "lostR",
        label: "Lost IS rank",
        align: "right",
        info: "Upper bound. Google reports shares under 10% as a floor value.",
      },
      { key: "click", label: "Click share", align: "right" }
    );
  } else {
    columns.push(
      { key: "bid", label: "Bid strategy" },
      { key: "budget", label: "Budget/day", align: "right" },
      {
        key: "perDay",
        label: "Spend/day",
        align: "right",
        info: "Spend divided by the days the campaign delivered.",
      },
      {
        key: "util",
        label: "Utilisation",
        align: "right",
        info: "Spend per day over daily budget. Not shown for shared budgets.",
      }
    );
  }

  const rows: DataTableRow[] = shown.map((c) => {
    const m = c.current!;
    const prev = compare ? c.previous : null;
    const r = rates(m);
    const rp = rates(prev);
    const low = isLowVolume({ spend: m.spend, purchases: m.conversions }, tableSpend);
    const selected = c.campaignId === selectedId;

    const cells: ReactNode[] = [
      <Link
        key="name"
        href={hrefFor(c.campaignId)}
        scroll={false}
        title={c.campaignName}
        aria-current={selected ? "true" : undefined}
        className={`block truncate text-[13px] hover:underline ${
          selected ? "font-semibold text-content-strong" : "text-content-strong"
        }`}
      >
        {c.campaignName}
      </Link>,
      <span key="type" className="block truncate text-[12.5px] text-content-body">
        {channelLabel(c.channelType)}
      </span>,
      <span key="class" className="block truncate text-[12.5px] text-content-body">
        {CLASS_LABEL[c.brandClass]}
      </span>,
      <SpendCell key="spend" text={money(m.spend)} />,
    ];
    const sort: Array<number | string | null> = [
      c.campaignName,
      channelLabel(c.channelType),
      CLASS_LABEL[c.brandClass],
      m.spend,
    ];

    if (compare) {
      const d = relativeChange(m.spend, prev?.spend ?? null);
      cells.push(deltaCell(d, "neutral"));
      sort.push(d);
    }

    if (cols === "outcome") {
      const dRoas = low ? null : relativeChange(r.roas, rp.roas);
      cells.push(
        <NumCell key="value" text={money(m.value)} />,
        <RatioCell key="roas" text={formatRatio(r.roas)} low={low} />
      );
      sort.push(m.value, unlessLowVolume(r.roas, low));
      if (compare) {
        cells.push(deltaCell(dRoas, "up"));
        sort.push(dRoas);
      }
      cells.push(
        <NumCell key="conv" text={formatNumber(m.conversions, { decimals: 1 })} />,
        <RatioCell key="cpa" text={unit(r.cpa)} low={low} />,
        <NumCell key="cvr" text={formatPercent(r.cvr, { decimals: 2 })} />,
        <NumCell key="ctr" text={formatPercent(r.ctr, { decimals: 2 })} />,
        <NumCell key="cpc" text={unit(r.cpc)} />
      );
      sort.push(m.conversions, unlessLowVolume(r.cpa, low), r.cvr, r.ctr, r.cpc);
    } else if (cols === "auction") {
      const sis = searchImpressionShare([m]);
      const top = topImpressionShare([m]);
      const abs = absTopImpressionShare([m]);
      const lb = lostBudgetShare([m]);
      const lr = lostRankShare([m]);
      const cs = ratioOfSums([m], (x) => x.clickShareClicks, (x) => x.eligibleClicks);
      cells.push(
        <NumCell key="is" text={formatPercent(sis)} />,
        <NumCell key="top" text={formatPercent(top)} />,
        <NumCell key="abs" text={formatPercent(abs)} />,
        <NumCell key="lostB" text={formatPercent(lb)} />,
        <NumCell key="lostR" text={formatPercent(lr)} />,
        <NumCell key="click" text={formatPercent(cs)} />
      );
      sort.push(sis, top, abs, lb, lr, cs);
    } else {
      const perDay = ratio(m.spend, m.daysWithDelivery);
      const util = c.budgetShared ? null : ratio(perDay, c.budgetPerDay);
      const bid = biddingLabel(c.biddingStrategyType);
      const target = c.targetRoas !== null && c.targetRoas > 0 ? ` · target ${formatRatio(c.targetRoas)}` : "";
      cells.push(
        <span key="bid" className="block truncate text-[12.5px] text-content-body" title={`${bid ?? NO_VALUE}${target}`}>
          {bid ? `${bid}${target}` : NO_VALUE}
        </span>,
        <NumCell key="budget" text={money(c.budgetPerDay)} />,
        <NumCell key="perDay" text={money(perDay)} />,
        <NumCell key="util" text={formatPercent(util, { decimals: 0 })} />
      );
      sort.push(bid, c.budgetPerDay, perDay, util);
    }

    return { key: c.campaignId, cells, sort };
  });

  const width = MIN_WIDTH[cols][compare ? "compare" : "plain"];

  return (
    <Section
      title="Campaigns"
      controls={
        <>
          <SegmentedControl param="class" segments={classSegments} active={cls} ariaLabel="Class" />
          <SegmentedControl param="cols" segments={colSegments} active={cols} ariaLabel="Columns" />
        </>
      }
    >
      <div className="overflow-x-auto">
        <div className={width}>
          <DataTable
            gridClass={GRID[cols][compare ? "compare" : "plain"]}
            columns={columns}
            rows={rows}
          />
        </div>
      </div>
    </Section>
  );
}
