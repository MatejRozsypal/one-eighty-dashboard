CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_instagram_account_insights` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, ig_business_id, metric_date, metric_name ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_instagram_account_insights`
  WHERE metric_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;
