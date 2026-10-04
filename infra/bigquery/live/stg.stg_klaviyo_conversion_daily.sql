CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_klaviyo_conversion_daily` AS
SELECT * EXCEPT(rn) FROM (
  SELECT client_id, metric_date, dim_type, dim_value, conversion_value, conversions,
    ROW_NUMBER() OVER (PARTITION BY client_id, metric_date, dim_type, dim_value ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_klaviyo_conversion_daily`
  WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;
