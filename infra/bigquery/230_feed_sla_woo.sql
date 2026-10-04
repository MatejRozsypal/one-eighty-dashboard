-- 230_feed_sla_woo.sql
-- Purpose:   make a dead WooCommerce sync visible. ref.feed_sla has no woocommerce
--            rows, so ops.v_feed_health and ops.v_pipeline_alerts say nothing about
--            ethia or rawbark (audit 03 section 4, P0-10).
-- Based on:  live ref.feed_sla (live/ref.feed_sla.sql, snapshot 2026-10-04) and the
--            live hourly scheduled query (live/scheduled_query.refresh_feed_freshness.sql,
--            transfer config 6a928d0e-0000-2e90-a9a8-f4f5e80cace4).
-- Affected clients: ethia, rawbark (the clients with has_woocommerce = TRUE).
-- Regression: no view changes here. The INSERT below is data only. The scheduled
--            query change is in 230b_scheduled_query_feed_freshness.sql.
-- NOT EXECUTED against prod. Needs owner OK.
--
-- !! DEPLOY ORDER MATTERS !!
-- The live scheduled query does NOT know the has_woocommerce flag and has no
-- raw_woo_* branch (checked 2026-10-04: its client_flags CTE lists shopify, shoptet,
-- meta, klaviyo, ecomail, instagram only). Inserting these rows first is harmless
-- (the join on flag_column finds nothing), but nothing is monitored until the
-- scheduled query is updated. So:
--   1. run this file (INSERT, idempotent)
--   2. update the scheduled query text with 230b (console, or bq update --transfer_config)
--   3. after the next hourly run, verify (query at the bottom): 4 woo rows, status ok
--
-- Both raw_woo tables carry ingested_at (TIMESTAMP, NOT NULL) and order_date
-- (partition column), so the scheduled query probe works as written. The n8n
-- workflow runs every 3 hours and always re-fetches the newest order (watermark is
-- MAX(date_modified_gmt) minus 2h), so every run writes at least one row per
-- client: a 12h SLA is 4 missed runs.
--
-- Idempotent: rows are keyed on feed_key and only inserted when missing.

INSERT INTO `oneeighty-warehouse.ref.feed_sla`
  (feed_key, source, flag_column, table_ref, max_staleness_hours, severity, is_active, notes)
SELECT n.feed_key, n.source, n.flag_column, n.table_ref, n.max_staleness_hours, n.severity, n.is_active, n.notes
FROM UNNEST([
  STRUCT(
    'woocommerce_orders' AS feed_key, 'woocommerce' AS source, 'has_woocommerce' AS flag_column,
    'raw.raw_woo_orders' AS table_ref, 12 AS max_staleness_hours, 'critical' AS severity,
    TRUE AS is_active,
    'Revenue-bearing. wf_woocommerce runs every 3 hours. Added 2026-10 (migration 230).' AS notes),
  STRUCT(
    'woocommerce_order_items', 'woocommerce', 'has_woocommerce',
    'raw.raw_woo_order_items', 12, 'critical',
    TRUE,
    'Line items. Written by the same workflow run as the orders. Added 2026-10 (migration 230).')
]) AS n
WHERE NOT EXISTS (
  SELECT 1 FROM `oneeighty-warehouse.ref.feed_sla` s WHERE s.feed_key = n.feed_key
);

-- Verify the rows (expect 2):
--   SELECT * FROM `oneeighty-warehouse.ref.feed_sla` WHERE source = 'woocommerce';
-- Verify after the scheduled query was updated and ran once (expect 4 rows, all ok):
--   SELECT client_id, feed_key, status, staleness_hours, rows_last_24h
--   FROM `oneeighty-warehouse.ops.v_feed_health` WHERE source = 'woocommerce' ORDER BY 1, 2;
