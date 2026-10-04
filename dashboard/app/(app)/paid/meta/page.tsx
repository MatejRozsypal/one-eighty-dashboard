/**
 * Paid > Meta.
 *
 * Reads left to right as a diagnosis: outcome tiles, the soft metrics behind
 * them, the funnel, five trends, the campaigns, one campaign's ad sets and ads,
 * then the audience. Money is in the ad account currency, never the client's
 * trading currency, so the currency toggle is not offered here.
 *
 * All view state is in the URL: `cols`, `stage`, `market` (campaign table),
 * `campaign` and `adset` (drill), `aud` (audience dimension).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { creativeHref } from "@/lib/paid/links";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { NotConnected, NoData } from "@/components/ui/EmptyState";
import {
  getMetaAds,
  getMetaAdsets,
  getMetaCampaignDaily,
  getMetaVideoRates,
} from "@/lib/queries/paidMeta";
import {
  STAGE_ORDER,
  audienceRows,
  campaignRows,
  inPeriod,
  marketLabel,
  sumRows,
  sumVideo,
} from "@/components/paid/meta/aggregate";
import { MetaKpis, MetaFunnel } from "@/components/paid/meta/MetaKpis";
import { MetaTrend } from "@/components/paid/meta/MetaTrend";
import {
  COLUMN_SETS,
  MetaCampaigns,
  marketsPresent,
  stagesPresent,
  type ColumnSet,
} from "@/components/paid/meta/MetaCampaigns";
import { CampaignDetail } from "@/components/paid/meta/CampaignDetail";
import { AudienceBreakdown } from "@/components/paid/meta/AudienceBreakdown";
import { pick } from "@/components/paid/meta/links";

export const metadata: Metadata = { title: "Paid" };
export const dynamic = "force-dynamic";

export default async function PaidMetaPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  if (pageAvailability(client, "/paid/meta") !== "available") {
    return (
      <>
        <Header title="Paid" />
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/paid/meta") ?? "Meta"} />
        </main>
      </>
    );
  }

  // Ad account currency. The registry guarantees it for a client with Meta; the
  // trading currency is only a fallback for a half-filled registry row.
  const currency = client.metaCurrency ?? client.currency;
  const period = params.period;
  const hasComparison = period.comparison !== null;

  const colsParam = pick(searchParams, "cols");
  const cols: ColumnSet = COLUMN_SETS.includes(colsParam as ColumnSet)
    ? (colsParam as ColumnSet)
    : "outcome";
  const dim = pick(searchParams, "aud") === "market" ? "market" : "stage";
  const campaignParam = pick(searchParams, "campaign");
  const adsetParam = pick(searchParams, "adset");

  const [rows, videoRows, adsets, ads] = await Promise.all([
    getMetaCampaignDaily(client.clientId, period),
    getMetaVideoRates(client.clientId, period),
    campaignParam ? getMetaAdsets(client.clientId, params.range, campaignParam) : [],
    campaignParam
      ? getMetaAds(client.clientId, params.range, campaignParam, adsetParam)
      : [],
  ]);

  const campaigns = campaignRows(rows, hasComparison);

  if (campaigns.length === 0) {
    return (
      <>
        <Header title="Paid" />
        <PageControls client={client} params={params} compare />
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NoData />
        </main>
      </>
    );
  }

  const current = sumRows(inPeriod(rows, "current"));
  const previous = hasComparison ? sumRows(inPeriod(rows, "comparison")) : null;
  const video = sumVideo(videoRows.map((v) => v.current));
  const previousVideo = hasComparison
    ? sumVideo(videoRows.map((v) => v.previous ?? { plays: null, thruplays: null, impressions: null }))
    : null;
  const videoByCampaign = new Map(videoRows.map((v) => [v.campaignId, v]));

  // Table narrowing. An unknown value falls back to "all" rather than an empty table.
  const stageOptions = stagesPresent(campaigns);
  const marketOptions = marketsPresent(campaigns);
  const stageParam = pick(searchParams, "stage");
  const marketParam = pick(searchParams, "market");
  const stage = STAGE_ORDER.find((s) => s === stageParam) ?? "all";
  const market = marketOptions.find((m) => m === marketParam) ?? "all";
  const shown = campaigns.filter(
    (c) =>
      (stage === "all" || c.funnelStage === stage) &&
      (market === "all" || marketLabel(c.market) === market)
  );

  const selected = campaignParam
    ? campaigns.find((c) => c.campaignId === campaignParam)
    : undefined;

  return (
    <>
      <Header title="Paid" />
      <PageControls client={client} params={params} compare />
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <MetaKpis
          current={current}
          previous={previous}
          video={video}
          previousVideo={previousVideo}
          currency={currency}
        />

        <MetaFunnel sums={current} currency={currency} />

        <MetaTrend
          rows={rows}
          range={period.current}
          comparison={period.comparison}
          currency={currency}
        />

        <MetaCampaigns
          campaigns={shown}
          videoByCampaign={videoByCampaign}
          currency={currency}
          hasComparison={hasComparison}
          cols={cols}
          stage={stage}
          market={market}
          stageOptions={stageOptions}
          marketOptions={marketOptions}
          selectedId={selected?.campaignId}
          search={searchParams}
          view={params}
        />

        {selected && (
          <CampaignDetail
            campaignName={selected.name}
            currency={currency}
            adsets={adsets}
            ads={ads}
            adsetId={adsetParam}
            search={searchParams}
            view={params}
          />
        )}

        <AudienceBreakdown rows={audienceRows(rows, dim)} dim={dim} currency={currency} />

        <Link
          href={creativeHref(params)}
          className="self-start text-[13px] text-content-muted hover:text-content-strong hover:underline"
        >
          Creatives
        </Link>
      </main>
    </>
  );
}
