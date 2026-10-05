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
    WHERE JSON_VALUE(a, '$.action_type') = 'add_payment_info')   AS add_payment_info,
  -- additive (256, ME2). Purchases per attribution window. purchases / revenue above stay
  -- on each ad set's own attribution setting. attribution_windows NULL = split not ingested.
  w.attribution_windows,
  CAST(w.purchases_7d_click AS INT64) AS purchases_7d_click,
  w.purchase_value_7d_click           AS revenue_7d_click,
  CAST(w.purchases_1d_view AS INT64)  AS purchases_1d_view,
  w.purchase_value_1d_view            AS revenue_1d_view,
  CAST(w.purchases_1d_ev AS INT64)    AS purchases_1d_ev,
  w.purchase_value_1d_ev              AS revenue_1d_ev,
  -- Standard decision basis (owner, D3 as amended 2026-10-05): 7-day click + 1-day view.
  -- 1d_ev is stored above but is not part of the standard basis.
  CAST(w.purchases_7d_click + w.purchases_1d_view AS INT64) AS purchases_7dc_1dv,
  w.purchase_value_7d_click + w.purchase_value_1d_view      AS revenue_7dc_1dv
FROM `oneeighty-warehouse.stg.stg_meta_ad_insights` i
JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
LEFT JOIN `oneeighty-warehouse.stg.stg_meta_ad_attribution_windows` w
  ON w.client_id = i.client_id AND w.ad_id = i.ad_id AND w.date_start = i.date_start
WHERE i.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);
