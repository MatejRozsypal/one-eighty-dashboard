CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_meta_ad_perf` AS
SELECT
  i.client_id,
  i.date_start AS date,
  i.ad_id, i.ad_name, i.campaign_id, i.adset_id, i.ad_account_id,
  i.spend, i.purchase_value AS revenue, i.purchases, i.impressions, i.clicks, i.reach,
  i.add_to_cart, i.initiate_checkout, i.landing_page_views, i.link_clicks, i.video_views,
  i.video_play_actions, i.video_thruplays,
  i.frequency                            AS frequency_per_day,
  i.ctr                                  AS ctr_per_day,
  i.cpc                                  AS cpc_per_day,
  SAFE_DIVIDE(i.spend, i.purchases)      AS cost_per_purchase_per_day,
  SAFE_DIVIDE(i.purchase_value, i.spend) AS roas_per_day,
  c.meta_currency AS currency,
  -- additive (PA1). The first eight are NULL until the ad-insights ingest requests them.
  i.outbound_clicks,
  i.unique_outbound_clicks,
  i.video_p25_watched,
  i.video_p50_watched,
  i.video_p75_watched,
  i.video_p95_watched,
  i.video_p100_watched,
  i.video_30s_watched,
  (SELECT CAST(SUM(SAFE_CAST(JSON_VALUE(a, '$.value') AS NUMERIC)) AS INT64)
     FROM UNNEST(JSON_QUERY_ARRAY(SAFE.PARSE_JSON(i.actions))) a
    WHERE JSON_VALUE(a, '$.action_type') = 'omni_view_content')  AS view_content,
  (SELECT CAST(SUM(SAFE_CAST(JSON_VALUE(a, '$.value') AS NUMERIC)) AS INT64)
     FROM UNNEST(JSON_QUERY_ARRAY(SAFE.PARSE_JSON(i.actions))) a
    WHERE JSON_VALUE(a, '$.action_type') = 'add_payment_info')   AS add_payment_info
FROM `oneeighty-warehouse.stg.stg_meta_ad_insights` i
JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
WHERE i.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);
