-- qa/242_regression.sql
-- Regression and sanity queries for 241_ref_client_brand_terms.sql and 242_gads_marts.sql
-- (package PA2). Read-only. Written with prod object names.
--
-- Pre-deploy (candidates in mart_qa): run the file through the name map, for example
--   sed -e 's#oneeighty-warehouse\.mart\.mart_gads_#oneeighty-warehouse.mart_qa.pa2_mart_gads_#g' \
--       -e 's#oneeighty-warehouse\.ref\.client_brand_terms#oneeighty-warehouse.mart_qa.pa2_client_brand_terms#g' \
--       infra/bigquery/qa/242_regression.sql
-- Post-deploy: run as is.
--
-- Every block returns a table; the column `check` says what is expected. Money is in the
-- Google Ads account currency (both live accounts are CZK and the client currency is CZK,
-- so native and client currency are equal today). FLOAT64 sums carry noise of about
-- 1e-9, so "equal" means ABS(diff) < 0.01.

-- ============================================================================
-- R1. Per client and month: campaign_daily vs mart_daily_kpis (expected: every flag = OK)
--     spend vs google_spend; conversions_value vs google_revenue; conversions vs
--     google_purchases; impressions and clicks. mart_daily_kpis is not changed by PA2.
-- ============================================================================
WITH a AS (
  SELECT client_id, DATE_TRUNC(date, MONTH) AS month,
         SUM(spend) AS spend, SUM(spend_client_ccy) AS spend_client_ccy,
         SUM(conversions_value) AS conv_value, SUM(conversions) AS conversions,
         SUM(impressions) AS impressions, SUM(clicks) AS clicks
  FROM `oneeighty-warehouse.mart.mart_gads_campaign_daily`
  WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH)
  GROUP BY client_id, month
),
k AS (
  SELECT client_id, DATE_TRUNC(date, MONTH) AS month,
         SUM(google_spend) AS google_spend, SUM(google_revenue) AS google_revenue,
         SUM(google_purchases) AS google_purchases, SUM(google_impressions) AS google_impressions,
         SUM(google_clicks) AS google_clicks
  FROM `oneeighty-warehouse.mart.mart_daily_kpis`
  WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH) AND date < CURRENT_DATE()
    AND google_spend IS NOT NULL
  GROUP BY client_id, month
)
SELECT
  COALESCE(a.client_id, k.client_id) AS client_id,
  COALESCE(a.month, k.month)         AS month,
  ROUND(a.spend, 2)                  AS mart_spend,
  ROUND(k.google_spend, 2)           AS kpis_google_spend,
  ROUND(a.spend - k.google_spend, 6) AS spend_diff,
  CASE WHEN ABS(COALESCE(a.spend, 0) - COALESCE(k.google_spend, 0)) < 0.01
        AND ABS(COALESCE(a.spend_client_ccy, 0) - COALESCE(k.google_spend, 0)) < 0.01
        AND ABS(COALESCE(a.conv_value, 0) - COALESCE(k.google_revenue, 0)) < 0.01
        AND ABS(COALESCE(a.conversions, 0) - COALESCE(k.google_purchases, 0)) < 0.01
        AND COALESCE(a.impressions, 0) = COALESCE(k.google_impressions, 0)
        AND COALESCE(a.clicks, 0) = COALESCE(k.google_clicks, 0)
       THEN 'OK' ELSE 'DIFF' END AS `check`
FROM a FULL OUTER JOIN k ON a.client_id = k.client_id AND a.month = k.month
ORDER BY client_id, month;

