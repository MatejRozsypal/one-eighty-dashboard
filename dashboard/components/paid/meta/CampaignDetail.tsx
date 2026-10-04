/**
 * The selected campaign: its ad sets and its top ads.
 *
 * Shown only while `?campaign=` is set. An ad set name sets `?adset=`, which
 * narrows the ads table to that ad set; the x removes both. Ads link out to
 * Creative (`focus=adId`): thumbnails and creative scoring are Creative's job
 * and are deliberately not repeated here.
 */

import { AppLink } from "@/components/ui/AppLink";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/ui/DataTable";
import { formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import { isLowVolume, perThousand, ratio, sumOf, unlessLowVolume } from "@/lib/paid/math";
import { creativeHref } from "@/lib/paid/links";
import type { ViewParams } from "@/lib/params";
import type { MetaAdRow, MetaAdsetRow } from "@/lib/queries/paidMeta";
import { Fig, LowVolumeFig } from "@/components/paid/meta/cells";
import { metaHref, type SearchState } from "@/components/paid/meta/links";

const ADSET_GRID =
  "grid grid-cols-[2.2fr_0.9fr_0.7fr_0.8fr_0.7fr_0.7fr_0.8fr_0.8fr] items-center gap-2";
const AD_GRID =
  "grid grid-cols-[2.2fr_0.9fr_0.7fr_0.8fr_0.7fr_0.8fr_0.9fr_0.7fr_0.7fr] items-center gap-2";

export function CampaignDetail({
  campaignName,
  currency,
  adsets,
  ads,
  adsetId,
  search,
  view,
}: {
  campaignName: string;
  /** Ad account currency. */
  currency: string;
  adsets: MetaAdsetRow[];
  ads: MetaAdRow[];
  adsetId?: string;
  search: SearchState;
  view: ViewParams;
}) {
  const unit = (v: number | null) => formatMoney(v, currency, { unit: true });
  const pct = (v: number | null, d = 2) => formatPercent(v, { decimals: d });

  // ── Ad sets ────────────────────────────────────────────────────────────────
  const adsetTotal = sumOf(adsets, (a) => a.spend);
  const adsetColumns: DataTableColumn[] = [
    { key: "adset", label: "Ad set" },
    { key: "spend", label: "Spend", align: "right" },
    { key: "roas", label: "ROAS", align: "right" },
    { key: "purchases", label: "Purchases", align: "right" },
    { key: "cpa", label: "CPA", align: "right" },
    { key: "cpm", label: "CPM", align: "right" },
    { key: "ctr", label: "Link CTR", align: "right" },
    { key: "cpatc", label: "Cost / ATC", align: "right" },
  ];
  const adsetRows: DataTableRow[] = adsets.map((a) => {
    const low = isLowVolume({ spend: a.spend, purchases: a.purchases }, adsetTotal);
    const roas = ratio(a.revenue, a.spend);
    const cpa = ratio(a.spend, a.purchases);
    const cpm = perThousand(a.spend, a.impressions);
    const ctr = ratio(a.linkClicks, a.impressions);
    const cpatc = ratio(a.spend, a.addToCart);
    const selected = a.adsetId === adsetId;
    const label = a.name ?? a.adsetId;
    return {
      key: a.adsetId,
      sort: [label, a.spend, unlessLowVolume(roas, low), a.purchases, unlessLowVolume(cpa, low), cpm, ctr, cpatc],
      cells: [
        <AppLink
          href={metaHref(search, { adset: selected ? null : a.adsetId }, "campaign-detail")}
          title={label}
          aria-current={selected ? "true" : undefined}
          className={`block truncate text-[13px] hover:underline ${
            selected ? "font-semibold text-content-accent" : "text-content-strong"
          }`}
        >
          {label}
        </AppLink>,
        <Fig strong>{formatMoney(a.spend, currency)}</Fig>,
        <LowVolumeFig low={low}>{formatRatio(roas)}</LowVolumeFig>,
        <Fig>{formatNumber(a.purchases)}</Fig>,
        <LowVolumeFig low={low}>{unit(cpa)}</LowVolumeFig>,
        <Fig>{unit(cpm)}</Fig>,
        <Fig>{pct(ctr)}</Fig>,
        <Fig>{unit(cpatc)}</Fig>,
      ],
    };
  });

  // ── Ads ────────────────────────────────────────────────────────────────────
  const adTotal = sumOf(ads, (a) => a.spend);
  const adColumns: DataTableColumn[] = [
    { key: "ad", label: "Ad" },
    { key: "spend", label: "Spend", align: "right" },
    { key: "roas", label: "ROAS", align: "right" },
    { key: "purchases", label: "Purchases", align: "right" },
    { key: "cpa", label: "CPA", align: "right" },
    { key: "ctr", label: "Link CTR", align: "right" },
    { key: "octr", label: "Outbound CTR", align: "right", info: "Outbound clicks / impressions." },
    { key: "hook", label: "Hook", align: "right", info: "3-second video plays / impressions. Video ads only." },
    { key: "hold", label: "Hold", align: "right", info: "ThruPlays / impressions. Video ads only." },
  ];
  const adRows: DataTableRow[] = ads.map((a) => {
    const low = isLowVolume({ spend: a.spend, purchases: a.purchases }, adTotal);
    const roas = ratio(a.revenue, a.spend);
    const cpa = ratio(a.spend, a.purchases);
    const ctr = ratio(a.linkClicks, a.impressions);
    const octr = ratio(a.outboundClicks, a.impressions);
    const isVideo = a.isVideo ?? (a.videoPlays !== null && a.videoPlays > 0);
    const hook = isVideo ? ratio(a.videoPlays, a.impressions) : null;
    const hold = isVideo ? ratio(a.videoThruplays, a.impressions) : null;
    const label = a.name ?? a.adId;
    return {
      key: a.adId,
      sort: [label, a.spend, unlessLowVolume(roas, low), a.purchases, unlessLowVolume(cpa, low), ctr, octr, hook, hold],
      cells: [
        <span className="flex min-w-0 items-center gap-2">
          <span className="block min-w-0 truncate text-[13px] text-content-strong" title={label}>
            {label}
          </span>
          <AppLink
            href={creativeHref(view, { field: "adId", value: a.adId })}
            aria-label="Open in Creative"
            title="Open in Creative"
            className="flex-none text-[12px] text-content-muted hover:text-content-strong"
          >
            ↗
          </AppLink>
        </span>,
        <Fig strong>{formatMoney(a.spend, currency)}</Fig>,
        <LowVolumeFig low={low}>{formatRatio(roas)}</LowVolumeFig>,
        <Fig>{formatNumber(a.purchases)}</Fig>,
        <LowVolumeFig low={low}>{unit(cpa)}</LowVolumeFig>,
        <Fig>{pct(ctr)}</Fig>,
        <Fig>{pct(octr)}</Fig>,
        <Fig>{pct(hook, 1)}</Fig>,
        <Fig>{pct(hold, 1)}</Fig>,
      ],
    };
  });

  return (
    <section
      id="campaign-detail"
      className="scroll-mt-[calc(var(--header-h)+var(--paid-tabs-h)+64px)] overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
        <h2 className="min-w-0 truncate text-[14px] font-semibold text-content-strong" title={campaignName}>
          {campaignName}
        </h2>
        <AppLink
          href={metaHref(search, { campaign: null, adset: null })}
          aria-label="Close"
          title="Close"
          className="flex-none rounded-full px-2 text-[16px] leading-none text-content-muted hover:text-content-strong"
        >
          ×
        </AppLink>
      </div>

      <div className="flex flex-col gap-1">
        <div className="px-5 pb-1 pt-4 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
          Ad sets
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[860px]">
            <DataTable columns={adsetColumns} rows={adsetRows} gridClass={ADSET_GRID} />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1 border-t border-hairline">
        <div className="px-5 pb-1 pt-4 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
          Ads
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[960px]">
            <DataTable columns={adColumns} rows={adRows} gridClass={AD_GRID} />
          </div>
        </div>
      </div>
    </section>
  );
}
