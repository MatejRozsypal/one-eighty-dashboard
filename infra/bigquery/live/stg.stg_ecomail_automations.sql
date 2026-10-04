CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_ecomail_automations` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, pipeline_id, snapshot_date ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_ecomail_automations`
  WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;
