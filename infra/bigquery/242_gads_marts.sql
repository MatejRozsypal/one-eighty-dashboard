-- 242_gads_marts.sql
-- Paid redesign (package PA2): Google Ads marts for the Paid > Google tab.
--
-- Purpose:    model the DTS tables that were loading but unused (stats by network,
--             device, impression share, conversion category, ad group, search term,
--             keyword, shopping product) into seven views, plus brand classification.
-- Based on:   `stg.stg_google_ads_campaign_insights` and `mart.mart_daily_kpis` as live
--             on 2026-10-04 (account to client mapping, FX pattern). Nothing existing
--             is changed: `mart_daily_kpis` and the stg view are untouched.
-- Affected:   no existing view or client. New objects, all in dataset `mart`:
--               mart_gads_campaign_dim, mart_gads_campaign_daily,
--               mart_gads_campaign_device_daily, mart_gads_adgroup_daily,
--               mart_gads_search_terms_daily, mart_gads_keywords_daily,
--               mart_gads_products_daily.
--             Clients with data today: manami (5865960448), rawbark (9406261058).
-- Requires:   241_ref_client_brand_terms.sql (this package) and the PA1 migration that
--             creates `ref.naming_rules` and `ref.campaign_overrides`. Deploy PA1 first.
-- Regression: infra/bigquery/qa/242_regression.sql (spend per client and month equals
--             mart_daily_kpis.google_spend; device view equals campaign view).
-- Deploy order: 2 of 2, after 241 and after PA1. Views only, safe to re-run.
--
-- Facts that shape these views (verified against the live DTS tables on 2026-10-04):
--   * Money comes from CampaignBasicStats only. CampaignStats is under by 12 percent
--     for rawbark and must not be used for spend.
--   * The partition date equals segments_date, so `date = DATE(_PARTITIONTIME)` and a
--     dashboard `date BETWEEN` prunes partitions. Every stats read is bounded to the
--     last 25 months and `date < CURRENT_DATE()` (Google Ads is D-1).
--   * One grain per view. campaign_daily is campaign x date x network (device summed
--     away, because CampaignConversionStats and CampaignCrossDeviceStats have no
--     device); the device split lives in campaign_device_daily.
--   * Impression share is stored as components so it can be re-aggregated:
--       eligible_impressions = impressions / search_impression_share, only where the
--       share is reported. DTS writes 0.0 for "not reported" (for example Search
--       partners, PMax), so a share of 0 is treated as NULL. "<10%" arrives as 0.0999.
--       Search IS over any set of rows = SUM(is_impressions) / SUM(eligible_impressions),
--       lost shares the same way with the lost_* columns, absolute top IS with
--       abs_top_impressions. Top IS = SUM(top_impressions) / SUM(top_eligible_impressions)
--       (Shopping reports top IS as 0, so those rows are excluded from both sums).
--       Never average the shares. A reported "<10%" is stored by Google as 0.0999, so
--       rows at that floor value make the components sum to slightly more than 1.
--   * KeywordStats is segmented by click_type: spend, clicks and conversions reconcile
--     when summed, but impressions repeat per click type. Only click_type URL_CLICKS
--     carries the true impressions (28,663 of 28,663 for rawbark in Sep 2026), so the
--     keyword view takes impressions from that row type only.
--   * Money columns are in the Google Ads account currency. `*_client_ccy` columns use
--     that month's ref.fx_rates rate (factor applied per row before any SUM, same as
--     mart_daily_kpis); a missing rate gives NULL, never a wrong number.
--   * Ids (campaign, ad group, criterion) are STRING, as in the stg views.
--
-- Brand class of a campaign (campaign_dim.brand_class):
--   1. ref.campaign_overrides (platform 'google') wins;
--   2. channel SHOPPING or PERFORMANCE_MAX gives 'shopping_pmax';
--   3. channel SEARCH and (the name has the token brand or brd, or matches a brand term
--      with scope 'campaign') gives 'brand'. Tokens are split on any non letter or digit,
--      so PER_BRD_KW_CZ~Brand CPC is brand (the spec token \bbrand\b would miss BRD_);
--   4. other SEARCH gives 'non_brand';
--   5. anything else (Display, Video, Demand Gen, ...) gives 'other'.
-- Search terms and keywords carry is_brand from the same brand-term list (scope
-- 'search_term'); the dashboard computes brand leakage from search_terms_daily
-- (is_brand in a campaign whose campaign_brand_class is 'non_brand').