-- ============================================================================
-- R2. Device view and ad group view sum to the campaign view (expected: all OK)
--     Device: all five measures equal. Ad group: equals the spend and clicks of all campaigns
--     except PERFORMANCE_MAX (PMax has asset groups, not ad groups; verified exact on every month).
-- ============================================================================
WITH c AS (
  SELECT client_id, DATE_TRUNC(date, MONTH) AS month, SUM(spend) AS spend, SUM(impressions) AS impressions,
         SUM(clicks) AS clicks, SUM(conversions) AS conversions, SUM(conversions_value) AS conv_value,
         SUM(IF(channel_type != 'PERFORMANCE_MAX', spend, 0)) AS spend_non_pmax,
         SUM(IF(channel_type != 'PERFORMANCE_MAX', clicks, 0)) AS clicks_non_pmax
  FROM `oneeighty-warehouse.mart.mart_gads_campaign_daily`
  WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH) GROUP BY client_id, month
),
d AS (
  SELECT client_id, DATE_TRUNC(date, MONTH) AS month, SUM(spend) AS spend, SUM(impressions) AS impressions,
         SUM(clicks) AS clicks, SUM(conversions) AS conversions, SUM(conversions_value) AS conv_value
  FROM `oneeighty-warehouse.mart.mart_gads_campaign_device_daily`
  WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH) GROUP BY client_id, month
),
g AS (
  SELECT client_id, DATE_TRUNC(date, MONTH) AS month, SUM(spend) AS spend, SUM(clicks) AS clicks
  FROM `oneeighty-warehouse.mart.mart_gads_adgroup_daily`
  WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH) GROUP BY client_id, month
)
SELECT
  c.client_id, c.month,
  ROUND(c.spend, 2) AS campaign_spend,
  ROUND(c.spend - COALESCE(d.spend, 0), 6) AS device_spend_diff,
  ROUND(c.spend_non_pmax - COALESCE(g.spend, 0), 6) AS adgroup_spend_diff_vs_non_pmax,
  CASE WHEN ABS(c.spend - COALESCE(d.spend, 0)) < 0.01 AND c.impressions = COALESCE(d.impressions, 0)
        AND c.clicks = COALESCE(d.clicks, 0)
        AND ABS(c.conversions - COALESCE(d.conversions, 0)) < 0.01 AND ABS(c.conv_value - COALESCE(d.conv_value, 0)) < 0.01
        AND ABS(c.spend_non_pmax - COALESCE(g.spend, 0)) < 0.01 AND c.clicks_non_pmax = COALESCE(g.clicks, 0)
       THEN 'OK' ELSE 'DIFF' END AS `check`
FROM c
LEFT JOIN d USING (client_id, month)
LEFT JOIN g USING (client_id, month)
ORDER BY c.client_id, c.month;

