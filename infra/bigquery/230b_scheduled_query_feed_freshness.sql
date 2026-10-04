-- 230b_scheduled_query_feed_freshness.sql
-- Purpose:   the hourly scheduled query that fills ops.feed_freshness, with the two WooCommerce
--            additions (flag branch has_woocommerce, actual branches for raw_woo_orders and
--            raw_woo_order_items). Everything else is byte for byte the live text.
-- Based on:  live/scheduled_query.refresh_feed_freshness.sql (snapshot 2026-10-04), BigQuery
--            scheduled query (transfer config 6a928d0e-0000-2e90-a9a8-f4f5e80cace4, hourly, runs as
--            sa-n8n-writer). The only differences from the live file are 3 added lines: 1 line
--            after 'has_instagram' in client_flags and 2 lines after 'instagram_media' in actual.
-- Affected clients: ethia, rawbark (new rows in ops.feed_freshness). All other clients unchanged.
-- NOT EXECUTED. Deploy: paste into the scheduled query (console: BigQuery > Scheduled queries,
--            or bq update --transfer_config --params='{"query": ...}'), AFTER 230_feed_sla_woo.sql.
--            Do not change its schedule.
-- Test result 2026-10-04 (read-only, SELECT form with the 230 rows unioned into feed_sla): see
--            the WP2 report; ethia and rawbark each produce woocommerce_orders and
--            woocommerce_order_items rows with status ok.

INSERT INTO `oneeighty-warehouse.ops.feed_freshness`
  (checked_at, client_id, feed_key, source, table_ref, last_ingested_at, staleness_hours, max_staleness_hours, severity, status, rows_last_24h)
