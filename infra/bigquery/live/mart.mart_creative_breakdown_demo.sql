CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_creative_breakdown_demo` AS
SELECT client_id, date_start AS date, ad_id, age, gender,
       spend, impressions, reach, clicks, purchases, purchase_value AS revenue
FROM `oneeighty-warehouse.stg.stg_meta_ad_breakdown_demo`
WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);