-- ---------------------------------------------------------------------------
-- 0. Google market rule (idempotent seed for the PA1 table `ref.naming_rules`).
--    Token before or after is any non letter or digit, so PER_SEA_KW_CZ~Nejlepsi gives CZ.
--    Client rules beat '*', lower priority wins (same convention as the Meta rules).
-- ---------------------------------------------------------------------------
INSERT INTO `oneeighty-warehouse.ref.naming_rules`
  (client_id, platform, entity, dimension, pattern, value, priority, note, updated_at)
SELECT '*', 'google', 'campaign', 'market',
       r'(?:^|[^a-z0-9])(cz|sk|de|at|pl|hu|us|ca|eu)(?:$|[^a-z0-9])',
       CAST(NULL AS STRING), 10,
       'PA2 seed 2026-10-04: country token in the campaign name, capture group upper-cased', CURRENT_TIMESTAMP()
FROM (SELECT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM `oneeighty-warehouse.ref.naming_rules`
  WHERE client_id = '*' AND platform = 'google' AND entity = 'campaign' AND dimension = 'market'
);

-- ---------------------------------------------------------------------------
-- 1. mart_gads_campaign_dim: one row per (client_id, campaign_id), latest attributes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_gads_campaign_dim` AS
WITH cm AS (
  SELECT gads_customer_id AS customer_id, client_id, gads_currency AS currency
  FROM `oneeighty-warehouse.ref.clients`
  WHERE has_gads AND gads_customer_id IS NOT NULL
),
latest AS (
  -- Entity snapshot: latest row per campaign. Same 25 month window as the stats so a
  -- removed campaign keeps its name for every day it has spend.
  SELECT
    customer_id, campaign_id, campaign_name,
    campaign_advertising_channel_type     AS channel_type,
    campaign_advertising_channel_sub_type AS channel_sub_type,
    campaign_status                       AS status,
    campaign_serving_status               AS serving_status,
    campaign_bidding_strategy_type        AS bidding_strategy_type,
    NULLIF(campaign_maximize_conversion_value_target_roas, 0) AS target_roas,
    IF(campaign_budget_period = 'DAILY', campaign_budget_amount_micros / 1e6, NULL) AS budget_per_day,
    campaign_budget_explicitly_shared     AS budget_shared
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_Campaign_*`
  WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH))
  QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id, campaign_id ORDER BY _PARTITIONTIME DESC) = 1
),
named AS (
  SELECT
    cm.client_id, cm.currency,
    CAST(l.campaign_id AS STRING) AS campaign_id,
    l.* EXCEPT (customer_id, campaign_id),
    LOWER(l.campaign_name) AS name_lc,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(NORMALIZE(l.campaign_name, NFD)), r'\p{M}', ''), r'\s+', ' ')) AS name_norm
  FROM latest l
  JOIN cm USING (customer_id)
),
terms AS (
  SELECT client_id, term_norm, match_type, is_exclusion
  FROM `oneeighty-warehouse.ref.client_brand_terms`
  WHERE applies_to IN ('all', 'campaign') AND term_norm != ''
),
brand_hit AS (
  SELECT
    n.client_id, n.campaign_id,
    LOGICAL_OR(NOT t.is_exclusion AND (CASE t.match_type
      WHEN 'contains' THEN STRPOS(n.name_norm, t.term_norm) > 0
      WHEN 'word'     THEN SAFE.REGEXP_CONTAINS(n.name_norm, CONCAT(r'(^|\W)', REGEXP_REPLACE(t.term_norm, r'([.*+?^${}()|\[\]\\])', r'\\\1'), r'(\W|$)'))
      WHEN 'exact'    THEN n.name_norm = t.term_norm
      WHEN 'regex'    THEN SAFE.REGEXP_CONTAINS(n.name_norm, t.term_norm)
      ELSE FALSE END)) AS hit,
    LOGICAL_OR(t.is_exclusion AND (CASE t.match_type
      WHEN 'contains' THEN STRPOS(n.name_norm, t.term_norm) > 0
      WHEN 'word'     THEN SAFE.REGEXP_CONTAINS(n.name_norm, CONCAT(r'(^|\W)', REGEXP_REPLACE(t.term_norm, r'([.*+?^${}()|\[\]\\])', r'\\\1'), r'(\W|$)'))
      WHEN 'exact'    THEN n.name_norm = t.term_norm
      WHEN 'regex'    THEN SAFE.REGEXP_CONTAINS(n.name_norm, t.term_norm)
      ELSE FALSE END)) AS excl
  FROM named n
  JOIN terms t ON t.client_id = n.client_id
  GROUP BY n.client_id, n.campaign_id
),
rules AS (
  SELECT client_id, pattern, value, priority
  FROM `oneeighty-warehouse.ref.naming_rules`
  WHERE platform = 'google' AND entity = 'campaign' AND dimension = 'market'
),
market_pick AS (
  SELECT
    n.client_id, n.campaign_id,
    ARRAY_AGG(UPPER(COALESCE(r.value, REGEXP_EXTRACT(n.name_lc, CONCAT('(?i)', r.pattern))))
              ORDER BY IF(r.client_id = '*', 1, 0), r.priority LIMIT 1)[OFFSET(0)] AS market
  FROM named n
  JOIN rules r
    ON r.client_id IN (n.client_id, '*')
   AND SAFE.REGEXP_CONTAINS(n.name_lc, CONCAT('(?i)', r.pattern))
  GROUP BY n.client_id, n.campaign_id
),
ov AS (
  SELECT client_id, CAST(campaign_id AS STRING) AS campaign_id, brand_class, market
  FROM `oneeighty-warehouse.ref.campaign_overrides`
  WHERE platform = 'google'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY client_id, CAST(campaign_id AS STRING) ORDER BY updated_at DESC) = 1
)
SELECT
  n.client_id,
  n.campaign_id,
  n.campaign_name,
  n.channel_type,
  n.channel_sub_type,
  n.status,
  n.serving_status,
  n.bidding_strategy_type,
  n.target_roas,
  n.budget_per_day,
  n.budget_shared,
  CASE
    WHEN o.brand_class IS NOT NULL THEN o.brand_class
    WHEN n.channel_type IN ('SHOPPING', 'PERFORMANCE_MAX') THEN 'shopping_pmax'
    WHEN n.channel_type = 'SEARCH'
         AND (REGEXP_CONTAINS(n.name_norm, r'(^|[^a-z0-9])(brand|brd)([^a-z0-9]|$)')
              OR COALESCE(h.hit AND NOT h.excl, FALSE)) THEN 'brand'
    WHEN n.channel_type = 'SEARCH' THEN 'non_brand'
    ELSE 'other'
  END AS brand_class,
  CASE
    WHEN o.brand_class IS NOT NULL THEN 'override'
    WHEN n.channel_type IN ('SHOPPING', 'PERFORMANCE_MAX', 'SEARCH') THEN 'rule'
    ELSE 'none'
  END AS classified_by,
  COALESCE(UPPER(o.market), mp.market) AS market,
  n.currency
