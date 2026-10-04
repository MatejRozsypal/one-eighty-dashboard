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
