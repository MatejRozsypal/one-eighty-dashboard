CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_flow_perf` AS
WITH latest_ecomail AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, pipeline_id ORDER BY snapshot_date DESC) AS rn
    FROM `oneeighty-warehouse.stg.stg_ecomail_automations`
  ) WHERE rn = 1
),
latest_klaviyo AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, flow_id ORDER BY snapshot_date DESC) AS rn
    FROM `oneeighty-warehouse.stg.stg_klaviyo_flows`
  ) WHERE rn = 1
)
SELECT
  client_id, 'ecomail' AS platform, pipeline_id AS flow_id, name AS flow_name,
  CAST(NULL AS STRING) AS status,
  snapshot_date AS latest_snapshot_date,
  COALESCE(send, inject) AS emails_sent,
  CAST(inject * COALESCE(delivery_rate, 1) AS INT64) AS delivered_approx,
  total_open AS opens, open AS unique_opens, open_rate,
  total_click AS clicks, click AS unique_clicks, click_rate,
  conversions, conversions_value AS revenue,
  SAFE_DIVIDE(open,        CAST(inject * COALESCE(delivery_rate, 1) AS INT64)) * 100 AS open_rate_pct,
  SAFE_DIVIDE(click,       CAST(inject * COALESCE(delivery_rate, 1) AS INT64)) * 100 AS click_rate_pct,
  SAFE_DIVIDE(conversions, CAST(inject * COALESCE(delivery_rate, 1) AS INT64)) * 100 AS conversion_rate_pct,
  'CZK' AS currency
FROM latest_ecomail

UNION ALL

SELECT
  client_id, 'klaviyo' AS platform, flow_id, flow_name, status, snapshot_date AS latest_snapshot_date,
  emails_sent, delivered AS delivered_approx,
  opens, unique_opens, open_rate, clicks, unique_clicks, click_rate,
  conversions, revenue,
  SAFE_DIVIDE(unique_opens,  delivered) * 100  AS open_rate_pct,
  SAFE_DIVIDE(unique_clicks, delivered) * 100  AS click_rate_pct,
  SAFE_DIVIDE(conversions,   delivered) * 100  AS conversion_rate_pct,
  currency
FROM latest_klaviyo;
