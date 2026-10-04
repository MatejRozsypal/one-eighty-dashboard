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
