CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_meta_campaign_perf` AS
SELECT
  i.client_id,
  i.date_start AS date,
  i.campaign_id, i.campaign_name, i.ad_account_id,
  i.spend, i.purchase_value AS revenue, i.purchases, i.impressions, i.clicks, i.reach,
  i.add_to_cart, i.initiate_checkout, i.landing_page_views, i.link_clicks, i.video_views,
  i.frequency     AS frequency_per_day,
  i.ctr           AS ctr_per_day,
  i.cpc           AS cpc_per_day,
  i.purchase_roas AS roas_per_day,
  SAFE_DIVIDE(i.spend, i.purchases)          AS cost_per_purchase_per_day,
  SAFE_DIVIDE(i.purchase_value, i.purchases) AS aov_meta_per_day,
  c.meta_currency AS currency,
  -- additive (PA1) ------------------------------------------------------
  (SELECT CAST(SUM(SAFE_CAST(JSON_VALUE(a, '$.value') AS NUMERIC)) AS INT64)
     FROM UNNEST(JSON_QUERY_ARRAY(SAFE.PARSE_JSON(i.actions))) a
    WHERE JSON_VALUE(a, '$.action_type') = 'omni_view_content')  AS view_content,
  (SELECT CAST(SUM(SAFE_CAST(JSON_VALUE(a, '$.value') AS NUMERIC)) AS INT64)
     FROM UNNEST(JSON_QUERY_ARRAY(SAFE.PARSE_JSON(i.actions))) a
    WHERE JSON_VALUE(a, '$.action_type') = 'add_payment_info')   AS add_payment_info,
  COALESCE(d.funnel_stage, 'unclassified') AS funnel_stage,
  d.market                                 AS market,
  i.spend          * IF(c.meta_currency = c.currency, NUMERIC '1', fx.rate) AS spend_client_ccy,
  i.purchase_value * IF(c.meta_currency = c.currency, NUMERIC '1', fx.rate) AS revenue_client_ccy,
  c.currency AS client_currency
FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` i
JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
LEFT JOIN `oneeighty-warehouse.mart.mart_meta_campaign_dim` d
  ON d.client_id = i.client_id AND d.campaign_id = i.campaign_id
LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
  ON  fx.month_start   = DATE_TRUNC(i.date_start, MONTH)
  AND fx.from_currency = c.meta_currency
  AND fx.to_currency   = c.currency
WHERE i.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);