FROM named n
LEFT JOIN brand_hit   h  ON h.client_id  = n.client_id AND h.campaign_id  = n.campaign_id
LEFT JOIN market_pick mp ON mp.client_id = n.client_id AND mp.campaign_id = n.campaign_id
LEFT JOIN ov          o  ON o.client_id  = n.client_id AND o.campaign_id  = n.campaign_id;

-- ---------------------------------------------------------------------------
-- 2. mart_gads_campaign_daily: campaign x date x network.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_gads_campaign_daily` AS
WITH cm AS (
  SELECT gads_customer_id AS customer_id, client_id,
         gads_currency, currency AS client_currency
  FROM `oneeighty-warehouse.ref.clients`
  WHERE has_gads AND gads_customer_id IS NOT NULL
),
basic AS (
  SELECT
    customer_id, campaign_id, DATE(_PARTITIONTIME) AS date,
    segments_ad_network_type                AS ad_network_type,
    SUM(metrics_cost_micros) / 1e6          AS spend,
    SUM(metrics_impressions)                AS impressions,
    SUM(metrics_clicks)                     AS clicks,
    SUM(metrics_conversions)                AS conversions,
    SUM(metrics_conversions_value)          AS conversions_value,
    SUM(metrics_view_through_conversions)   AS view_through_conversions
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_CampaignBasicStats_*`
  WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH))
    AND DATE(_PARTITIONTIME) < CURRENT_DATE()
  GROUP BY customer_id, campaign_id, date, ad_network_type
),
purch AS (
  -- Purchase-category conversions. CampaignConversionStats has no device, so this
  -- joins cleanly at campaign x date x network.
  SELECT
    customer_id, campaign_id, DATE(_PARTITIONTIME) AS date,
    segments_ad_network_type       AS ad_network_type,
    SUM(metrics_conversions)       AS purchases,
    SUM(metrics_conversions_value) AS purchase_value
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_CampaignConversionStats_*`
  WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH))
    AND DATE(_PARTITIONTIME) < CURRENT_DATE()
    AND segments_conversion_action_category = 'PURCHASE'
  GROUP BY customer_id, campaign_id, date, ad_network_type
),
ish AS (
  SELECT
    customer_id, campaign_id, DATE(_PARTITIONTIME) AS date,
    segments_ad_network_type                                  AS ad_network_type,
    MAX(metrics_search_impression_share)                      AS is_share,
    MAX(metrics_search_budget_lost_impression_share)          AS lost_budget_share,
    MAX(metrics_search_rank_lost_impression_share)            AS lost_rank_share,
    MAX(metrics_search_top_impression_share)                  AS top_share,
    MAX(metrics_search_absolute_top_impression_share)         AS abs_top_share,
    MAX(metrics_search_click_share)                           AS click_share
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_CampaignCrossDeviceStats_*`
  WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH))
    AND DATE(_PARTITIONTIME) < CURRENT_DATE()
  GROUP BY customer_id, campaign_id, date, ad_network_type
),
j AS (
  SELECT
    customer_id, campaign_id, date, ad_network_type,
    COALESCE(b.spend, 0)                   AS spend,
    COALESCE(b.impressions, 0)             AS impressions,
    COALESCE(b.clicks, 0)                  AS clicks,
    COALESCE(b.conversions, 0)             AS conversions,
    COALESCE(b.conversions_value, 0)       AS conversions_value,
    COALESCE(b.view_through_conversions, 0) AS view_through_conversions,
    COALESCE(p.purchases, 0)               AS purchases,
    COALESCE(p.purchase_value, 0)          AS purchase_value,
    i.is_share, i.lost_budget_share, i.lost_rank_share, i.top_share, i.abs_top_share, i.click_share
  FROM basic b
  FULL OUTER JOIN purch p USING (customer_id, campaign_id, date, ad_network_type)
  LEFT JOIN ish i USING (customer_id, campaign_id, date, ad_network_type)
),
fx AS (
  SELECT month_start, from_currency, to_currency, rate
  FROM `oneeighty-warehouse.ref.fx_rates`
)
SELECT
  cm.client_id,
  j.date,
  CAST(j.campaign_id AS STRING) AS campaign_id,
  j.ad_network_type,
  d.campaign_name,
  d.channel_type,
  d.brand_class,
  d.market,
  j.spend,
  j.impressions,
  j.clicks,
  j.conversions,
  j.conversions_value,
  j.view_through_conversions,
  j.purchases,
  j.purchase_value,
  -- Impression share components (only rows where the share is reported, i.e. > 0).
  IF(j.is_share > 0, j.impressions, NULL)                                   AS is_impressions,
  IF(j.is_share > 0, j.impressions / j.is_share, NULL)                      AS eligible_impressions,
  IF(j.is_share > 0, j.impressions / j.is_share * j.lost_budget_share, NULL) AS lost_budget_impressions,
  IF(j.is_share > 0, j.impressions / j.is_share * j.lost_rank_share, NULL)   AS lost_rank_impressions,
  -- Shopping campaigns report top IS as 0 while absolute top IS is set (not reported, not zero).
  -- Those rows get NULL top_impressions and NULL top_eligible_impressions.
  -- Top IS = SUM(top_impressions) / SUM(top_eligible_impressions).
  IF(j.is_share > 0 AND NOT (j.top_share = 0 AND j.abs_top_share > 0), j.impressions / j.is_share * j.top_share, NULL) AS top_impressions,
  IF(j.is_share > 0 AND NOT (j.top_share = 0 AND j.abs_top_share > 0), j.impressions / j.is_share, NULL)               AS top_eligible_impressions,
  IF(j.is_share > 0, j.impressions / j.is_share * j.abs_top_share, NULL)     AS abs_top_impressions,
  -- Click share: SUM(click_share_clicks) / SUM(eligible_clicks).
  IF(j.click_share > 0, j.clicks, NULL)                                     AS click_share_clicks,
  IF(j.click_share > 0, j.clicks / j.click_share, NULL)                     AS eligible_clicks,
  j.spend             * CAST(IF(cm.gads_currency = cm.client_currency, NUMERIC '1', r.rate) AS FLOAT64) AS spend_client_ccy,
  j.conversions_value * CAST(IF(cm.gads_currency = cm.client_currency, NUMERIC '1', r.rate) AS FLOAT64) AS conversions_value_client_ccy,
  j.purchase_value    * CAST(IF(cm.gads_currency = cm.client_currency, NUMERIC '1', r.rate) AS FLOAT64) AS purchase_value_client_ccy,
  cm.gads_currency    AS currency,
  cm.client_currency  AS client_currency
