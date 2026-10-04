-- qa/243_checks.sql
-- Verification for 243_ga4_sessions.sql. Run after the first backfill and again after any change
-- to the procedure or the registry. Every check is an independent query. Written against PROD
-- names; to run against the mart_qa test copy, substitute with
--   perl -pe 's/\.ref\.ga4_properties`/.mart_qa.pa3_ga4_properties`/g; s/\.stg\.ga4_sessions`/.mart_qa.pa3_ga4_sessions`/g; s/\.ops\.sp_load_ga4_sessions`/.mart_qa.pa3_sp_load_ga4_sessions`/g; s/\.mart\.mart_ga4_sessions_daily`/.mart_qa.pa3_mart_ga4_sessions_daily`/g'
-- (runbooks/30_ga4_sessions.md has the same line).
--
-- Window: the last 7 complete days. A property can be a day behind (dobias was on 2026-10-04),
-- so every per-day check only looks at days the property actually has. Expected results are in
-- the comment above each query. No em dash, no PII.

-- =============================================================================
-- CHECK 0. Freshness. Expect: days_behind <= 3 for every property that should be live.
-- venev is stalled by design (days_behind large) until its export resumes.
-- =============================================================================
SELECT
  client_id,
  MAX(date) AS last_date,
  DATE_DIFF(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MAX(date), DAY) AS days_behind,
  IF(DATE_DIFF(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MAX(date), DAY) <= 3, 'ok', 'STALE') AS status
FROM `oneeighty-warehouse.stg.ga4_sessions`
WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
GROUP BY client_id
ORDER BY client_id;

-- =============================================================================
-- CHECK 1. Tracking coverage: GA4 purchase revenue vs shop revenue, per day.
-- Both in client currency. Shop side is mart_daily_kpis:
--   revenue            Shopify subtotal + shipping (no tax), Shoptet total with VAT
--   gross_revenue_incl_tax  total with tax
-- GA4 purchase_revenue is the checkout value (usually with tax and shipping), so coverage_gross
-- is the like-for-like ratio for Shopify, coverage_net for Shoptet. Order coverage is the cleanest
-- signal: ga4_purchases / shop_orders. Healthy is roughly 0.7 to 1.05. Far below 1 means consent
-- loss or a broken purchase tag, far above 1 means duplicate purchase events.
-- unattributed_revenue is GA4 revenue that arrived without a session id (consent mode): real
-- revenue that cannot be given a channel.
-- =============================================================================
WITH g AS (
  SELECT client_id, date,
         SUM(purchases) AS ga4_purchases,
         SUM(revenue)   AS ga4_revenue,
         SUM(IF(platform = 'unattributed', revenue, 0)) AS unattributed_revenue,
         SUM(sessions_fx_missing) AS sessions_fx_missing
  FROM `oneeighty-warehouse.mart.mart_ga4_sessions_daily`
  WHERE date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
  GROUP BY client_id, date
),
k AS (
  SELECT client_id, date, SUM(revenue) AS shop_revenue, SUM(gross_revenue_incl_tax) AS shop_gross, SUM(orders) AS shop_orders
  FROM `oneeighty-warehouse.mart.mart_daily_kpis`
  WHERE date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
  GROUP BY client_id, date
)
SELECT
  g.client_id, g.date,
  g.ga4_purchases, k.shop_orders,
  ROUND(SAFE_DIVIDE(g.ga4_purchases, k.shop_orders), 2)  AS coverage_orders,
  ROUND(g.ga4_revenue, 0) AS ga4_revenue, ROUND(k.shop_revenue, 0) AS shop_revenue, ROUND(k.shop_gross, 0) AS shop_gross,
  ROUND(SAFE_DIVIDE(g.ga4_revenue, k.shop_revenue), 2)   AS coverage_net,
  ROUND(SAFE_DIVIDE(g.ga4_revenue, k.shop_gross), 2)     AS coverage_gross,
  ROUND(g.unattributed_revenue, 0) AS unattributed_revenue,
  ROUND(SAFE_DIVIDE(g.unattributed_revenue, g.ga4_revenue), 2) AS unattributed_share,
  g.sessions_fx_missing
FROM g LEFT JOIN k USING (client_id, date)
ORDER BY g.client_id, g.date;

