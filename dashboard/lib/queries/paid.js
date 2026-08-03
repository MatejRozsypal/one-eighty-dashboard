"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMetaTotals = getMetaTotals;
exports.getTopAds = getTopAds;
exports.getChannelTotals = getChannelTotals;
const bigquery_1 = require("@/lib/bigquery");
const coerce_1 = require("@/lib/coerce");
const client_1 = require("@/lib/demo/client");
const media_1 = require("@/lib/demo/media");
async function getMetaTotals(clientId, range) {
    // Demo client: served from memory, never from the warehouse.
    if ((0, client_1.isDemo)(clientId))
        return (0, media_1.demoMetaTotals)(range);
    const [row] = await (0, bigquery_1.query)(`SELECT
       SUM(spend) AS spend, SUM(revenue) AS revenue, SUM(purchases) AS purchases,
       SUM(impressions) AS impressions, SUM(reach) AS reach, SUM(clicks) AS clicks,
       SUM(link_clicks) AS link_clicks, SUM(landing_page_views) AS landing_page_views,
       SUM(add_to_cart) AS add_to_cart, SUM(initiate_checkout) AS initiate_checkout,
       SUM(video_views) AS video_views
     FROM \`${bigquery_1.PROJECT_ID}.mart.mart_meta_campaign_perf\`
     WHERE client_id = @clientId AND date BETWEEN @from AND @to`, { clientId, from: range.from, to: range.to });
    const spend = (0, coerce_1.num)(row?.spend);
    const revenue = (0, coerce_1.num)(row?.revenue);
    const impressions = (0, coerce_1.num)(row?.impressions);
    const reach = (0, coerce_1.num)(row?.reach);
    const clicks = (0, coerce_1.num)(row?.clicks);
    const purchases = (0, coerce_1.num)(row?.purchases);
    return {
        spend,
        revenue,
        purchases,
        impressions,
        reach,
        clicks,
        linkClicks: (0, coerce_1.num)(row?.link_clicks),
        landingPageViews: (0, coerce_1.num)(row?.landing_page_views),
        addToCart: (0, coerce_1.num)(row?.add_to_cart),
        initiateCheckout: (0, coerce_1.num)(row?.initiate_checkout),
        videoViews: (0, coerce_1.num)(row?.video_views),
        ctr: (0, coerce_1.safeDiv)(clicks, impressions),
        cpc: (0, coerce_1.safeDiv)(spend, clicks),
        cpm: (0, coerce_1.safeDiv)(spend, impressions === null ? null : impressions / 1000),
        roas: (0, coerce_1.safeDiv)(revenue, spend),
        cpa: (0, coerce_1.safeDiv)(spend, purchases),
        frequency: (0, coerce_1.safeDiv)(impressions, reach),
    };
}
async function getTopAds(clientId, range, limit = 10) {
    // Demo client: served from memory, never from the warehouse.
    if ((0, client_1.isDemo)(clientId))
        return (0, media_1.demoTopAds)(range, limit);
    // `mart_meta_ad_perf` carries campaign_id but not campaign_name — the name
    // only exists on the campaign view, so it's resolved by join. The inner
    // SELECT is again a block boundary: the mart columns are already aggregates,
    // and summing them directly trips "Aggregations of aggregations".
    const rows = await (0, bigquery_1.query)(`WITH ads AS (
       SELECT ad_name, campaign_id, spend, revenue, purchases,
              impressions, reach, clicks
       FROM \`${bigquery_1.PROJECT_ID}.mart.mart_meta_ad_perf\`
       WHERE client_id = @clientId AND date BETWEEN @from AND @to
     ),
     names AS (
       SELECT campaign_id, ANY_VALUE(campaign_name) AS campaign_name
       FROM (
         SELECT campaign_id, campaign_name
         FROM \`${bigquery_1.PROJECT_ID}.mart.mart_meta_campaign_perf\`
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
     LIMIT @limit`, { clientId, from: range.from, to: range.to, limit });
    return rows.map((r) => {
        const spend = (0, coerce_1.num)(r.spend);
        const revenue = (0, coerce_1.num)(r.revenue);
        const purchases = (0, coerce_1.num)(r.purchases);
        const impressions = (0, coerce_1.num)(r.impressions);
        const reach = (0, coerce_1.num)(r.reach);
        const clicks = (0, coerce_1.num)(r.clicks);
        return {
            adName: String(r.ad_name ?? "—"),
            campaignName: String(r.campaign_name ?? "—"),
            spend,
            revenue,
            // Null, not zero, when nothing was attributed. A campaign that spent and
            // returned nothing measured is not a 0.00× campaign — it's unmeasured.
            roas: revenue === null ? null : (0, coerce_1.safeDiv)(revenue, spend),
            reach,
            ctr: (0, coerce_1.safeDiv)(clicks, impressions),
            cpc: (0, coerce_1.safeDiv)(spend, clicks),
            frequency: (0, coerce_1.safeDiv)(impressions, reach),
            purchases,
            cpa: purchases === null ? null : (0, coerce_1.safeDiv)(spend, purchases),
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
async function getChannelTotals(clientId, range, hasGoogle) {
    // Demo client: served from memory, never from the warehouse.
    if ((0, client_1.isDemo)(clientId))
        return (0, media_1.demoChannelTotals)(range, hasGoogle);
    const [row] = await (0, bigquery_1.query)(`SELECT SUM(meta_spend)     AS meta_spend,
            SUM(google_spend)   AS google_spend,
            SUM(meta_revenue)   AS meta_revenue,
            SUM(google_revenue) AS google_revenue
     FROM \`${bigquery_1.PROJECT_ID}.mart.mart_daily_kpis\`
     WHERE client_id = @clientId AND date BETWEEN @from AND @to`, { clientId, from: range.from, to: range.to });
    const googleSpend = (0, coerce_1.num)(row?.google_spend);
    // Platform-attributed revenue, and worth saying out loud: Meta and Google
    // each claim conversions under their own attribution windows, so these do not
    // add up to shop revenue and can double-count the same order. They are the
    // right numerator for a platform ROAS and the wrong one for anything else.
    return [
        {
            channel: "meta",
            spend: (0, coerce_1.num)(row?.meta_spend),
            revenue: (0, coerce_1.num)(row?.meta_revenue),
            purchases: null,
            connected: true,
        },
        {
            channel: "google",
            spend: googleSpend,
            revenue: (0, coerce_1.num)(row?.google_revenue),
            purchases: null,
            connected: hasGoogle || googleSpend !== null,
        },
    ];
}