FROM j
JOIN cm USING (customer_id)
LEFT JOIN `oneeighty-warehouse.mart.mart_gads_campaign_dim` d
  ON d.client_id = cm.client_id AND d.campaign_id = CAST(j.campaign_id AS STRING)
LEFT JOIN fx r
  ON  r.month_start   = DATE_TRUNC(j.date, MONTH)
  AND r.from_currency = cm.gads_currency
  AND r.to_currency   = cm.client_currency;

-- ---------------------------------------------------------------------------
-- 3. mart_gads_campaign_device_daily: campaign x date x device (all networks).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_gads_campaign_device_daily` AS
WITH cm AS (
  SELECT gads_customer_id AS customer_id, client_id,
         gads_currency, currency AS client_currency
  FROM `oneeighty-warehouse.ref.clients`
  WHERE has_gads AND gads_customer_id IS NOT NULL
),
basic AS (
  SELECT
    customer_id, campaign_id, DATE(_PARTITIONTIME) AS date,
    segments_device                         AS device,
    SUM(metrics_cost_micros) / 1e6          AS spend,
    SUM(metrics_impressions)                AS impressions,
    SUM(metrics_clicks)                     AS clicks,
    SUM(metrics_conversions)                AS conversions,
    SUM(metrics_conversions_value)          AS conversions_value
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_CampaignBasicStats_*`
  WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH))
    AND DATE(_PARTITIONTIME) < CURRENT_DATE()
  GROUP BY customer_id, campaign_id, date, device
)
SELECT
  cm.client_id,
  b.date,
  CAST(b.campaign_id AS STRING) AS campaign_id,
  b.device,
  d.campaign_name,
  d.channel_type,
  b.spend,
  b.impressions,
  b.clicks,
  b.conversions,
  b.conversions_value,
  b.spend             * CAST(IF(cm.gads_currency = cm.client_currency, NUMERIC '1', r.rate) AS FLOAT64) AS spend_client_ccy,
  b.conversions_value * CAST(IF(cm.gads_currency = cm.client_currency, NUMERIC '1', r.rate) AS FLOAT64) AS conversions_value_client_ccy,
  cm.gads_currency    AS currency,
  cm.client_currency  AS client_currency
