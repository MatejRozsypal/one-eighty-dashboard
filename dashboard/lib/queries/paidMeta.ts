import "server-only";

/**
 * Warehouse reads for Paid > Meta.
 *
 * ── One fetch feeds the whole tab ───────────────────────────────────────────
 * `getMetaCampaignDaily` returns the campaign x day rows of both periods, tagged
 * `current` or `comparison`. Totals, funnel, trend, campaign table and audience
 * are all sums over that set (`components/paid/meta/aggregate.ts`), so the tiles
 * and the table cannot disagree and the period pair costs one scan.
 *
 * Money is in the AD ACCOUNT currency (`client.metaCurrency`), never the
 * client's trading currency.
 *
 * ── Rates ───────────────────────────────────────────────────────────────────
 * Only summable components are read. The mart's `*_per_day` columns are not
 * selected anywhere: an average of daily ratios is the wrong answer.
 *
 * ── NULL is "not ingested" ──────────────────────────────────────────────────
 * Outbound clicks and the video quartile columns are NULL until the ad-insights
 * ingest requests them. They stay null here and render "n/a".
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isoDate, num } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import type { DateRange, ResolvedPeriod } from "@/lib/period";
import type { FunnelStage } from "@/lib/paid/types";
import type { MetaRow, PeriodTag, VideoSums } from "@/components/paid/meta/aggregate";
import { demoMetaAds, demoMetaAdsets, demoMetaRows, demoMetaVideo } from "@/lib/demo/paidMeta";

const STAGES: readonly string[] = ["prospecting", "retargeting", "retention", "unclassified"];

/** The two ranges as query parameters. With no comparison both pairs are the current range. */
function rangeParams(period: ResolvedPeriod) {
  const cmp = period.comparison ?? period.current;
  return {
    from: period.current.from,
    to: period.current.to,
    cFrom: cmp.from,
    cTo: cmp.to,
  };
}

// ── Campaign x day rows ─────────────────────────────────────────────────────

export async function getMetaCampaignDaily(
  clientId: string,
  period: ResolvedPeriod
): Promise<MetaRow[]> {
  if (isDemo(clientId)) return demoMetaRows(period);

  const rows = await query<Record<string, unknown>>(
    `SELECT date, campaign_id, campaign_name, funnel_stage, market,
            spend, revenue, purchases, impressions, reach,
            add_to_cart, initiate_checkout, landing_page_views, link_clicks,
            view_content, add_payment_info
     FROM \`${PROJECT_ID}.mart.mart_meta_campaign_perf\`
     WHERE client_id = @clientId
       AND (date BETWEEN @from AND @to OR date BETWEEN @cFrom AND @cTo)`,
    { clientId, ...rangeParams(period) }
  );

  return rows.map((r) => {
    const date = isoDate(r.date as string | { value: string }) ?? "";
    const stage = String(r.funnel_stage ?? "unclassified");
    const tag: PeriodTag =
      date >= period.current.from && date <= period.current.to ? "current" : "comparison";
    return {
      date,
      period: tag,
      campaignId: String(r.campaign_id),
      campaignName: r.campaign_name === null || r.campaign_name === undefined ? null : String(r.campaign_name),
      funnelStage: (STAGES.includes(stage) ? stage : "unclassified") as FunnelStage,
      market: r.market === null || r.market === undefined ? null : String(r.market),
      spend: num(r.spend),
      revenue: num(r.revenue),
      purchases: num(r.purchases),
      impressions: num(r.impressions),
      reach: num(r.reach),
      addToCart: num(r.add_to_cart),
      initiateCheckout: num(r.initiate_checkout),
      landingPageViews: num(r.landing_page_views),
      linkClicks: num(r.link_clicks),
      viewContent: num(r.view_content),
      addPaymentInfo: num(r.add_payment_info),
    };
  });
}

// ── Video rates ─────────────────────────────────────────────────────────────

export interface MetaVideoRow {
  campaignId: string;
  current: VideoSums;
  previous: VideoSums | null;
}

