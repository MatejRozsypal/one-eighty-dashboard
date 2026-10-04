/**
 * The campaign table of the Meta tab.
 *
 * Three column sets (Outcome, Funnel, Delivery) keep the table narrow; the
 * choice lives in `?cols=`. Stage and market narrow the rows (`?stage=`,
 * `?market=`). A campaign name sets `?campaign=` and jumps to its detail block,
 * so the selection is a link and survives a reload. The arrow beside a name
 * opens Creative filtered to that campaign.
 *
 * Every rate is a ratio of the row's summed components. A row under 1 percent
 * of the table's spend, or with fewer than 3 purchases, shows ROAS and CPA
 * muted with a "Low volume" dot and sorts last on both.
 */

import { AppLink } from "@/components/ui/AppLink";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/ui/DataTable";
import { SegmentedControl } from "@/components/controls/SegmentedControl";
import { formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import { isLowVolume, relativeChange, sumOf, unlessLowVolume } from "@/lib/paid/math";
import { creativeHref } from "@/lib/paid/links";
import type { ViewParams } from "@/lib/params";
import type { FunnelStage } from "@/lib/paid/types";
import {
  STAGE_LABEL,
  STAGE_ORDER,
  hookRate,
  marketLabel,
  ratesOf,
  type CampaignAgg,
} from "@/components/paid/meta/aggregate";
import type { MetaVideoRow } from "@/lib/queries/paidMeta";
import { DeltaCell, Fig, LowVolumeFig } from "@/components/paid/meta/cells";
import { metaHref, type SearchState } from "@/components/paid/meta/links";

export type ColumnSet = "outcome" | "funnel" | "delivery";

export const COLUMN_SETS: readonly ColumnSet[] = ["outcome", "funnel", "delivery"];

/** Grid templates written out in full so Tailwind sees every class. */
const GRID: Record<`${ColumnSet}-${"plain" | "compare"}`, string> = {
  "outcome-plain":
    "grid grid-cols-[2.2fr_0.9fr_0.9fr_0.9fr_0.7fr_0.7fr_0.7fr_0.7fr] items-center gap-2",
  "outcome-compare":
    "grid grid-cols-[2.2fr_0.9fr_0.9fr_0.8fr_0.9fr_0.7fr_0.8fr_0.7fr_0.7fr_0.7fr] items-center gap-2",
  "funnel-plain":
    "grid grid-cols-[2.2fr_0.9fr_0.9fr_0.7fr_0.7fr_0.7fr_0.7fr_0.7fr_0.7fr] items-center gap-2",
  "funnel-compare":
    "grid grid-cols-[2.2fr_0.9fr_0.9fr_0.8fr_0.7fr_0.7fr_0.7fr_0.7fr_0.7fr_0.7fr] items-center gap-2",
  "delivery-plain":
    "grid grid-cols-[2.2fr_0.9fr_0.9fr_0.9fr_0.7fr_0.7fr_0.8fr_0.7fr] items-center gap-2",
  "delivery-compare":
    "grid grid-cols-[2.2fr_0.9fr_0.9fr_0.8fr_0.9fr_0.7fr_0.7fr_0.8fr_0.7fr] items-center gap-2",
};

export function MetaCampaigns({
  campaigns,
  videoByCampaign,
  currency,
  hasComparison,
  cols,
  stage,
  market,
  stageOptions,
  marketOptions,
  selectedId,
  search,
  view,
}: {
  /** Already narrowed by stage and market. */
  campaigns: CampaignAgg[];
  videoByCampaign: Map<string, MetaVideoRow>;
  /** Ad account currency. */
  currency: string;
  hasComparison: boolean;
  cols: ColumnSet;
  stage: string;
  market: string;
  stageOptions: FunnelStage[];
  marketOptions: string[];
  selectedId?: string;
  search: SearchState;
  view: ViewParams;
}) {
  const totalSpend = sumOf(campaigns, (c) => c.current.spend);
  const unit = (v: number | null) => formatMoney(v, currency, { unit: true });
  const money = (v: number | null) => formatMoney(v, currency);
  const pct = (v: number | null, d = 2) => formatPercent(v, { decimals: d });

  const columns: DataTableColumn[] = [
    { key: "campaign", label: "Campaign" },
    { key: "stage", label: "Stage" },
    { key: "spend", label: "Spend", align: "right" },
  ];
  if (hasComparison) columns.push({ key: "dSpend", label: "Δ Spend", align: "right" });

  if (cols === "outcome") {
    columns.push({ key: "value", label: "Value", align: "right" });
    columns.push({ key: "roas", label: "ROAS", align: "right" });
    if (hasComparison) columns.push({ key: "dRoas", label: "Δ ROAS", align: "right" });
    columns.push(
      { key: "purchases", label: "Purchases", align: "right" },
      { key: "cpa", label: "CPA", align: "right" },
      { key: "aov", label: "AOV", align: "right" }
    );
  } else if (cols === "funnel") {
    columns.push(
      { key: "ctr", label: "Link CTR", align: "right", info: "Link clicks / impressions." },
      { key: "lpvRate", label: "LPV rate", align: "right", info: "Landing page views / link clicks." },
      { key: "cpl", label: "Cost / LPV", align: "right" },
      { key: "atcRate", label: "ATC rate", align: "right", info: "Add to cart / landing page views." },
      { key: "cpatc", label: "Cost / ATC", align: "right" },
      { key: "atcp", label: "ATC to purchase", align: "right" }
    );
  } else {
    columns.push(
      { key: "impr", label: "Impressions", align: "right" },
      { key: "cpm", label: "CPM", align: "right" },
      { key: "cpc", label: "CPC (link)", align: "right" },
      { key: "freq", label: "Avg daily frequency", align: "right" },
      { key: "hook", label: "Hook rate", align: "right", info: "3-second video plays / impressions. Video ads only." }
    );
  }

  const rows: DataTableRow[] = campaigns.map((c) => {
    const cur = c.current;
    const r = ratesOf(cur);
    const pr = c.previous ? ratesOf(c.previous) : null;
    const low = isLowVolume({ spend: cur.spend, purchases: cur.purchases }, totalSpend);
    const selected = c.campaignId === selectedId;
    const hook = (() => {
      const v = videoByCampaign.get(c.campaignId);
      return v ? hookRate(v.current) : null;
    })();

    const nameCell = (
      <span className="flex min-w-0 items-center gap-2">
        <AppLink
          href={metaHref(search, { campaign: c.campaignId, adset: null }, "campaign-detail")}
          title={c.name}
          aria-current={selected ? "true" : undefined}
          className={`block min-w-0 truncate text-[13px] hover:underline ${
            selected ? "font-semibold text-content-accent" : "text-content-strong"
          }`}
        >
          {c.name}
        </AppLink>
        <AppLink
          href={creativeHref(view, { field: "campaignId", value: c.campaignId })}
          aria-label="Open in Creative"
          title="Open in Creative"
          className="flex-none text-[12px] text-content-muted hover:text-content-strong"
        >
          ↗
        </AppLink>
      </span>
    );
    const stageCell = (
      <span className="font-mono text-[11px] text-content-muted">{STAGE_LABEL[c.funnelStage]}</span>
    );

    const cells: DataTableRow["cells"] = [nameCell, stageCell, <Fig strong>{money(cur.spend)}</Fig>];
    const sort: DataTableRow["sort"] = [c.name, STAGE_LABEL[c.funnelStage], cur.spend];

    if (hasComparison) {
      const d = relativeChange(cur.spend, c.previous?.spend ?? null);
      cells.push(DeltaCell({ delta: d, goodWhen: "neutral" }));
      sort.push(d);
    }

    if (cols === "outcome") {
      cells.push(<Fig>{money(cur.revenue)}</Fig>);
      sort.push(cur.revenue);
      cells.push(<LowVolumeFig low={low}>{formatRatio(r.roas)}</LowVolumeFig>);
      sort.push(unlessLowVolume(r.roas, low));
      if (hasComparison) {
        const d = low ? null : relativeChange(r.roas, pr?.roas ?? null);
        cells.push(DeltaCell({ delta: d }));
        sort.push(d);
      }
      cells.push(<Fig>{formatNumber(cur.purchases)}</Fig>);
      sort.push(cur.purchases);
      cells.push(<LowVolumeFig low={low}>{unit(r.cpa)}</LowVolumeFig>);
      sort.push(unlessLowVolume(r.cpa, low));
      cells.push(<Fig>{unit(r.aov)}</Fig>);
      sort.push(r.aov);
    } else if (cols === "funnel") {
      const set: Array<[number | null, string]> = [
        [r.linkCtr, pct(r.linkCtr)],
        [r.lpvRate, pct(r.lpvRate, 1)],
        [r.costPerLpv, unit(r.costPerLpv)],
        [r.atcRate, pct(r.atcRate, 1)],
        [r.costPerAtc, unit(r.costPerAtc)],
        [r.atcToPurchase, pct(r.atcToPurchase, 1)],
      ];
      for (const [key, text] of set) {
        cells.push(<Fig>{text}</Fig>);
        sort.push(key);
      }
    } else {
      const set: Array<[number | null, string]> = [
        [cur.impressions, formatNumber(cur.impressions)],
        [r.cpm, unit(r.cpm)],
        [r.cpc, unit(r.cpc)],
        [r.frequency, formatNumber(r.frequency, { decimals: 2 })],
        [hook, pct(hook, 1)],
      ];
      for (const [key, text] of set) {
        cells.push(<Fig>{text}</Fig>);
        sort.push(key);
      }
    }

    return { key: c.campaignId, cells, sort };
  });

  const stageSegments = [
    { value: "all", label: "All" },
    ...stageOptions.map((s) => ({ value: s, label: STAGE_LABEL[s] })),
  ];
  const marketSegments = [
    { value: "all", label: "All" },
    ...marketOptions.map((m) => ({ value: m, label: m })),
  ];

  return (
    <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
        <h2 className="font-mono text-eyebrow font-medium uppercase tracking-eyebrow text-content-muted">
          Campaigns
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {stageOptions.length > 1 && (
            <SegmentedControl
              param="stage"
              ariaLabel="Stage"
              active={stage}
              segments={stageSegments}
            />
          )}
          {marketOptions.length > 1 && (
            <SegmentedControl
              param="market"
              ariaLabel="Market"
              active={market}
              segments={marketSegments}
            />
          )}
          <SegmentedControl
            param="cols"
            ariaLabel="Columns"
            active={cols}
            segments={[
              { value: "outcome", label: "Outcome" },
              { value: "funnel", label: "Funnel" },
              { value: "delivery", label: "Delivery" },
            ]}
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[960px]">
          <DataTable
            columns={columns}
            rows={rows}
            gridClass={GRID[`${cols}-${hasComparison ? "compare" : "plain"}`]}
          />
        </div>
      </div>
    </section>
  );
}

/** Stage values that exist in the data, in the display order. */
export function stagesPresent(campaigns: readonly CampaignAgg[]): FunnelStage[] {
  const have = new Set(campaigns.map((c) => c.funnelStage));
  return STAGE_ORDER.filter((s) => have.has(s));
}

/** Market values that exist in the data, "Unknown" last. */
export function marketsPresent(campaigns: readonly CampaignAgg[]): string[] {
  const have = new Set(campaigns.map((c) => marketLabel(c.market)));
  return [...have].sort((a, b) => (a === "Unknown" ? 1 : b === "Unknown" ? -1 : a.localeCompare(b)));
}
