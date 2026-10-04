CREATE OR REPLACE VIEW `oneeighty-warehouse.ops.v_pipeline_alerts` AS
WITH alerts AS (
  SELECT client_id, feed_key, severity, status,
    CASE WHEN status = 'never'
         THEN FORMAT('%s/%s has NEVER received data', feed_key, client_id)
         ELSE FORMAT('%s/%s is %.1fh stale (SLA %dh, last row %s)', feed_key, client_id,
                     staleness_hours, max_staleness_hours,
                     FORMAT_TIMESTAMP('%Y-%m-%d %H:%M', last_ingested_at)) END AS message,
    staleness_hours, last_ingested_at
  FROM `oneeighty-warehouse.ops.v_feed_health`
  WHERE status IN ('stale', 'never')
  UNION ALL
  SELECT '*', 'monitor', 'critical', 'monitor_down',
    FORMAT('Freshness monitor has not run since %s - every other row in this view is unreliable',
      IFNULL(FORMAT_TIMESTAMP('%Y-%m-%d %H:%M',
        (SELECT MAX(checked_at) FROM `oneeighty-warehouse.ops.feed_freshness`
         WHERE DATE(checked_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))), 'never')),
    NULL, NULL
  FROM (SELECT 1)
  WHERE NOT EXISTS (
    SELECT 1 FROM `oneeighty-warehouse.ops.feed_freshness`
    WHERE DATE(checked_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
      AND checked_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 26 HOUR))
)
SELECT * FROM alerts
ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END,
         CASE status WHEN 'never' THEN 0 WHEN 'monitor_down' THEN 0 ELSE 1 END,
         staleness_hours DESC;