WITH client_flags AS (
  SELECT client_id, 'has_shopify' AS flag_column FROM `oneeighty-warehouse.ref.clients` WHERE status='active' AND has_shopify
  UNION ALL SELECT client_id,'has_shoptet' FROM `oneeighty-warehouse.ref.clients` WHERE status='active' AND has_shoptet
  UNION ALL SELECT client_id,'has_meta' FROM `oneeighty-warehouse.ref.clients` WHERE status='active' AND has_meta
  UNION ALL SELECT client_id,'has_klaviyo' FROM `oneeighty-warehouse.ref.clients` WHERE status='active' AND has_klaviyo
  UNION ALL SELECT client_id,'has_ecomail' FROM `oneeighty-warehouse.ref.clients` WHERE status='active' AND has_ecomail
  UNION ALL SELECT client_id,'has_instagram' FROM `oneeighty-warehouse.ref.clients` WHERE status='active' AND has_instagram
  UNION ALL SELECT client_id,'has_woocommerce' FROM `oneeighty-warehouse.ref.clients` WHERE status='active' AND has_woocommerce
),
expected AS (
  SELECT f.client_id, s.feed_key, s.source, s.table_ref,
         COALESCE(o.max_staleness_hours, s.max_staleness_hours) AS max_staleness_hours, s.severity
  FROM client_flags f
  JOIN `oneeighty-warehouse.ref.feed_sla` s ON s.flag_column = f.flag_column
  LEFT JOIN `oneeighty-warehouse.ref.feed_sla_override` o ON o.client_id=f.client_id AND o.feed_key=s.feed_key
  WHERE s.is_active
),
actual AS (
  SELECT 'shopify_orders' AS feed_key, client_id, MAX(ingested_at) AS last_ingested_at, COUNTIF(ingested_at>=TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 24 HOUR)) AS rows_last_24h FROM `oneeighty-warehouse.raw.raw_shopify_orders` WHERE order_date>=DATE_SUB(CURRENT_DATE(),INTERVAL 36 MONTH) GROUP BY client_id
  UNION ALL SELECT 'shopify_products', client_id, MAX(ingested_at), COUNTIF(ingested_at>=TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 24 HOUR)) FROM `oneeighty-warehouse.raw.raw_shopify_products` WHERE DATE(ingested_at)>=DATE_SUB(CURRENT_DATE(),INTERVAL 36 MONTH) GROUP BY client_id
  UNION ALL SELECT 'shopify_customers', client_id, MAX(ingested_at), COUNTIF(ingested_at>=TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 24 HOUR)) FROM `oneeighty-warehouse.raw.raw_shopify_customers` WHERE DATE(ingested_at)>=DATE_SUB(CURRENT_DATE(),INTERVAL 36 MONTH) GROUP BY client_id
  UNION ALL SELECT 'shoptet_orders', client_id, MAX(ingested_at), COUNTIF(ingested_at>=TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 24 HOUR)) FROM `oneeighty-warehouse.raw.raw_shoptet_orders` WHERE orderDate>=DATE_SUB(CURRENT_DATE(),INTERVAL 36 MONTH) GROUP BY client_id
  UNION ALL SELECT 'shoptet_order_items', client_id, MAX(ingested_at), COUNTIF(ingested_at>=TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 24 HOUR)) FROM `oneeighty-warehouse.raw.raw_shoptet_order_items` WHERE orderDate>=DATE_SUB(CURRENT_DATE(),INTERVAL 36 MONTH) GROUP BY client_id
  UNION ALL SELECT 'meta_ad_insights', client_id, MAX(ingested_at), COUNTIF(ingested_at>=TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 24 HOUR)) FROM `oneeighty-warehouse.raw.raw_meta_ad_insights` WHERE date_start>=DATE_SUB(CURRENT_DATE(),INTERVAL 36 MONTH) GROUP BY client_id
  UNION ALL SELECT 'meta_campaign_insights', client_id, MAX(ingested_at), COUNTIF(ingested_at>=TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 24 HOUR)) FROM `oneeighty-warehouse.raw.raw_meta_campaign_insights` WHERE date_start>=DATE_SUB(CURRENT_DATE(),INTERVAL 36 MONTH) GROUP BY client_id
  UNION ALL SELECT 'klaviyo_campaigns', client_id, MAX(ingested_at), COUNTIF(ingested_at>=TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 24 HOUR)) FROM `oneeighty-warehouse.raw.raw_klaviyo_campaigns` WHERE send_time>=TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 1095 DAY) GROUP BY client_id
  UNION ALL SELECT 'klaviyo_flow_series', client_id, MAX(ingested_at), COUNTIF(ingested_at>=TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 24 HOUR)) FROM `oneeighty-warehouse.raw.raw_klaviyo_flow_series` WHERE DATE(ingested_at)>=DATE_SUB(CURRENT_DATE(),INTERVAL 36 MONTH) GROUP BY client_id
  UNION ALL SELECT 'klaviyo_conversion_daily', client_id, MAX(ingested_at), COUNTIF(ingested_at>=TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 24 HOUR)) FROM `oneeighty-warehouse.raw.raw_klaviyo_conversion_daily` WHERE DATE(ingested_at)>=DATE_SUB(CURRENT_DATE(),INTERVAL 36 MONTH) GROUP BY client_id
  UNION ALL SELECT 'ecomail_campaigns', client_id, MAX(ingested_at), COUNTIF(ingested_at>=TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 24 HOUR)) FROM `oneeighty-warehouse.raw.raw_ecomail_campaigns` WHERE sent_at>=TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 1095 DAY) GROUP BY client_id
  UNION ALL SELECT 'instagram_media', client_id, MAX(ingested_at), COUNTIF(ingested_at>=TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 24 HOUR)) FROM `oneeighty-warehouse.raw.raw_instagram_media` WHERE posted_at>=TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 1095 DAY) GROUP BY client_id
  UNION ALL SELECT 'woocommerce_orders', client_id, MAX(ingested_at), COUNTIF(ingested_at>=TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 24 HOUR)) FROM `oneeighty-warehouse.raw.raw_woo_orders` WHERE order_date>=DATE_SUB(CURRENT_DATE(),INTERVAL 36 MONTH) GROUP BY client_id
  UNION ALL SELECT 'woocommerce_order_items', client_id, MAX(ingested_at), COUNTIF(ingested_at>=TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 24 HOUR)) FROM `oneeighty-warehouse.raw.raw_woo_order_items` WHERE order_date>=DATE_SUB(CURRENT_DATE(),INTERVAL 36 MONTH) GROUP BY client_id
)
SELECT CURRENT_TIMESTAMP(), e.client_id, e.feed_key, e.source, e.table_ref, a.last_ingested_at,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), a.last_ingested_at, MINUTE)/60.0,
  e.max_staleness_hours, e.severity,
  CASE WHEN a.last_ingested_at IS NULL THEN 'never'
       WHEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), a.last_ingested_at, MINUTE)/60.0 > e.max_staleness_hours THEN 'stale'
       ELSE 'ok' END,
  IFNULL(a.rows_last_24h, 0)
FROM expected e
LEFT JOIN actual a ON a.feed_key=e.feed_key AND a.client_id=e.client_id