FROM basic b
JOIN cm USING (customer_id)
LEFT JOIN `oneeighty-warehouse.mart.mart_gads_campaign_dim` d
  ON d.client_id = cm.client_id AND d.campaign_id = CAST(b.campaign_id AS STRING)
LEFT JOIN `oneeighty-warehouse.ref.fx_rates` r
  ON  r.month_start   = DATE_TRUNC(b.date, MONTH)
  AND r.from_currency = cm.gads_currency
  AND r.to_currency   = cm.client_currency;

-- ---------------------------------------------------------------------------
-- 4. mart_gads_adgroup_daily: campaign x ad group x date (all networks and devices).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_gads_adgroup_daily` AS
WITH cm AS (
  SELECT gads_customer_id AS customer_id, client_id
  FROM `oneeighty-warehouse.ref.clients`
  WHERE has_gads AND gads_customer_id IS NOT NULL
),
stats AS (
  SELECT
    customer_id, campaign_id, ad_group_id, DATE(_PARTITIONTIME) AS date,
    SUM(metrics_cost_micros) / 1e6   AS spend,
    SUM(metrics_impressions)         AS impressions,
    SUM(metrics_clicks)              AS clicks,
    SUM(metrics_conversions)         AS conversions,
    SUM(metrics_conversions_value)   AS conversions_value
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_AdGroupBasicStats_*`
  WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH))
    AND DATE(_PARTITIONTIME) < CURRENT_DATE()
  GROUP BY customer_id, campaign_id, ad_group_id, date
),
ag AS (
  SELECT customer_id, ad_group_id, ad_group_name, ad_group_type, ad_group_status
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_AdGroup_*`
  WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH))
  QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id, ad_group_id ORDER BY _PARTITIONTIME DESC) = 1
)
SELECT
  cm.client_id,
  s.date,
  CAST(s.campaign_id AS STRING) AS campaign_id,
  CAST(s.ad_group_id AS STRING) AS ad_group_id,
  ag.ad_group_name,
  ag.ad_group_type,
  ag.ad_group_status,
  s.spend, s.impressions, s.clicks, s.conversions, s.conversions_value
FROM stats s
JOIN cm USING (customer_id)
LEFT JOIN ag USING (customer_id, ad_group_id);

-- ---------------------------------------------------------------------------
-- 5. mart_gads_search_terms_daily: date x campaign x ad group x term x match type
--    (x status x triggering keyword; device and network summed away).
--    Search terms below Google's privacy threshold are not exported by DTS, so this
--    view does not add up to campaign spend. Coverage is measured in the QA file.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_gads_search_terms_daily` AS
WITH cm AS (
  SELECT gads_customer_id AS customer_id, client_id
  FROM `oneeighty-warehouse.ref.clients`
  WHERE has_gads AND gads_customer_id IS NOT NULL
),
base AS (
  SELECT
    customer_id, DATE(_PARTITIONTIME) AS date, campaign_id, ad_group_id,
    search_term_view_search_term          AS search_term,
    segments_search_term_match_type       AS match_type,
    search_term_view_status               AS term_status,
    segments_keyword_ad_group_criterion   AS keyword_criterion,
    SUM(metrics_cost_micros) / 1e6        AS spend,
    SUM(metrics_impressions)              AS impressions,
    SUM(metrics_clicks)                   AS clicks,
    SUM(metrics_conversions)              AS conversions,
    SUM(metrics_conversions_value)        AS conversions_value
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_SearchQueryStats_*`
  WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH))
    AND DATE(_PARTITIONTIME) < CURRENT_DATE()
  GROUP BY customer_id, date, campaign_id, ad_group_id, search_term, match_type, term_status, keyword_criterion
),
b AS (
  SELECT
    cm.client_id, base.*,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(NORMALIZE(base.search_term, NFD)), r'\p{M}', ''), r'\s+', ' ')) AS term_norm
  FROM base
  JOIN cm USING (customer_id)
),
terms AS (
  SELECT client_id, term_norm, match_type, is_exclusion
  FROM `oneeighty-warehouse.ref.client_brand_terms`
  WHERE applies_to IN ('all', 'search_term') AND term_norm != ''
),
hits AS (
  SELECT
    w.client_id, w.term_norm,
    LOGICAL_OR(NOT t.is_exclusion AND (CASE t.match_type
      WHEN 'contains' THEN STRPOS(w.term_norm, t.term_norm) > 0
      WHEN 'word'     THEN SAFE.REGEXP_CONTAINS(w.term_norm, CONCAT(r'(^|\W)', REGEXP_REPLACE(t.term_norm, r'([.*+?^${}()|\[\]\\])', r'\\\1'), r'(\W|$)'))
      WHEN 'exact'    THEN w.term_norm = t.term_norm
      WHEN 'regex'    THEN SAFE.REGEXP_CONTAINS(w.term_norm, t.term_norm)
      ELSE FALSE END)) AS hit,
    LOGICAL_OR(t.is_exclusion AND (CASE t.match_type
      WHEN 'contains' THEN STRPOS(w.term_norm, t.term_norm) > 0
      WHEN 'word'     THEN SAFE.REGEXP_CONTAINS(w.term_norm, CONCAT(r'(^|\W)', REGEXP_REPLACE(t.term_norm, r'([.*+?^${}()|\[\]\\])', r'\\\1'), r'(\W|$)'))
      WHEN 'exact'    THEN w.term_norm = t.term_norm
      WHEN 'regex'    THEN SAFE.REGEXP_CONTAINS(w.term_norm, t.term_norm)
      ELSE FALSE END)) AS excl
  FROM (SELECT DISTINCT client_id, term_norm FROM b) w
  JOIN terms t ON t.client_id = w.client_id
  GROUP BY w.client_id, w.term_norm
)
SELECT
  b.client_id,
  b.date,
  CAST(b.campaign_id AS STRING) AS campaign_id,
  CAST(b.ad_group_id AS STRING) AS ad_group_id,
  b.search_term,
  b.match_type,
  b.term_status,
  b.keyword_criterion,
  COALESCE(h.hit AND NOT h.excl, FALSE) AS is_brand,
  d.brand_class AS campaign_brand_class,
  b.spend, b.impressions, b.clicks, b.conversions, b.conversions_value
FROM b
LEFT JOIN hits h ON h.client_id = b.client_id AND h.term_norm = b.term_norm
LEFT JOIN `oneeighty-warehouse.mart.mart_gads_campaign_dim` d
  ON d.client_id = b.client_id AND d.campaign_id = CAST(b.campaign_id AS STRING);

-- ---------------------------------------------------------------------------
-- 6. mart_gads_keywords_daily: date x campaign x ad group x keyword.
--    Negative keywords are filtered out. Quality fields are the latest known value of the
--    keyword, repeated on every day. Impressions come from click_type URL_CLICKS only
--    (see header); spend, clicks and conversions are summed over all click types.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_gads_keywords_daily` AS
WITH cm AS (
  SELECT gads_customer_id AS customer_id, client_id
  FROM `oneeighty-warehouse.ref.clients`
  WHERE has_gads AND gads_customer_id IS NOT NULL
),
stats AS (
  SELECT
    customer_id, DATE(_PARTITIONTIME) AS date, campaign_id, ad_group_id,
    ad_group_criterion_criterion_id AS criterion_id,
    SUM(metrics_cost_micros) / 1e6  AS spend,
    SUM(IF(segments_click_type = 'URL_CLICKS', metrics_impressions, 0)) AS impressions,
    SUM(metrics_clicks)             AS clicks,
    SUM(metrics_conversions)        AS conversions,
    SUM(metrics_conversions_value)  AS conversions_value
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_KeywordStats_*`
  WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH))
    AND DATE(_PARTITIONTIME) < CURRENT_DATE()
  GROUP BY customer_id, date, campaign_id, ad_group_id, criterion_id
),
kw AS (
  SELECT
    customer_id, ad_group_id, ad_group_criterion_criterion_id AS criterion_id,
    ad_group_criterion_keyword_text                       AS keyword_text,
    ad_group_criterion_keyword_match_type                 AS match_type,
    ad_group_criterion_negative                           AS is_negative,
    ad_group_criterion_quality_info_quality_score         AS quality_score,
    ad_group_criterion_quality_info_search_predicted_ctr  AS predicted_ctr,
    ad_group_criterion_quality_info_creative_quality_score AS creative_quality,
    ad_group_criterion_quality_info_post_click_quality_score AS landing_page_quality
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_Keyword_*`
  WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH))
  QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id, ad_group_id, ad_group_criterion_criterion_id ORDER BY _PARTITIONTIME DESC) = 1
),
s AS (
  SELECT
    cm.client_id, st.*, kw.keyword_text, kw.match_type,
    kw.quality_score, kw.predicted_ctr, kw.creative_quality, kw.landing_page_quality,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(NORMALIZE(kw.keyword_text, NFD)), r'\p{M}', ''), r'\s+', ' ')) AS term_norm
  FROM stats st
  JOIN cm USING (customer_id)
  LEFT JOIN kw ON kw.customer_id = st.customer_id AND kw.ad_group_id = st.ad_group_id AND kw.criterion_id = st.criterion_id
  WHERE COALESCE(kw.is_negative, FALSE) = FALSE
),
terms AS (
  SELECT client_id, term_norm, match_type, is_exclusion
  FROM `oneeighty-warehouse.ref.client_brand_terms`
  WHERE applies_to IN ('all', 'search_term') AND term_norm != ''
),
hits AS (
  SELECT
    w.client_id, w.term_norm,
    LOGICAL_OR(NOT t.is_exclusion AND (CASE t.match_type
      WHEN 'contains' THEN STRPOS(w.term_norm, t.term_norm) > 0
      WHEN 'word'     THEN SAFE.REGEXP_CONTAINS(w.term_norm, CONCAT(r'(^|\W)', REGEXP_REPLACE(t.term_norm, r'([.*+?^${}()|\[\]\\])', r'\\\1'), r'(\W|$)'))
      WHEN 'exact'    THEN w.term_norm = t.term_norm
      WHEN 'regex'    THEN SAFE.REGEXP_CONTAINS(w.term_norm, t.term_norm)
      ELSE FALSE END)) AS hit,
    LOGICAL_OR(t.is_exclusion AND (CASE t.match_type
      WHEN 'contains' THEN STRPOS(w.term_norm, t.term_norm) > 0
      WHEN 'word'     THEN SAFE.REGEXP_CONTAINS(w.term_norm, CONCAT(r'(^|\W)', REGEXP_REPLACE(t.term_norm, r'([.*+?^${}()|\[\]\\])', r'\\\1'), r'(\W|$)'))
      WHEN 'exact'    THEN w.term_norm = t.term_norm
      WHEN 'regex'    THEN SAFE.REGEXP_CONTAINS(w.term_norm, t.term_norm)
      ELSE FALSE END)) AS excl
  FROM (SELECT DISTINCT client_id, term_norm FROM s WHERE term_norm IS NOT NULL) w
  JOIN terms t ON t.client_id = w.client_id
  GROUP BY w.client_id, w.term_norm
)
SELECT
  s.client_id,
  s.date,
  CAST(s.campaign_id AS STRING)  AS campaign_id,
  CAST(s.ad_group_id AS STRING)  AS ad_group_id,
  CAST(s.criterion_id AS STRING) AS criterion_id,
  s.keyword_text,
  s.match_type,
  s.quality_score,
  s.predicted_ctr,
  s.creative_quality,
  s.landing_page_quality,
  COALESCE(h.hit AND NOT h.excl, FALSE) AS is_brand,
  s.spend, s.impressions, s.clicks, s.conversions, s.conversions_value
