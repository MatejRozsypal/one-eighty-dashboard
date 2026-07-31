/**
 * Paid media — Meta funnel, channel totals, ad-level performance.
 *
 * ── Every rate here is recomputed, never averaged ───────────────────────────
 * `mart_meta_*` exposes `ctr_per_day`, `cpc_per_day`, `roas_per_day` and
 * `frequency_per_day`. The `_per_day` suffix is a warning label: these are
 * pre-divided at daily grain and averaging them across a range gives
 * AVG(daily ratio) instead of SUM(num)/SUM(denom), which METRICS.md measures as
 * 10–30% wrong. So this module reads only the summable components and derives
 * every ratio from those sums.
 *
 * Frequency is the worst offender and gets special treatment — it is
 * impressions ÷ reach over the whole period, which is not remotely the mean of
 * daily frequencies.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { num, safeDiv } from "@/lib/coerce";
import type { DateRange } from "@/lib/period";

export interface MetaTotals {
  spend: number | null;
  revenue: number | null;
  purchases: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  linkClicks: number | null;
  landingPageViews: number | null;
  addToCart: number | null;
  initiateCheckout: number | null;
  videoViews: number | null;
  // Derived from the sums above
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  roas: number | null;
  cpa: number | null;
  /** impressions ÷ reach — NOT an average of frequency_per_day. */
  frequency: number | null;
}

export interface AdRow {
  adName: string;
  campaignName: string;
  spend: number | null;
  revenue: number | null;
  roas: number | null;
  reach: number | null;
  ctr: number | null;
  cpc: number | null;
  frequency: number | null;
  purchases: number | null;
  cpa: number | null;
}

export interface ChannelTotal {
  channel: "meta" | "google";
  spend: number | null;
  revenue: number | null;
  purchases: number | null;
  connected: boolean;
}

export async function getMetaTotals(
  clientId: string,
  range: DateRange
): Promise<MetaTotals> {
  const [row] = await query<Record<string, unknown>>(
    `SELECT
       SUM(spend) AS spend, SUM(revenue) AS revenue, SUM(purchases) AS purchases,
       SUM(impressions) AS impressions, SUM(reach) AS reach, SUM(clicks) AS clicks,
       SUM(link_clicks) AS link_clicks, SUM(landing_page_views) AS landing_page_views,
       SUM(add_to_cart) AS add_to_cart, SUM(initiate_checkout) AS initiate_checkout,
       SUM(video_views) AS video_views
     FROM \`${PROJECT_ID}.mart.mart_meta_campaign_perf\`
     WHERE client_id = @clientId AND date BETWEEN @from AND @to`,
    { clientId, from: range.from, to: range.to }
  );

  const spend = num(row?.spend);
  const revenue = num(row?.revenue);
  const impressions = num(row?.impressions);
  const reach = num(row?.reach);
  const clicks = num(row?.clicks);
  const purchases = num(row?.purchases);

  return {
    spend,
    revenue,
    purchases,
    impressions,
    reach,
    clicks,
    linkClicks: num(row?.link_clicks),
    landingPageViews: num(row?.landing_page_views),
    addToCart: num(row?.add_to_cart),
    initiateCheckout: num(row?.initiate_checkout),
    videoViews: num(row?.video_views),
    ctr: safeDiv(clicks, impressions),
    cpc: safeDiv(spend, clicks),
    cpm: safeDiv(spend, impressions === null ? null : impressions / 1000),
    roas: safeDiv(revenue, spend),
    cpa: safeDiv(spend, purchases),
    frequency: safeDiv(impressions, reach),
  };
}

export async function getTopAds(
  clientId: string,
  range: DateRange,
  limit = 10
): Promise<AdRow[]> {
  // `mart_meta_ad_perf` carries campaign_id but not campaign_name — the name
  // only exists on the campaign view, so it's resolved by join. The inner
  // SELECT is again a block boundary: the mart columns are already aggregates,
  // and summing them directly trips "Aggregations of aggregations".
  const rows = await query<Record<string, unknown>>(
    `WITH ads AS (
       SELECT ad_name, campaign_id, spend, revenue, purchases,
              impressions, reach, clicks
       FROM \`${PROJECT_ID}.mart.mart_meta_ad_perf\`
       WHERE client_id = @clientId AND date BETWEEN @from AND @to
     ),
     names AS (
       SELECT campaign_id, ANY_VALUE(campaign_name) AS campaign_name
       FROM (
         SELECT campaign_id, campaign_name
         FROM \`${PROJECT_ID}.mart.mart_meta_campaign_perf\`
         WHERE client_id = @clientId AND date BETWEEN @from AND @to
       )
       GROUP BY campaign_id
     )
     SELECT
       a.ad_name,
       COALESCE(n.campaign_name, a.campaign_id) AS campaign_name,
       SUM(a.spend) AS spend, SUM(a.revenue) AS revenue, SUM(a.purchases) AS purchases,
       SUM(a.impressions) AS impressions, SUM(a.reach) AS reach, SUM(a.clicks) AS clicks
     FROM ads a
     LEFT JOIN names n USING (campaign_id)
     GROUP BY a.ad_name, campaign_name
     HAVING SUM(a.spend) > 0
     ORDER BY spend DESC
     LIMIT @limit`,
    { clientId, from: range.from, to: range.to, limit }
  );

  return rows.map((r) => {
    const spend = num(r.spend);
    const revenue = num(r.revenue);
    const purchases = num(r.purchases);
    const impressions = num(r.impressions);
    const reach = num(r.reach);
    const clicks = num(r.clicks);

    return {
      adName: String(r.ad_name ?? "—"),
      campaignName: String(r.campaign_name ?? "—"),
      spend,
      revenue,
      // Null, not zero, when nothing was attributed. A campaign that spent and
      // returned nothing measured is not a 0.00× campaign — it's unmeasured.
      roas: revenue === null ? null : safeDiv(revenue, spend),
      reach,
      ctr: safeDiv(clicks, impressions),
      cpc: safeDiv(spend, clicks),
      frequency: safeDiv(impressions, reach),
      purchases,
      cpa: purchases === null ? null : safeDiv(spend, purchases),
    };
  });
}

/**
 * Spend per channel.
 *
 * Meta comes from its own mart view. Google has no mart view yet — only
 * `stg_google_ads_campaign_insights`, which this service account can't read —
 * so its totals are taken from `mart_daily_kpis.google_spend`, which is enough
 * for the channel split even though per-campaign detail isn't available.
 */
export async function getChannelTotals(
  clientId: string,
  range: DateRange,
  hasGoogle: boolean
): Promise<ChannelTotal[]> {
  const [row] = await query<Record<string, unknown>>(
    `SELECT SUM(meta_spend) AS meta_spend, SUM(google_spend) AS google_spend
     FROM \`${PROJECT_ID}.mart.mart_daily_kpis\`
     WHERE client_id = @clientId AND date BETWEEN @from AND @to`,
    { clientId, from: range.from, to: range.to }
  );

  const googleSpend = num(row?.google_spend);

  return [
    {
      channel: "meta",
      spend: num(row?.meta_spend),
      revenue: null,
      purchases: null,
      connected: true,
    },
    {
      channel: "google",
      spend: googleSpend,
      revenue: null,
      purchases: null,
      connected: hasGoogle || googleSpend !== null,
    },
  ];
}
