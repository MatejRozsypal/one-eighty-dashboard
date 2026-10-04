CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_klaviyo_forms` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, form_id, snapshot_date ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_klaviyo_forms`
  WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;
