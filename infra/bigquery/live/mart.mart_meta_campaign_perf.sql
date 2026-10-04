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
  c.meta_currency AS currency
FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` i
JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
WHERE i.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);