-- =============================================================================
-- CHECK 2a. Platform classification share per client over the window.
-- Expect: meta and google present where the client advertises, non_paid the largest session
-- share, and 'unattributed' carrying revenue but zero sessions.
-- =============================================================================
SELECT
  client_id, platform,
  SUM(sessions) AS sessions,
  ROUND(SAFE_DIVIDE(SUM(sessions), SUM(SUM(sessions)) OVER (PARTITION BY client_id)), 3) AS share_sessions,
  SUM(purchases) AS purchases,
  ROUND(SUM(revenue), 0) AS revenue,
  ROUND(SAFE_DIVIDE(SUM(revenue), SUM(SUM(revenue)) OVER (PARTITION BY client_id)), 3) AS share_revenue
FROM `oneeighty-warehouse.mart.mart_ga4_sessions_daily`
WHERE date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
GROUP BY client_id, platform
ORDER BY client_id, sessions DESC;

-- CHECK 2b. Rule leaks. Expect 0 rows for the first two branches.
--   paid_group_but_non_paid   a paid channel group that fell through to non_paid (rule gap)
--   unattributed_with_sessions  the no-session bucket must never carry sessions
-- The third branch is informational: Meta ads that GA4 files as organic because the UTM is
-- missing or swapped. A large count here means Meta traffic is under-tagged, not that the
-- classifier is wrong.
WITH w AS (
  SELECT * FROM `oneeighty-warehouse.mart.mart_ga4_sessions_daily`
  WHERE date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
)
SELECT 'paid_group_but_non_paid' AS issue, client_id, channel_group, source, medium, SUM(sessions) AS sessions
FROM w
WHERE platform = 'non_paid'
  AND channel_group IN ('Paid Search', 'Paid Social', 'Paid Shopping', 'Paid Video', 'Paid Other', 'Display', 'Cross-network')
GROUP BY ALL
UNION ALL
SELECT 'unattributed_with_sessions', client_id, channel_group, source, medium, SUM(sessions)
FROM w WHERE platform = 'unattributed' AND sessions > 0 GROUP BY ALL
UNION ALL
SELECT 'info_meta_looking_but_non_paid', client_id, channel_group, source, medium, SUM(sessions)
FROM w
WHERE platform = 'non_paid'
  AND REGEXP_CONTAINS(LOWER(IFNULL(source, '')), r'(facebook|instagram|(^|[^a-z])(fb|ig)([^a-z]|$))')
GROUP BY ALL
HAVING SUM(sessions) >= 20
ORDER BY issue, sessions DESC;

-- =============================================================================
-- CHECK 3a. Session counts against the canonical GA4 recipe, straight from the export.
-- Canonical = COUNT(DISTINCT user_pseudo_id, ga_session_id) per event_date, same hostname filter.
-- Expect: table_sessions <= canonical_sessions, difference under 2 percent per day (a session
-- that spans midnight is counted on both days by the canonical recipe, once by the table).
-- Add one UNION branch per property when a property is added.
-- =============================================================================
WITH canon AS (
  SELECT 'dobias' AS client_id, PARSE_DATE('%Y%m%d', event_date) AS date,
         COUNT(DISTINCT IF((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') IS NOT NULL,
                           CONCAT(user_pseudo_id, '|', CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)), NULL)) AS canonical_sessions,
         COUNTIF(event_name = 'session_start') AS session_start_events,
         COUNTIF(event_name = 'session_start' AND (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') IS NULL) AS cookieless_session_starts
  FROM `oneeighty-warehouse.analytics_314809580.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)) AND FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY))
    AND REGEXP_CONTAINS(IFNULL(device.web_info.hostname, ''), r'peterdobias\.com')
  GROUP BY date
  UNION ALL
  SELECT 'manami' AS client_id, PARSE_DATE('%Y%m%d', event_date) AS date,
         COUNT(DISTINCT IF((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') IS NOT NULL,
                           CONCAT(user_pseudo_id, '|', CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)), NULL)),
         COUNTIF(event_name = 'session_start'),
         COUNTIF(event_name = 'session_start' AND (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') IS NULL)
  FROM `oneeighty-warehouse.analytics_343337695.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)) AND FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY))
    AND REGEXP_CONTAINS(IFNULL(device.web_info.hostname, ''), r'eshop\.manami\.cz')
  GROUP BY date
),
tbl AS (
  SELECT client_id, date, COUNTIF(session_kind = 'session') AS table_sessions
  FROM `oneeighty-warehouse.stg.ga4_sessions`
  WHERE date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
  GROUP BY client_id, date
)
SELECT
  c.client_id, c.date, t.table_sessions, c.canonical_sessions,
  ROUND(SAFE_DIVIDE(c.canonical_sessions - t.table_sessions, c.canonical_sessions), 4) AS diff_share,
  c.session_start_events,
  ROUND(SAFE_DIVIDE(c.cookieless_session_starts, c.session_start_events), 2) AS cookieless_share,
  IF(t.table_sessions <= c.canonical_sessions
     AND SAFE_DIVIDE(c.canonical_sessions - t.table_sessions, c.canonical_sessions) < 0.02, 'ok', 'CHECK') AS status