-- ============================================================================
-- R3. Impression share sanity per client and month (expected: bad_rows = 0, every share in 0..1)
--     bad_rows counts rows where IS > 1, a lost share < 0, IS + lost budget + lost rank is not 1
--     (tolerance 0.001), or top > IS, or absolute top > top. Rows where any share sits at the value
--     0.0999 (Google's "<10%" floor) are excluded from bad_rows and counted in rows_at_floor: their
--     components are upper bounds, so the aggregated shares are approximate when rows_at_floor is high.
--     Verified 2026-10-04: bad_rows = 0 for both clients in all 12 months.
-- ============================================================================
WITH r AS (
  SELECT client_id, DATE_TRUNC(date, MONTH) AS month,
    is_impressions, eligible_impressions, lost_budget_impressions, lost_rank_impressions,
    top_impressions, top_eligible_impressions, abs_top_impressions, click_share_clicks, eligible_clicks,
    SAFE_DIVIDE(is_impressions, eligible_impressions)               AS is_s,
    SAFE_DIVIDE(lost_budget_impressions, eligible_impressions)      AS lb_s,
    SAFE_DIVIDE(lost_rank_impressions, eligible_impressions)        AS lr_s,
    SAFE_DIVIDE(top_impressions, top_eligible_impressions)          AS top_s,
    SAFE_DIVIDE(abs_top_impressions, eligible_impressions)          AS abs_s
  FROM `oneeighty-warehouse.mart.mart_gads_campaign_daily`
  WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
),
f AS (
  SELECT *,
    (ABS(is_s - 0.0999) < 1e-4 OR ABS(lb_s - 0.0999) < 1e-4 OR ABS(lr_s - 0.0999) < 1e-4
     OR ABS(top_s - 0.0999) < 1e-4 OR ABS(abs_s - 0.0999) < 1e-4) AS floor_row
  FROM r
),
m AS (
  SELECT
    client_id, month,
    COUNTIF(eligible_impressions IS NOT NULL)                      AS rows_with_is,
    COUNTIF(floor_row)                                             AS rows_at_floor,
    COUNTIF(eligible_impressions IS NOT NULL AND NOT COALESCE(floor_row, FALSE) AND (
          is_s > 1 + 1e-9 OR lb_s < 0 OR lr_s < 0
       OR ABS(is_s + lb_s + lr_s - 1) > 0.001
       OR (top_impressions IS NOT NULL AND (top_impressions > is_impressions * (1 + 1e-9)
                                            OR abs_top_impressions > top_impressions * (1 + 1e-9)))
    ))                                                             AS bad_rows,
    SAFE_DIVIDE(SUM(is_impressions), SUM(eligible_impressions))          AS search_is,
    SAFE_DIVIDE(SUM(lost_budget_impressions), SUM(eligible_impressions)) AS lost_budget_share,
    SAFE_DIVIDE(SUM(lost_rank_impressions), SUM(eligible_impressions))   AS lost_rank_share,
    SAFE_DIVIDE(SUM(top_impressions), SUM(top_eligible_impressions))     AS top_is,
    SAFE_DIVIDE(SUM(abs_top_impressions), SUM(eligible_impressions))     AS abs_top_is,
    SAFE_DIVIDE(SUM(click_share_clicks), SUM(eligible_clicks))           AS click_share
  FROM f
  GROUP BY client_id, month
)
SELECT
  client_id, month, rows_with_is, rows_at_floor, bad_rows,
  ROUND(search_is, 4) AS search_is, ROUND(lost_budget_share, 4) AS lost_budget_share,
  ROUND(lost_rank_share, 4) AS lost_rank_share, ROUND(top_is, 4) AS top_is,
  ROUND(abs_top_is, 4) AS abs_top_is, ROUND(click_share, 4) AS click_share,
  IF(bad_rows = 0
     AND COALESCE(search_is, 0) BETWEEN 0 AND 1 AND COALESCE(lost_budget_share, 0) BETWEEN 0 AND 1
     AND COALESCE(lost_rank_share, 0) BETWEEN 0 AND 1 AND COALESCE(top_is, 0) BETWEEN 0 AND 1
     AND COALESCE(abs_top_is, 0) BETWEEN 0 AND 1 AND COALESCE(click_share, 0) BETWEEN 0 AND 1,
     'OK', 'CHECK') AS `check`
FROM m
ORDER BY client_id, month;

-- ============================================================================
-- R4. Coverage of search terms and products (last 30 complete days)
--     search_term_coverage = search-term spend / spend of SEARCH-channel campaigns
--     product_coverage     = product spend (SHOPPING and PMAX campaigns) / spend of SHOPPING + PMAX campaigns
--     Expected (verified 2026-10-04 on 30d to 2026-10-03): rawbark search terms about 63 percent
--     (privacy threshold), rawbark PMax products 0 percent, rawbark Shopping products about 100
--     percent, manami PMax products about 26 percent. These are not errors; they are the
--     "Covers N% of spend" chips.
-- ============================================================================
WITH w AS (SELECT DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AS d0),
camp AS (
  SELECT client_id, channel_type, SUM(spend) AS spend
  FROM `oneeighty-warehouse.mart.mart_gads_campaign_daily`, w
  WHERE date >= w.d0 GROUP BY client_id, channel_type
),
st AS (
  SELECT t.client_id, SUM(t.spend) AS spend
  FROM `oneeighty-warehouse.mart.mart_gads_search_terms_daily` t, w
  WHERE t.date >= w.d0 GROUP BY t.client_id
),
pr AS (
  SELECT p.client_id, p.channel_type, SUM(p.spend) AS spend
  FROM `oneeighty-warehouse.mart.mart_gads_products_daily` p, w
  WHERE p.date >= w.d0 GROUP BY p.client_id, p.channel_type
)
SELECT
  'search_terms' AS kind, camp.client_id, 'SEARCH' AS channel_type,
  ROUND(camp.spend, 2) AS campaign_spend, ROUND(COALESCE(st.spend, 0), 2) AS covered_spend,
  ROUND(COALESCE(SAFE_DIVIDE(st.spend, camp.spend), 0) * 100, 1) AS coverage_pct
FROM camp LEFT JOIN st USING (client_id)
WHERE camp.channel_type = 'SEARCH'
UNION ALL
SELECT
  'products', camp.client_id, camp.channel_type,
  ROUND(camp.spend, 2), ROUND(COALESCE(pr.spend, 0), 2),
  ROUND(COALESCE(SAFE_DIVIDE(pr.spend, camp.spend), 0) * 100, 1)
FROM camp LEFT JOIN pr ON pr.client_id = camp.client_id AND pr.channel_type = camp.channel_type
WHERE camp.channel_type IN ('SHOPPING', 'PERFORMANCE_MAX')
ORDER BY kind, client_id, channel_type;

-- ============================================================================
-- R5. Brand share per client (last 30 complete days) and brand leakage
--     brand_share      = spend of brand_class 'brand' / all Google spend
--     term_brand_share = spend of brand search terms / search-term spend
--     leakage          = brand search-term spend inside non-brand campaigns / search-term spend in non-brand campaigns
--     Expected (live 2026-10-04): manami 0 percent brand (no brand terms or brand campaign yet);
--     rawbark brand_share well above 0 because CZ - S: Brand and SK - S: Brand are enabled.
-- ============================================================================
WITH w AS (SELECT DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AS d0),
cls AS (
  SELECT client_id, brand_class, SUM(spend) AS spend, SUM(conversions_value) AS value
  FROM `oneeighty-warehouse.mart.mart_gads_campaign_daily`, w
  WHERE date >= w.d0 GROUP BY client_id, brand_class
),
tot AS (SELECT client_id, SUM(spend) AS spend FROM cls GROUP BY client_id),
tm AS (
  SELECT t.client_id,
    SUM(t.spend) AS term_spend,
    SUM(IF(t.is_brand, t.spend, 0)) AS brand_term_spend,
    SUM(IF(t.campaign_brand_class = 'non_brand', t.spend, 0)) AS nonbrand_campaign_term_spend,
    SUM(IF(t.campaign_brand_class = 'non_brand' AND t.is_brand, t.spend, 0)) AS leak_spend
  FROM `oneeighty-warehouse.mart.mart_gads_search_terms_daily` t, w
  WHERE t.date >= w.d0 GROUP BY t.client_id
)
SELECT
  tot.client_id,
  ROUND(tot.spend, 2) AS google_spend,
  ROUND(SUM(IF(cls.brand_class = 'brand', cls.spend, 0)), 2)         AS brand_spend,
  ROUND(SAFE_DIVIDE(SUM(IF(cls.brand_class = 'brand', cls.spend, 0)), tot.spend) * 100, 1) AS brand_share_pct,
  ROUND(SAFE_DIVIDE(SUM(IF(cls.brand_class = 'non_brand', cls.spend, 0)), tot.spend) * 100, 1) AS non_brand_share_pct,
  ROUND(SAFE_DIVIDE(SUM(IF(cls.brand_class = 'shopping_pmax', cls.spend, 0)), tot.spend) * 100, 1) AS shopping_pmax_share_pct,
  ROUND(SAFE_DIVIDE(SUM(IF(cls.brand_class = 'other', cls.spend, 0)), tot.spend) * 100, 1) AS other_share_pct,
  ROUND(SAFE_DIVIDE(ANY_VALUE(tm.brand_term_spend), ANY_VALUE(tm.term_spend)) * 100, 1) AS term_brand_share_pct,
  ROUND(SAFE_DIVIDE(ANY_VALUE(tm.leak_spend), ANY_VALUE(tm.nonbrand_campaign_term_spend)) * 100, 1) AS brand_leakage_pct
FROM tot
JOIN cls USING (client_id)
LEFT JOIN tm USING (client_id)
GROUP BY tot.client_id, tot.spend
ORDER BY tot.client_id;

-- ============================================================================
-- R6. Grain uniqueness over the last 60 days (expected: every dup_rows = 0)
-- ============================================================================
SELECT 'campaign_daily' AS view_name, COUNT(*) - COUNT(DISTINCT CONCAT(client_id, '|', CAST(date AS STRING), '|', campaign_id, '|', ad_network_type)) AS dup_rows
FROM `oneeighty-warehouse.mart.mart_gads_campaign_daily` WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
UNION ALL
SELECT 'campaign_device_daily', COUNT(*) - COUNT(DISTINCT CONCAT(client_id, '|', CAST(date AS STRING), '|', campaign_id, '|', device))
FROM `oneeighty-warehouse.mart.mart_gads_campaign_device_daily` WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
UNION ALL
SELECT 'adgroup_daily', COUNT(*) - COUNT(DISTINCT CONCAT(client_id, '|', CAST(date AS STRING), '|', campaign_id, '|', ad_group_id))
FROM `oneeighty-warehouse.mart.mart_gads_adgroup_daily` WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
UNION ALL
SELECT 'search_terms_daily', COUNT(*) - COUNT(DISTINCT TO_JSON_STRING(STRUCT(client_id, date, campaign_id, ad_group_id, search_term, match_type, term_status, keyword_criterion)))
FROM `oneeighty-warehouse.mart.mart_gads_search_terms_daily` WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
UNION ALL
SELECT 'keywords_daily', COUNT(*) - COUNT(DISTINCT CONCAT(client_id, '|', CAST(date AS STRING), '|', campaign_id, '|', ad_group_id, '|', criterion_id))
FROM `oneeighty-warehouse.mart.mart_gads_keywords_daily` WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
UNION ALL
SELECT 'campaign_dim', COUNT(*) - COUNT(DISTINCT CONCAT(client_id, '|', campaign_id))
FROM `oneeighty-warehouse.mart.mart_gads_campaign_dim`;

-- ============================================================================
-- R7. Completeness (expected: every count = 0)
--     missing_dim        : daily rows whose campaign has no dim row (name NULL)
--     missing_fx         : rows with spend > 0 and no client-currency value (FX gap)
--     partition_vs_date  : DTS rows where DATE(_PARTITIONTIME) <> segments_date (last 60 days)
-- ============================================================================
SELECT 'missing_dim' AS check_name, COUNTIF(campaign_name IS NULL) AS n
FROM `oneeighty-warehouse.mart.mart_gads_campaign_daily` WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH)
UNION ALL
SELECT 'missing_fx', COUNTIF(spend > 0 AND spend_client_ccy IS NULL)
FROM `oneeighty-warehouse.mart.mart_gads_campaign_daily` WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH)
UNION ALL
SELECT 'partition_vs_date_basic', COUNTIF(DATE(_PARTITIONTIME) != segments_date)
FROM `oneeighty-warehouse.raw_google_ads.p_ads_CampaignBasicStats_*`
WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY))
UNION ALL
SELECT 'partition_vs_date_searchterms', COUNTIF(DATE(_PARTITIONTIME) != segments_date)
FROM `oneeighty-warehouse.raw_google_ads.p_ads_SearchQueryStats_*`
WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY));

