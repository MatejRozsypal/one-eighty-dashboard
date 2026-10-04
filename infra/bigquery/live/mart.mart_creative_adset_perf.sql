CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_creative_adset_perf` AS
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
FROM `oneeighty-warehouse.stg.stg_meta_adset_insights` a
JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
WHERE a.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);
