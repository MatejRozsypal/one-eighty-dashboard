CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_creative_adset_perf` AS
WITH native AS (
  SELECT
    a.client_id, a.date_start, a.adset_id, a.adset_name, a.campaign_id, a.campaign_name,
    a.spend, a.purchase_value, a.purchases, a.impressions, a.clicks, a.reach,
    a.add_to_cart, a.initiate_checkout, a.landing_page_views, a.link_clicks,
    a.outbound_clicks, a.frequency, a.ctr, a.cpc
  FROM `oneeighty-warehouse.stg.stg_meta_adset_insights` a
),
adset_names AS (
  SELECT client_id, adset_id,
         ARRAY_AGG(adset_name IGNORE NULLS ORDER BY snapshot_date DESC LIMIT 1)[SAFE_OFFSET(0)] AS adset_name
  FROM `oneeighty-warehouse.stg.stg_meta_ad_creatives`
  GROUP BY client_id, adset_id
),
campaign_names AS (
  SELECT client_id, campaign_id,
         ARRAY_AGG(campaign_name IGNORE NULLS ORDER BY date_start DESC LIMIT 1)[SAFE_OFFSET(0)] AS campaign_name
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights`
  GROUP BY client_id, campaign_id
),
from_ads AS (
  SELECT
    i.client_id,
    i.date_start,
    i.adset_id,
    ANY_VALUE(i.campaign_id)       AS campaign_id,
    SUM(i.spend)                   AS spend,
    SUM(i.purchase_value)          AS purchase_value,
    SUM(i.purchases)               AS purchases,
    SUM(i.impressions)             AS impressions,
    SUM(i.clicks)                  AS clicks,
    SUM(i.add_to_cart)             AS add_to_cart,
    SUM(i.initiate_checkout)       AS initiate_checkout,
    SUM(i.landing_page_views)      AS landing_page_views,
    SUM(i.link_clicks)             AS link_clicks,
    SUM(i.outbound_clicks)         AS outbound_clicks
  FROM `oneeighty-warehouse.stg.stg_meta_ad_insights` i
  WHERE i.adset_id IS NOT NULL
  GROUP BY i.client_id, i.date_start, i.adset_id
),
derived AS (
  SELECT
    d.client_id, d.date_start, d.adset_id, an.adset_name, d.campaign_id, cn.campaign_name,
    d.spend, d.purchase_value, d.purchases, d.impressions, d.clicks,
    CAST(NULL AS INT64)                                  AS reach,
    d.add_to_cart, d.initiate_checkout, d.landing_page_views, d.link_clicks,
    d.outbound_clicks,
    CAST(NULL AS NUMERIC)                                AS frequency,
    CAST(SAFE_DIVIDE(d.clicks * 100, d.impressions) AS NUMERIC) AS ctr,
    CAST(SAFE_DIVIDE(d.spend, d.clicks) AS NUMERIC)      AS cpc
  FROM from_ads d
  LEFT JOIN adset_names an    ON an.client_id = d.client_id AND an.adset_id = d.adset_id
  LEFT JOIN campaign_names cn ON cn.client_id = d.client_id AND cn.campaign_id = d.campaign_id
  WHERE NOT EXISTS (
    SELECT 1 FROM native n
    WHERE n.client_id = d.client_id AND n.adset_id = d.adset_id AND n.date_start = d.date_start)
),
unioned AS (
  SELECT * FROM native
  UNION ALL
  SELECT * FROM derived
)
SELECT
  a.client_id,
  a.date_start                          AS date,
  a.adset_id,
  a.adset_name,
  a.campaign_id,
  a.campaign_name,
  a.spend,
  a.purchase_value                      AS revenue,
  a.purchases,
  a.impressions,
  a.clicks,
  a.reach,
  a.add_to_cart,
  a.initiate_checkout,
  a.landing_page_views,
  a.link_clicks,
  a.outbound_clicks,
  a.frequency                           AS frequency_per_day,
  a.ctr                                 AS ctr_per_day,
  a.cpc                                 AS cpc_per_day,
  SAFE_DIVIDE(a.spend, a.purchases)      AS cost_per_purchase_per_day,
  SAFE_DIVIDE(a.purchase_value, a.spend) AS roas_per_day,
  c.meta_currency                       AS currency
FROM unioned a
JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
WHERE a.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);
