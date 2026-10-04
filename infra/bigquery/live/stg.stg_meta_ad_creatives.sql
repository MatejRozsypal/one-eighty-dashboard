CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_meta_ad_creatives` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, ad_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_meta_ad_creatives`
  WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;