/**
 * Hook and hold components per campaign, over ads that played video in the
 * period (an ad with no plays is not a video ad). Hook rate is plays over the
 * impressions of those ads, the same definition Creative uses restricted to
 * video ads.
 */
export async function getMetaVideoRates(
  clientId: string,
  period: ResolvedPeriod
): Promise<MetaVideoRow[]> {
  if (isDemo(clientId)) return demoMetaVideo(period);

  const rows = await query<Record<string, unknown>>(
    `WITH a AS (
       SELECT campaign_id, ad_id,
         SUM(IF(date BETWEEN @from AND @to, video_play_actions, NULL)) AS c_plays,
         SUM(IF(date BETWEEN @from AND @to, video_thruplays, NULL))    AS c_thru,
         SUM(IF(date BETWEEN @from AND @to, impressions, NULL))        AS c_imp,
         SUM(IF(date BETWEEN @cFrom AND @cTo, video_play_actions, NULL)) AS p_plays,
         SUM(IF(date BETWEEN @cFrom AND @cTo, video_thruplays, NULL))    AS p_thru,
         SUM(IF(date BETWEEN @cFrom AND @cTo, impressions, NULL))        AS p_imp
       FROM \`${PROJECT_ID}.mart.mart_meta_ad_perf\`
       WHERE client_id = @clientId
         AND (date BETWEEN @from AND @to OR date BETWEEN @cFrom AND @cTo)
       GROUP BY campaign_id, ad_id
     )
     SELECT campaign_id,
       SUM(IF(c_plays > 0, c_plays, NULL)) AS c_plays,
       SUM(IF(c_plays > 0, c_thru, NULL))  AS c_thru,
       SUM(IF(c_plays > 0, c_imp, NULL))   AS c_imp,
       SUM(IF(p_plays > 0, p_plays, NULL)) AS p_plays,
       SUM(IF(p_plays > 0, p_thru, NULL))  AS p_thru,
       SUM(IF(p_plays > 0, p_imp, NULL))   AS p_imp
     FROM a
     GROUP BY campaign_id`,
    { clientId, ...rangeParams(period) }
  );

  return rows.map((r) => ({
    campaignId: String(r.campaign_id),
    current: { plays: num(r.c_plays), thruplays: num(r.c_thru), impressions: num(r.c_imp) },
    previous: period.comparison
      ? { plays: num(r.p_plays), thruplays: num(r.p_thru), impressions: num(r.p_imp) }
      : null,
  }));
}

// ── Ad sets and ads of one campaign ─────────────────────────────────────────

export interface MetaAdsetRow {
  adsetId: string;
  name: string | null;
  spend: number | null;
  revenue: number | null;
  purchases: number | null;
  impressions: number | null;
  linkClicks: number | null;
  addToCart: number | null;
}

function adsetFrom(r: Record<string, unknown>): MetaAdsetRow {
  return {
    adsetId: String(r.adset_id),
    name: r.adset_name === null || r.adset_name === undefined ? null : String(r.adset_name),
    spend: num(r.spend),
    revenue: num(r.revenue),
    purchases: num(r.purchases),
    impressions: num(r.impressions),
    linkClicks: num(r.link_clicks),
    addToCart: num(r.add_to_cart),
  };
}

const ADSET_SUMS = `SUM(spend) AS spend, SUM(revenue) AS revenue, SUM(purchases) AS purchases,
       SUM(impressions) AS impressions, SUM(link_clicks) AS link_clicks,
       SUM(add_to_cart) AS add_to_cart`;

/**
 * Ad sets of a campaign. Reads the ad set mart; while that carries no rows for
 * the client (the ad set insights call is not ingested) the ads roll up by
 * `adset_id` instead, with no name.
 */