-- ============================================================================
-- R8. Keywords reconcile to campaign spend (last 30 days, Search-channel campaigns that have keywords).
--     spend and clicks must equal; impressions must equal Search + Search partners impressions of the
--     same campaigns (click_type URL_CLICKS fix; without it impressions are inflated about 1.8x).
-- ============================================================================
WITH w AS (SELECT DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AS d0),
k AS (
  SELECT client_id, campaign_id, SUM(spend) AS spend, SUM(clicks) AS clicks, SUM(impressions) AS impressions
  FROM `oneeighty-warehouse.mart.mart_gads_keywords_daily`, w WHERE date >= w.d0 GROUP BY client_id, campaign_id
),
c AS (
  SELECT client_id, campaign_id, SUM(spend) AS spend, SUM(clicks) AS clicks, SUM(impressions) AS impressions
  FROM `oneeighty-warehouse.mart.mart_gads_campaign_daily`, w
  WHERE date >= w.d0 AND ad_network_type IN ('SEARCH', 'SEARCH_PARTNERS') GROUP BY client_id, campaign_id
)
SELECT k.client_id,
  ROUND(SUM(k.spend), 2) AS keyword_spend, ROUND(SUM(c.spend), 2) AS campaign_spend,
  SUM(k.clicks) AS keyword_clicks, SUM(c.clicks) AS campaign_clicks,
  SUM(k.impressions) AS keyword_impressions, SUM(c.impressions) AS campaign_impressions,
  IF(ABS(SUM(k.spend) - SUM(c.spend)) < 0.01 AND SUM(k.clicks) = SUM(c.clicks) AND SUM(k.impressions) = SUM(c.impressions), 'OK', 'CHECK') AS `check`
FROM k JOIN c USING (client_id, campaign_id)
GROUP BY k.client_id
ORDER BY k.client_id;

-- ============================================================================
-- R9. Campaign dim classification review (the owner reads this after adding brand terms).
--     Lists every campaign that had spend in the last 90 days with its class and market.
-- ============================================================================
SELECT d.client_id, d.campaign_id, d.campaign_name, d.channel_type, d.status, d.brand_class, d.classified_by, d.market,
       ROUND(SUM(c.spend), 2) AS spend_90d
FROM `oneeighty-warehouse.mart.mart_gads_campaign_dim` d
JOIN `oneeighty-warehouse.mart.mart_gads_campaign_daily` c USING (client_id, campaign_id)
WHERE c.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
GROUP BY d.client_id, d.campaign_id, d.campaign_name, d.channel_type, d.status, d.brand_class, d.classified_by, d.market
HAVING spend_90d > 0
ORDER BY d.client_id, spend_90d DESC;
