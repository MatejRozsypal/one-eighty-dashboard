CREATE OR REPLACE VIEW `oneeighty-warehouse.ops.v_feed_health` AS
WITH latest AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, feed_key ORDER BY checked_at DESC) AS rn
  FROM `oneeighty-warehouse.ops.feed_freshness`
  WHERE DATE(checked_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY)
)
SELECT client_id, feed_key, source, table_ref, status, severity, last_ingested_at,
       ROUND(staleness_hours, 1) AS staleness_hours, max_staleness_hours, rows_last_24h, checked_at
FROM latest WHERE rn = 1;
