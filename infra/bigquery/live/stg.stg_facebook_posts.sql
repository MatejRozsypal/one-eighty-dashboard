CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_facebook_posts` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, post_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_facebook_posts`
  WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;
