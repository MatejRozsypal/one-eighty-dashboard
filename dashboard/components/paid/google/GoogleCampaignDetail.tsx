/**
 * The block under the campaigns table for the selected campaign.
 *
 * Search, Shopping and the other ad group types show their ad groups. PMax has
 * no ad groups, so it shows the channel split of that campaign instead. Every
 * campaign shows its device split: spend share and ROAS per device.
 */

import { AppLink } from "@/components/ui/AppLink";
import { DataTable, type DataTableRow } from "@/components/ui/DataTable";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { NoData } from "@/components/ui/EmptyState";
import { formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import { isLowVolume, ratio, sumOf, unlessLowVolume } from "@/lib/paid/math";
import type {
  GadsAdGroupRow,
  GadsCampaignAgg,
  GadsDeviceRow,
  GadsPmaxNetworkRow,
} from "@/lib/queries/paidGoogle";
import { channelLabel, deviceLabel } from "./labels";
import { NumCell, RatioCell, SpendCell, TextCell } from "./parts";
import { PmaxBars } from "./PmaxSplit";

const AD_GROUP_GRID =
  "grid grid-cols-[minmax(0,2.2fr)_repeat(7,minmax(0,1fr))] items-center gap-2";

export function GoogleCampaignDetail({
  campaign,
  adGroups,
  devices,
  pmaxRows,
  currency,
  closeHref,
}: {
  campaign: GadsCampaignAgg;
  adGroups: GadsAdGroupRow[];
  devices: GadsDeviceRow[];
  pmaxRows: GadsPmaxNetworkRow[];
  currency: string;
  closeHref: string;
}) {
  const isPmax = campaign.channelType === "PERFORMANCE_MAX";
  const unit = (v: number | null) => formatMoney(v, currency, { unit: true });

  const groupSpend = sumOf(adGroups, (g) => g.spend);
  const adGroupRows: DataTableRow[] = adGroups.map((g) => {
    const roas = ratio(g.value, g.spend);
    const cpa = ratio(g.spend, g.conversions);
    const ctr = ratio(g.clicks, g.impressions);
    const cpc = ratio(g.spend, g.clicks);
    const low = isLowVolume({ spend: g.spend, purchases: g.conversions }, groupSpend);
    return {
      key: g.adGroupId,
      sort: [g.adGroupName, g.spend, g.value, unlessLowVolume(roas, low), g.conversions, unlessLowVolume(cpa, low), ctr, cpc],
      cells: [
        <TextCell key="n" text={g.adGroupName} />,
        <SpendCell key="s" text={formatMoney(g.spend, currency)} />,
        <NumCell key="v" text={formatMoney(g.value, currency)} />,
        <RatioCell key="r" text={formatRatio(roas)} low={low} />,
        <NumCell key="c" text={formatNumber(g.conversions, { decimals: 1 })} />,
        <RatioCell key="a" text={unit(cpa)} low={low} />,
        <NumCell key="t" text={formatPercent(ctr, { decimals: 2 })} />,
        <NumCell key="p" text={unit(cpc)} />,
      ],
    };
  });

  const deviceSpend = sumOf(devices, (d) => d.spend) ?? 0;

  return (
    <section className="flex flex-col gap-5 rounded-card border border-hairline bg-surface-card p-[20px_20px] shadow-sm lg:p-[22px_26px]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Eyebrow>{channelLabel(campaign.channelType)}</Eyebrow>
          <span className="truncate text-[15px] font-semibold text-content-strong" title={campaign.campaignName}>
            {campaign.campaignName}
          </span>
        </div>
        <AppLink
          href={closeHref}
          scroll={false}
          aria-label="Close campaign"
          className="flex-none rounded-pill border border-hairline px-3 py-1.5 font-mono text-[11px] text-content-muted transition-colors duration-fast hover:text-content-strong"
        >
          Close
        </AppLink>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Eyebrow>{isPmax ? "Channels" : "Ad groups"}</Eyebrow>
          {isPmax ? (
            pmaxRows.length > 0 ? (
              <PmaxBars rows={pmaxRows} currency={currency} />
            ) : (
              <NoData />
            )
          ) : (
            <div className="overflow-x-auto rounded-card border border-hairline">
              <div className="min-w-[760px]">
                <DataTable
                  gridClass={AD_GROUP_GRID}
                  columns={[
                    { key: "n", label: "Ad group" },
                    { key: "s", label: "Spend", align: "right" },
                    { key: "v", label: "Value", align: "right" },
                    { key: "r", label: "ROAS", align: "right" },
                    { key: "c", label: "Conv.", align: "right" },
                    { key: "a", label: "CPA", align: "right" },
                    { key: "t", label: "CTR", align: "right" },
                    { key: "p", label: "CPC", align: "right" },
                  ]}
                  rows={adGroupRows}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <Eyebrow>Devices</Eyebrow>
          {devices.length === 0 || deviceSpend === 0 ? (
            <NoData />
          ) : (
            <ul className="flex flex-col gap-3">
              {devices.map((d) => {
                const share = ratio(d.spend, deviceSpend) ?? 0;
                const roas = ratio(d.value, d.spend);
                return (
                  <li key={d.device} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3 font-mono text-[11.5px]">
                      <span className="text-content-strong">{deviceLabel(d.device)}</span>
                      <span className="tabular text-content-muted">
                        {formatPercent(share, { decimals: 0 })} of spend, {formatRatio(roas)}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-pill bg-gray-100">
                      <div
                        className="h-full rounded-pill bg-growth-600"
                        style={{ width: `${Math.max(share * 100, 0.5)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
