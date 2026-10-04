CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_meta_adset_insights` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, adset_id, date_start ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_meta_adset_insights`
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;