FROM s
LEFT JOIN hits h ON h.client_id = s.client_id AND h.term_norm = s.term_norm;

-- ---------------------------------------------------------------------------
-- 7. mart_gads_products_daily: date x campaign x shopping item (all networks, devices).
--    Rows exist for Shopping and Demand Gen, and for the part of PMax that Google
--    attributes to products. Rawbark PMax has none today, so coverage is partial by
--    design; the dashboard shows it as "Covers N% of spend".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_gads_products_daily` AS
WITH cm AS (
  SELECT gads_customer_id AS customer_id, client_id
  FROM `oneeighty-warehouse.ref.clients`
  WHERE has_gads AND gads_customer_id IS NOT NULL
),
stats AS (
  SELECT
    customer_id, DATE(_PARTITIONTIME) AS date, campaign_id,
    segments_product_item_id            AS item_id,
    segments_product_brand              AS brand,
    segments_product_type_l1            AS product_type_l1,
    segments_product_type_l2            AS product_type_l2,
    segments_product_category_level1    AS category_l1,
    segments_product_category_level2    AS category_l2,
    segments_product_custom_attribute0  AS custom_label_0,
    segments_product_custom_attribute1  AS custom_label_1,
    segments_product_custom_attribute2  AS custom_label_2,
    segments_product_country            AS product_country,
    SUM(metrics_cost_micros) / 1e6      AS spend,
    SUM(metrics_impressions)            AS impressions,
    SUM(metrics_clicks)                 AS clicks,
    SUM(metrics_conversions)            AS conversions,
    SUM(metrics_conversions_value)      AS conversions_value
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_ShoppingProductStats_*`
  WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH))
    AND DATE(_PARTITIONTIME) < CURRENT_DATE()
  GROUP BY customer_id, date, campaign_id, item_id, brand, product_type_l1, product_type_l2,
           category_l1, category_l2, custom_label_0, custom_label_1, custom_label_2, product_country
)
SELECT
  cm.client_id,
  s.date,
  CAST(s.campaign_id AS STRING) AS campaign_id,
  s.item_id,
  d.channel_type,
  s.brand, s.product_type_l1, s.product_type_l2, s.category_l1, s.category_l2,
  s.custom_label_0, s.custom_label_1, s.custom_label_2, s.product_country,
  s.spend, s.impressions, s.clicks, s.conversions, s.conversions_value
FROM stats s
JOIN cm USING (customer_id)
LEFT JOIN `oneeighty-warehouse.mart.mart_gads_campaign_dim` d
  ON d.client_id = cm.client_id AND d.campaign_id = CAST(s.campaign_id AS STRING);
