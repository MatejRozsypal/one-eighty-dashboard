CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_instagram_media` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, media_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_instagram_media`
  WHERE DATE(posted_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;
