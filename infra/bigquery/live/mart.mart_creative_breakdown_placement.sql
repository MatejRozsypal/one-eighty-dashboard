CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_creative_breakdown_placement` AS
SELECT client_id, date_start AS date, ad_id,
       publisher_platform, platform_position, impression_device,
       spend, impressions, reach, clicks, purchases, purchase_value AS revenue
FROM `oneeighty-warehouse.stg.stg_meta_ad_breakdown_placement`
WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);
