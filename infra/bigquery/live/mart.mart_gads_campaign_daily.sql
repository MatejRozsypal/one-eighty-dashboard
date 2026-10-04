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