FROM canon c LEFT JOIN tbl t USING (client_id, date)
ORDER BY c.client_id, c.date;

-- CHECK 3b. Magnitude against the GA4 UI (manual, owner step).
-- Open GA4 > Reports > Acquisition > Traffic acquisition for the property, same dates, metric
-- Sessions, then compare with this. Expect the table to be at or below the UI: the UI adds
-- modelled sessions for consent-denied users, the export does not contain them (manami shows a
-- cookieless_share of about 0.8 above). Large gaps on a property with cookieless_share near 0
-- are a real problem.
SELECT client_id, date, SUM(sessions) AS sessions, SUM(IF(platform != 'non_paid', sessions, 0)) AS paid_sessions
FROM `oneeighty-warehouse.mart.mart_ga4_sessions_daily`
WHERE date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
GROUP BY client_id, date
ORDER BY client_id, date;

-- =============================================================================
-- CHECK 4. Determinism: reloading the same window gives identical rows.
-- Fingerprints every row except loaded_at, per client and day, before and after a reload.
-- Run as one script. Expect: zero rows from the final SELECT for days older than 3 days.
-- The newest 2 to 3 days may differ if GA4 revised the export between the two runs, which is
-- why the scheduled query reloads 3 days. WRITES to stg.ga4_sessions (idempotent).
-- =============================================================================
CREATE TEMP TABLE fp_before AS
WITH x AS (
  SELECT * EXCEPT (loaded_at) FROM `oneeighty-warehouse.stg.ga4_sessions`
  WHERE date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
)
SELECT client_id, date, COUNT(*) AS n, BIT_XOR(FARM_FINGERPRINT(TO_JSON_STRING(x))) AS fp FROM x GROUP BY client_id, date;

CALL `oneeighty-warehouse.ops.sp_load_ga4_sessions`(7);

CREATE TEMP TABLE fp_after AS
WITH x AS (
  SELECT * EXCEPT (loaded_at) FROM `oneeighty-warehouse.stg.ga4_sessions`
  WHERE date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
)
SELECT client_id, date, COUNT(*) AS n, BIT_XOR(FARM_FINGERPRINT(TO_JSON_STRING(x))) AS fp FROM x GROUP BY client_id, date;

SELECT
  COALESCE(b.client_id, a.client_id) AS client_id, COALESCE(b.date, a.date) AS date,
  b.n AS rows_before, a.n AS rows_after, b.fp = a.fp AS identical,
  IF(COALESCE(b.date, a.date) < DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY), 'MUST be identical', 'may differ if GA4 revised') AS note
FROM fp_before b FULL OUTER JOIN fp_after a ON a.client_id = b.client_id AND a.date = b.date
WHERE b.fp IS DISTINCT FROM a.fp OR b.n IS DISTINCT FROM a.n
ORDER BY 1, 2;

-- =============================================================================
-- CHECK 5. Table integrity. Every row must satisfy its rule, expect failed = 0 on each line.
-- =============================================================================
WITH t AS (
  SELECT * FROM `oneeighty-warehouse.stg.ga4_sessions`
  WHERE date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
)
SELECT 'duplicate (property, session_key)' AS rule,
       (SELECT COUNT(*) FROM (SELECT property_id, session_key FROM t GROUP BY 1, 2 HAVING COUNT(*) > 1)) AS failed
