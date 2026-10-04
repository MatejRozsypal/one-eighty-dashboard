-- 233_ops_alerts_fx_gads.sql
-- Purpose:   ops.v_pipeline_alerts gains two alert sources (audit 03 section 4, P1-16, plan W4/W5):
--              1. FX coverage: a row per required currency pair whose newest ref.fx_rates month
--                 is before the current month (the table expires silently every month).
--              2. Google Ads: every ops.v_gads_coverage row whose status is not 'ok'.
--            Woo freshness needs no change here: it arrives through ops.v_feed_health
--            once 230 and 230b are deployed.
-- Based on:  live/ops.v_pipeline_alerts.sql (snapshot 2026-10-04). The two UNION ALL blocks
--            marked [233] are the only change; everything else is byte for byte the live text.
-- Affected clients: none in the data sense. Output only: new rows with client_id '*' (FX) or the
--            client owning the Google Ads account.
-- Regression: the view is a pure monitor with no consumer in the dashboard code (grep of
--            dashboard/app, lib, components, 2026-10-04) and no mart reads it. Tested as
--            mart_qa.wp2_v_pipeline_alerts: all 8 pre-existing alert rows are unchanged, 3 FX
--            rows are added today (USD->CZK, EUR->CZK, CZK->EUR, last month 2026-09), and 0
--            Google Ads rows (both v_gads_coverage rows are ok). After 232 runs the 3 FX rows
--            disappear.
-- NOT EXECUTED against prod. Needs owner OK.
-- Deploy order: 232 first (otherwise the FX alerts fire on day one, which is correct but noisy),
--            230, 230b, then this file. Independent of 231.

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
  -- [233] FX coverage. ref.fx_rates is hand-fed and expires silently: one missing month
  -- disables the currency toggle and NULLs the revenue of every foreign-currency order of
  -- that month. A pair is required when a registry client needs it, plus EUR->CZK for shops
  -- that sell in EUR to a CZK client (RawBark, SK customers), which the registry cannot show.
  UNION ALL
  SELECT '*', 'fx_rates', 'critical', 'fx_missing',
    FORMAT('fx_rates %s->%s has no row for %s (last month with a rate: %s). Refresh per runbook 23',
      r.from_currency, r.to_currency,
      FORMAT_DATE('%Y-%m', DATE_TRUNC(CURRENT_DATE(), MONTH)),
      IFNULL(FORMAT_DATE('%Y-%m', fx.last_month), 'never')),
    NULL, NULL
  FROM (
    SELECT DISTINCT from_currency, to_currency FROM (
      SELECT currency AS from_currency, 'CZK' AS to_currency
      FROM `oneeighty-warehouse.ref.clients` WHERE status = 'active' AND currency != 'CZK'
      UNION ALL
      SELECT meta_currency, currency
      FROM `oneeighty-warehouse.ref.clients`
      WHERE status = 'active' AND meta_currency IS NOT NULL AND meta_currency != currency
      UNION ALL
      SELECT gads_currency, currency
      FROM `oneeighty-warehouse.ref.clients`
      WHERE status = 'active' AND gads_currency IS NOT NULL AND gads_currency != currency
      UNION ALL SELECT 'EUR', 'CZK'
    )
  ) r
  LEFT JOIN (
    SELECT from_currency, to_currency, MAX(month_start) AS last_month
    FROM `oneeighty-warehouse.ref.fx_rates`
    GROUP BY from_currency, to_currency
  ) fx USING (from_currency, to_currency)
  WHERE fx.last_month IS NULL OR fx.last_month < DATE_TRUNC(CURRENT_DATE(), MONTH)
  -- [233] Google Ads coverage. Every v_gads_coverage row that is not ok. The view checks
  -- transfer recency and registry mapping only; it cannot see a single missing day inside the
  -- history (RawBark 2026-09-17), because DTS tables carry no ingested_at.
  UNION ALL
  SELECT COALESCE(g.client_id, '*'), 'google_ads',
    IF(g.status LIKE 'STALE%' OR g.status LIKE 'CLIENT_WITHOUT_ACCOUNT%', 'critical', 'warning'),
    LOWER(REGEXP_EXTRACT(g.status, r'^[A-Z_]+')),
    FORMAT('google_ads/%s: %s', COALESCE(g.client_id, CAST(g.customer_id AS STRING)), g.status),
    IF(g.days_since_transfer IS NULL, NULL, g.days_since_transfer * 24.0),
    TIMESTAMP(g.last_transfer_date)
  FROM `oneeighty-warehouse.ops.v_gads_coverage` g
  WHERE g.status != 'ok'
)
SELECT * FROM alerts
ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END,
         CASE status WHEN 'never' THEN 0 WHEN 'monitor_down' THEN 0 ELSE 1 END,
         staleness_hours DESC;