export async function getMetaAdsets(
  clientId: string,
  range: DateRange,
  campaignId: string
): Promise<MetaAdsetRow[]> {
  if (isDemo(clientId)) return demoMetaAdsets(range, campaignId);

  const params = { clientId, from: range.from, to: range.to, campaignId };
  const direct = await query<Record<string, unknown>>(
    `SELECT adset_id,
            ARRAY_AGG(adset_name IGNORE NULLS ORDER BY date DESC LIMIT 1)[SAFE_OFFSET(0)] AS adset_name,
            ${ADSET_SUMS}
     FROM \`${PROJECT_ID}.mart.mart_creative_adset_perf\`
     WHERE client_id = @clientId AND date BETWEEN @from AND @to
       AND campaign_id = @campaignId AND adset_id IS NOT NULL
     GROUP BY adset_id
     HAVING spend > 0
     ORDER BY spend DESC
     LIMIT 50`,
    params
  );
  if (direct.length > 0) return direct.map(adsetFrom);

  const rolled = await query<Record<string, unknown>>(
    `SELECT adset_id, CAST(NULL AS STRING) AS adset_name, ${ADSET_SUMS}
     FROM \`${PROJECT_ID}.mart.mart_meta_ad_perf\`
     WHERE client_id = @clientId AND date BETWEEN @from AND @to
       AND campaign_id = @campaignId AND adset_id IS NOT NULL
     GROUP BY adset_id
     HAVING spend > 0
     ORDER BY spend DESC
     LIMIT 50`,
    params
  );
  return rolled.map(adsetFrom);
}

export interface MetaAdRow {
  adId: string;
  name: string | null;
  adsetId: string | null;
  spend: number | null;
  revenue: number | null;
  purchases: number | null;
  impressions: number | null;
  linkClicks: number | null;
  outboundClicks: number | null;
  videoPlays: number | null;
  videoThruplays: number | null;
}

/** Top 20 ads by spend in a campaign, optionally within one ad set. */
export async function getMetaAds(
  clientId: string,
  range: DateRange,
  campaignId: string,
  adsetId?: string
): Promise<MetaAdRow[]> {
  if (isDemo(clientId)) return demoMetaAds(range, campaignId, adsetId);

  const params: Record<string, string> = {
    clientId,
    from: range.from,
    to: range.to,
    campaignId,
  };
  if (adsetId) params.adsetId = adsetId;

  const rows = await query<Record<string, unknown>>(
    `SELECT ad_id,
            ARRAY_AGG(ad_name IGNORE NULLS ORDER BY date DESC LIMIT 1)[SAFE_OFFSET(0)] AS ad_name,
            ARRAY_AGG(adset_id IGNORE NULLS ORDER BY date DESC LIMIT 1)[SAFE_OFFSET(0)] AS adset_id,
            SUM(spend) AS spend, SUM(revenue) AS revenue, SUM(purchases) AS purchases,
            SUM(impressions) AS impressions, SUM(link_clicks) AS link_clicks,
            SUM(outbound_clicks) AS outbound_clicks,
            SUM(video_play_actions) AS video_plays, SUM(video_thruplays) AS video_thruplays
     FROM \`${PROJECT_ID}.mart.mart_meta_ad_perf\`
     WHERE client_id = @clientId AND date BETWEEN @from AND @to
       AND campaign_id = @campaignId
       ${adsetId ? "AND adset_id = @adsetId" : ""}
     GROUP BY ad_id
     HAVING spend > 0
     ORDER BY spend DESC
     LIMIT 20`,
    params
  );

  return rows.map((r) => ({
    adId: String(r.ad_id),
    name: r.ad_name === null || r.ad_name === undefined ? null : String(r.ad_name),
    adsetId: r.adset_id === null || r.adset_id === undefined ? null : String(r.adset_id),
    spend: num(r.spend),
    revenue: num(r.revenue),
    purchases: num(r.purchases),
    impressions: num(r.impressions),
    linkClicks: num(r.link_clicks),
    outboundClicks: num(r.outbound_clicks),
    videoPlays: num(r.video_plays),
    videoThruplays: num(r.video_thruplays),
  }));
}