UNION ALL SELECT 'platform outside the allowed set', COUNTIF(platform NOT IN ('meta', 'google', 'other_paid', 'non_paid', 'unattributed')) FROM t
UNION ALL SELECT 'session without channel_group', COUNTIF(session_kind = 'session' AND channel_group IS NULL) FROM t
UNION ALL SELECT 'purchase without currency', COUNTIF(purchases > 0 AND currency IS NULL) FROM t
UNION ALL SELECT 'purchase without revenue', COUNTIF(purchases > 0 AND revenue IS NULL) FROM t
UNION ALL SELECT 'negative revenue or purchases', COUNTIF(revenue < 0 OR purchases < 0) FROM t
UNION ALL SELECT 'no-session row carrying a session flag', COUNTIF(session_kind = 'purchase_no_session' AND (has_view_item OR has_add_to_cart OR has_begin_checkout OR engaged IS NOT NULL)) FROM t
UNION ALL SELECT 'session with null landing_path', COUNTIF(session_kind = 'session' AND landing_path IS NULL) FROM t;

-- CHECK 5b. Purchases reconcile to the export: distinct transaction ids in GA4 equal the table.
-- Expect diff = 0 per client over the whole window (day edges can move a purchase by one day, so
-- this compares totals).
WITH raw AS (
  SELECT 'dobias' AS client_id, COUNT(DISTINCT COALESCE(NULLIF(ecommerce.transaction_id, '(not set)'), CONCAT(user_pseudo_id, '|', CAST(event_timestamp AS STRING)))) AS raw_purchases
  FROM `oneeighty-warehouse.analytics_314809580.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)) AND FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY))
    AND event_name = 'purchase' AND REGEXP_CONTAINS(IFNULL(device.web_info.hostname, ''), r'peterdobias\.com')
  UNION ALL
  SELECT 'manami', COUNT(DISTINCT COALESCE(NULLIF(ecommerce.transaction_id, '(not set)'), CONCAT(user_pseudo_id, '|', CAST(event_timestamp AS STRING))))
  FROM `oneeighty-warehouse.analytics_343337695.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)) AND FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY))
    AND event_name = 'purchase' AND REGEXP_CONTAINS(IFNULL(device.web_info.hostname, ''), r'eshop\.manami\.cz')
),
tbl AS (
  SELECT client_id, SUM(purchases) AS table_purchases
  FROM `oneeighty-warehouse.stg.ga4_sessions`
  WHERE date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
  GROUP BY client_id
)
SELECT r.client_id, r.raw_purchases, t.table_purchases, t.table_purchases - r.raw_purchases AS diff
FROM raw r LEFT JOIN tbl t USING (client_id)
ORDER BY r.client_id;

-- =============================================================================
-- CHECK 6. Currency conversion in the mart view, per client and purchase currency.
-- Expect: client_revenue is non-null for every row, implied_rate is 1 for the client's own
-- currency, the GA4 USD value ratio for USD clients, and the ref.fx_rates rate otherwise.
-- fx_missing > 0 means ref.fx_rates lacks that month (runbook 23): revenue for those sessions is
-- NULL and sessions_fx_missing tells the dashboard how many sessions were left out.
-- =============================================================================
SELECT
  t.client_id, t.currency AS purchase_currency, c.currency AS client_currency,
  COUNT(*) AS purchase_rows,
  ROUND(SUM(t.revenue), 2) AS native_revenue,
  ROUND(SUM(CASE WHEN t.currency = c.currency THEN t.revenue WHEN c.currency = 'USD' THEN t.revenue_usd ELSE t.revenue * fx.rate END), 2) AS client_revenue,
  ROUND(SAFE_DIVIDE(SUM(CASE WHEN t.currency = c.currency THEN t.revenue WHEN c.currency = 'USD' THEN t.revenue_usd ELSE t.revenue * fx.rate END), SUM(t.revenue)), 4) AS implied_rate,
  COUNTIF(t.currency != c.currency AND c.currency != 'USD' AND fx.rate IS NULL) AS fx_missing
FROM `oneeighty-warehouse.stg.ga4_sessions` t
JOIN `oneeighty-warehouse.ref.clients` c ON c.client_id = t.client_id
LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
  ON fx.month_start = DATE_TRUNC(t.date, MONTH) AND fx.from_currency = t.currency AND fx.to_currency = c.currency
WHERE t.date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
  AND t.purchases > 0
GROUP BY ALL
ORDER BY 1, 2;
