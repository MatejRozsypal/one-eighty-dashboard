-- 243_ga4_sessions.sql
-- Paid redesign, package PA3 (spec WP-A3): GA4 sessions in the warehouse.
--
-- Purpose
--   GA4 exports raw events into one `analytics_<property>` dataset per property.
--   The dashboard cannot read those directly (frontend SA reads `mart` only, and
--   events_* is far too heavy per page view). This file builds a small derived
--   session table, a procedure that refreshes it, and the mart view the Paid
--   page reads (Overview "GA4" columns, the whole /paid/ga4 tab).
--
-- Objects (prod names)
--   1. ref.ga4_properties                 registry: which GA4 property belongs to which client
--   2. stg.ga4_sessions                   DERIVED table, one row per session, partition date, cluster client_id
--   3. ops.sp_load_ga4_sessions_for       loads one client (or all) for a date range, delete + insert
--   4. ops.sp_load_ga4_sessions           CALL (days): the daily entry point, loops all properties
--   5. mart.mart_ga4_sessions_daily       view the dashboard reads, client currency
--
-- Live objects this was built against (checked 2026-10-04)
--   analytics_314809580 (dobias), analytics_343337695 (manami): daily export since 2026-08-03.
--   analytics_324879665 (venev): 4 days in August, stalled.
--   mart.mart_daily_kpis live definition (FX pattern copied for the revenue conversion).
--   No existing object is changed. Nothing here touches ref.clients (has_ga4 is another package).
--
-- Affected clients: dobias, manami (loaded), venev (registered, stalled, loads nothing).
-- Regression: none needed, only new objects. Verification: infra/bigquery/qa/243_checks.sql.
--
-- Deploy order (not executed yet; owner approves first)
--   1. this file, top to bottom (it is idempotent: CREATE IF NOT EXISTS / OR REPLACE / MERGE seed)
--   2. runbooks/30_ga4_sessions.md: permissions, backfill CALL, scheduled query
--   3. qa/243_checks.sql
--
-- GA4 facts this relies on (verified read-only against the three exports)
--   * session_traffic_source_last_click.cross_channel_campaign has default_channel_group,
--     source, medium, campaign_id, campaign_name. google_ads_campaign has customer_id and
--     campaign_id. Both are populated on every event that carries ga_session_id.
--   * ecommerce.transaction_id, ecommerce.purchase_revenue (event currency) and
--     ecommerce.purchase_revenue_in_usd exist. The event currency is the `currency` event
--     param. dobias purchases arrive in USD, CAD and GBP, manami in CZK and EUR, venev in EUR.
--   * device.web_info.hostname: peterdobias.com (+ account.peterdobias.com), eshop.manami.cz,
--     venev.eu / venev.cz (+ venevcz.myshopify.com which is deliberately not matched).
--   * CONSENT MODE: on manami roughly 80 % of session_start events and about a third of the
--     purchase revenue arrive WITHOUT ga_session_id (cookieless pings, a random
--     user_pseudo_id per event, no session channel). They cannot be turned into sessions.
--     Sessions therefore only count events that carry ga_session_id, and a purchase without a
--     session becomes its own row (session_kind = 'purchase_no_session', platform =
--     'unattributed') so that all-channel revenue and tracking coverage stay honest.

-- =============================================================================
-- 1. ref.ga4_properties
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.ga4_properties` (
  client_id        STRING    NOT NULL,
  property_id      STRING    NOT NULL,
  dataset_id       STRING    NOT NULL,  -- BigQuery export dataset, analytics_<property_id>
  hostname_pattern STRING,              -- RE2, unanchored, matched on device.web_info.hostname. NULL = no filter
  is_primary       BOOL      NOT NULL,
  valid_from       DATE,                -- first day to load (NULL = no lower bound)
  valid_to         DATE,                -- last day to load (NULL = open ended)
  note             STRING,
  updated_at       TIMESTAMP NOT NULL
)
CLUSTER BY client_id
OPTIONS (description = "GA4 BigQuery export registry. One row per property. Read by ops.sp_load_ga4_sessions. To add a property see runbooks/30_ga4_sessions.md.");

MERGE `oneeighty-warehouse.ref.ga4_properties` T
USING (
  SELECT 'dobias' AS client_id, '314809580' AS property_id, 'analytics_314809580' AS dataset_id,
         r'peterdobias\.com' AS hostname_pattern, TRUE AS is_primary,
         DATE '2026-08-03' AS valid_from, CAST(NULL AS DATE) AS valid_to,
         'Shop on peterdobias.com, checkout and account subdomain included by the unanchored pattern.' AS note
  UNION ALL
  SELECT 'manami', '343337695', 'analytics_343337695',
         r'eshop\.manami\.cz', TRUE, DATE '2026-08-03', CAST(NULL AS DATE),
         'Consent mode: most sessions are cookieless and carry no ga_session_id. See header of 243_ga4_sessions.sql.'
  UNION ALL
  SELECT 'venev', '324879665', 'analytics_324879665',
         r'venev\.(eu|cz)', TRUE, DATE '2026-08-04', CAST(NULL AS DATE),
         'Export stalled after 2026-08-19 (4 daily tables only). Loads nothing until the export resumes.'
) S
ON T.client_id = S.client_id AND T.property_id = S.property_id
WHEN NOT MATCHED THEN INSERT
  (client_id, property_id, dataset_id, hostname_pattern, is_primary, valid_from, valid_to, note, updated_at)
  VALUES (S.client_id, S.property_id, S.dataset_id, S.hostname_pattern, S.is_primary,
          S.valid_from, S.valid_to, S.note, CURRENT_TIMESTAMP());

-- =============================================================================
-- 2. stg.ga4_sessions (derived, written only by the procedures below)
-- =============================================================================
-- No PII: session_key is FARM_FINGERPRINT(property | user_pseudo_id | ga_session_id), the raw
-- ids are never stored. Money is in the PURCHASE event currency (`currency`) plus GA4's own
-- USD value. Conversion to client currency happens in the mart view.
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.stg.ga4_sessions` (
  client_id           STRING    NOT NULL,
  property_id         STRING    NOT NULL,
  date                DATE      NOT NULL,   -- property reporting day of the session's first event
  session_key         INT64     NOT NULL,
  session_kind        STRING    NOT NULL,   -- 'session' | 'purchase_no_session'
  session_start_ts    TIMESTAMP,
  channel_group       STRING,               -- session_traffic_source_last_click default_channel_group
  source              STRING,
  medium              STRING,
  campaign_name       STRING,
  campaign_id         STRING,               -- cross_channel_campaign.campaign_id (utm_id)
  gads_customer_id    STRING,
  gads_campaign_id    STRING,
  platform            STRING    NOT NULL,   -- 'meta' | 'google' | 'other_paid' | 'non_paid' | 'unattributed'
  landing_path        STRING,               -- path of the entrance page_view, query string stripped
  device              STRING,
  country             STRING,
  engaged             BOOL,
  has_view_item       BOOL,
  has_add_to_cart     BOOL,
  has_begin_checkout  BOOL,
  has_purchase        BOOL,
  purchases           INT64,                -- distinct transaction ids
  revenue             NUMERIC,              -- SUM(ecommerce.purchase_revenue), in `currency`
  revenue_usd         NUMERIC,              -- SUM(ecommerce.purchase_revenue_in_usd)
  currency            STRING,               -- currency of the purchase event(s)
  loaded_at           TIMESTAMP NOT NULL
)
PARTITION BY date
CLUSTER BY client_id
OPTIONS (description = "Derived. One row per GA4 session (plus one row per purchase that arrived without a session id). Written by ops.sp_load_ga4_sessions, never by n8n. Do not write by hand.");

-- =============================================================================
-- 3. ops.sp_load_ga4_sessions_for(client, from, to): the worker
-- =============================================================================
-- Reloads (delete + insert in one transaction, per property) the sessions whose first event
-- falls on a day in [from_date, to_date]. p_client NULL = every registered property.
-- Reads one extra day before from_date so a session that straddles midnight on the first day is
-- assigned its true start day and is not loaded twice (it is simply dropped when its start day
-- is before from_date, and was loaded by the earlier run).
-- Idempotent: running it twice over the same window gives byte-identical rows, except
-- loaded_at, and except where GA4 itself revised the export in between.
CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.ops.sp_load_ga4_sessions_for`(
  p_client STRING, from_date DATE, to_date DATE)
BEGIN
  IF from_date IS NULL OR to_date IS NULL OR from_date > to_date THEN
    RAISE USING MESSAGE = 'sp_load_ga4_sessions_for: need from_date <= to_date';
  END IF;

  FOR p IN (
    SELECT
      client_id, property_id, dataset_id, hostname_pattern,
      GREATEST(from_date, IFNULL(valid_from, from_date)) AS d_from,
      LEAST(to_date, IFNULL(valid_to, to_date))          AS d_to
    FROM `oneeighty-warehouse.ref.ga4_properties`
    WHERE (p_client IS NULL OR client_id = p_client)
      AND (valid_from IS NULL OR valid_from <= to_date)
      AND (valid_to   IS NULL OR valid_to   >= from_date)
    ORDER BY client_id, property_id
  ) DO
    IF NOT REGEXP_CONTAINS(p.dataset_id, r'^analytics_[0-9]+$') THEN
      RAISE USING MESSAGE = FORMAT('sp_load_ga4_sessions_for: refusing dataset_id %s for %s', p.dataset_id, p.client_id);
    END IF;

    BEGIN
      BEGIN TRANSACTION;

      DELETE FROM `oneeighty-warehouse.stg.ga4_sessions`
      WHERE property_id = p.property_id AND date BETWEEN p.d_from AND p.d_to;

      EXECUTE IMMEDIATE FORMAT(r"""
        INSERT INTO `oneeighty-warehouse.stg.ga4_sessions`
          (client_id, property_id, date, session_key, session_kind, session_start_ts,
           channel_group, source, medium, campaign_name, campaign_id,
           gads_customer_id, gads_campaign_id, platform, landing_path, device, country,
           engaged, has_view_item, has_add_to_cart, has_begin_checkout, has_purchase,
           purchases, revenue, revenue_usd, currency, loaded_at)
        WITH ev AS (
          -- One narrow read of the export. Only the columns used below, so bytes stay small.
          SELECT
            user_pseudo_id AS uid,
            (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS sid,
            event_timestamp AS ts,
            PARSE_DATE('%%Y%%m%%d', event_date) AS d,
            event_name,
            session_traffic_source_last_click AS st,
            (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS page_location,
            (SELECT value.int_value    FROM UNNEST(event_params) WHERE key = 'entrances')     AS entrances,
            (SELECT COALESCE(value.string_value, CAST(value.int_value AS STRING))
               FROM UNNEST(event_params) WHERE key = 'session_engaged')                        AS session_engaged,
            (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'currency')      AS currency,
            device.category AS device,
            geo.country     AS country,
            NULLIF(ecommerce.transaction_id, '(not set)') AS tid,
            ecommerce.purchase_revenue        AS rev,
            ecommerce.purchase_revenue_in_usd AS rev_usd
          FROM `oneeighty-warehouse.%s.events_*`
          WHERE _TABLE_SUFFIX BETWEEN @suf_from AND @suf_to
            AND (@host_re IS NULL OR REGEXP_CONTAINS(IFNULL(device.web_info.hostname, ''), @host_re))
        ),
        -- Purchases, de-duplicated by transaction id inside the scanned range (a thank-you page
        -- reload fires purchase again). The earliest event wins.
        pur AS (
          SELECT uid, sid, ts, d, currency, rev, rev_usd, device, country,
                 COALESCE(tid, CONCAT(uid, '|', CAST(ts AS STRING))) AS txn
          FROM ev
          WHERE event_name = 'purchase'
          QUALIFY ROW_NUMBER() OVER (
            PARTITION BY COALESCE(tid, CONCAT(uid, '|', CAST(ts AS STRING))) ORDER BY ts) = 1
        ),
        pur_sess AS (
          SELECT uid, sid,
                 COUNT(*) AS purchases,
                 SUM(rev) AS revenue,
                 SUM(rev_usd) AS revenue_usd,
                 ARRAY_AGG(currency IGNORE NULLS ORDER BY ts LIMIT 1)[SAFE_OFFSET(0)] AS currency
          FROM pur
          WHERE sid IS NOT NULL
          GROUP BY uid, sid
        ),
        sess AS (
          SELECT
            uid, sid,
            ARRAY_AGG(d ORDER BY ts LIMIT 1)[OFFSET(0)] AS d,
            MIN(ts) AS ts0,
            -- the session's attribution: first event that carries a channel group
            ARRAY_AGG(IF(st.cross_channel_campaign.default_channel_group IS NOT NULL, st, NULL)
                      IGNORE NULLS ORDER BY ts LIMIT 1)[SAFE_OFFSET(0)] AS st,
            -- landing page: the entrance page_view, else the first page_view
            ARRAY_AGG(IF(event_name = 'page_view', page_location, NULL)
                      IGNORE NULLS ORDER BY IF(entrances = 1, 0, 1), ts LIMIT 1)[SAFE_OFFSET(0)] AS landing,
            ARRAY_AGG(device  IGNORE NULLS ORDER BY ts LIMIT 1)[SAFE_OFFSET(0)] AS device,
            ARRAY_AGG(country IGNORE NULLS ORDER BY ts LIMIT 1)[SAFE_OFFSET(0)] AS country,
            IFNULL(LOGICAL_OR(session_engaged = '1'), FALSE) AS engaged,
            LOGICAL_OR(event_name = 'view_item')      AS has_view_item,
            LOGICAL_OR(event_name = 'add_to_cart')    AS has_add_to_cart,
            LOGICAL_OR(event_name = 'begin_checkout') AS has_begin_checkout,
            LOGICAL_OR(event_name = 'purchase')       AS has_purchase
          FROM ev
          WHERE sid IS NOT NULL
          GROUP BY uid, sid
        ),
        rows_session AS (
          SELECT
            'session' AS session_kind,
            FARM_FINGERPRINT(CONCAT(@prop, '|', s.uid, '|', CAST(s.sid AS STRING))) AS session_key,
            s.d, TIMESTAMP_MICROS(s.ts0) AS session_start_ts,
            s.st.cross_channel_campaign.default_channel_group AS channel_group,
            s.st.cross_channel_campaign.source                AS source,
            s.st.cross_channel_campaign.medium                AS medium,
            COALESCE(s.st.cross_channel_campaign.campaign_name,
                     s.st.google_ads_campaign.campaign_name,
                     s.st.manual_campaign.campaign_name)      AS campaign_name,
            s.st.cross_channel_campaign.campaign_id           AS campaign_id,
            s.st.google_ads_campaign.customer_id              AS gads_customer_id,
            s.st.google_ads_campaign.campaign_id              AS gads_campaign_id,
            s.landing, s.device, s.country, s.engaged,
            s.has_view_item, s.has_add_to_cart, s.has_begin_checkout, s.has_purchase,
            IFNULL(p.purchases, 0) AS purchases, p.revenue, p.revenue_usd, p.currency
          FROM sess s
          LEFT JOIN pur_sess p ON p.uid = s.uid AND p.sid = s.sid
          -- sessions that started before the window belong to an earlier load
          WHERE s.d BETWEEN @d_from AND @d_to
        ),
        rows_nosession AS (
          -- purchases that carry no ga_session_id (consent mode): revenue is real, the session is not
          SELECT
            'purchase_no_session' AS session_kind,
            FARM_FINGERPRINT(CONCAT(@prop, '|nosid|', txn)) AS session_key,
            d, TIMESTAMP_MICROS(ts) AS session_start_ts,
            CAST(NULL AS STRING) AS channel_group, CAST(NULL AS STRING) AS source,
            CAST(NULL AS STRING) AS medium, CAST(NULL AS STRING) AS campaign_name,
            CAST(NULL AS STRING) AS campaign_id, CAST(NULL AS STRING) AS gads_customer_id,
            CAST(NULL AS STRING) AS gads_campaign_id,
            CAST(NULL AS STRING) AS landing, device, country, CAST(NULL AS BOOL) AS engaged,
            FALSE AS has_view_item, FALSE AS has_add_to_cart, FALSE AS has_begin_checkout, TRUE AS has_purchase,
            1 AS purchases, rev AS revenue, rev_usd AS revenue_usd, currency
          FROM pur
          WHERE sid IS NULL AND d BETWEEN @d_from AND @d_to
        ),
        classified AS (
          SELECT * FROM rows_session
          UNION ALL
          SELECT * FROM rows_nosession
        )
        SELECT
          @client AS client_id, @prop AS property_id, d AS date, session_key, session_kind, session_start_ts,
          channel_group, source, medium, campaign_name, campaign_id, gads_customer_id, gads_campaign_id,
          -- PLATFORM. Order matters: a Google Ads campaign id is the strongest signal.
          CASE
            WHEN session_kind = 'purchase_no_session' THEN 'unattributed'
            WHEN gads_campaign_id IS NOT NULL THEN 'google'
            -- Meta ads whose UTM source and medium were swapped (medium holds the placement,
            -- for example Facebook_Mobile_Feed, Instagram_Reels): GA4 files these under
            -- Organic Social, Unassigned or Mobile Push. The placement prefix is unambiguous.
            WHEN REGEXP_CONTAINS(LOWER(IFNULL(medium, '')), r'^(facebook|instagram|audience_network|messenger)_') THEN 'meta'
            WHEN channel_group IN ('Paid Search', 'Paid Social', 'Paid Shopping', 'Paid Video', 'Paid Other', 'Display', 'Cross-network')
                 AND REGEXP_CONTAINS(LOWER(IFNULL(source, '')),
                       r'(^|[^a-z])(facebook|fb|instagram|ig|meta)([^a-z]|$)|^(an|msg)$') THEN 'meta'
            WHEN LOWER(IFNULL(source, '')) IN ('google', 'youtube') AND LOWER(IFNULL(medium, '')) IN ('cpc', 'ppc') THEN 'google'
            WHEN channel_group IN ('Paid Search', 'Paid Social', 'Paid Shopping', 'Paid Video', 'Paid Other', 'Display', 'Cross-network') THEN 'other_paid'
            ELSE 'non_paid'
          END AS platform,
          IF(session_kind = 'purchase_no_session', NULL,
             COALESCE(REGEXP_EXTRACT(landing, r'^https?://[^/?#]+(/[^?#]*)'),
                      IF(landing IS NULL, '(not set)', '/'))) AS landing_path,
          device, country, engaged,
          has_view_item, has_add_to_cart, has_begin_checkout, has_purchase,
          purchases, ROUND(CAST(revenue AS NUMERIC), 2), ROUND(CAST(revenue_usd AS NUMERIC), 2), currency,
          CURRENT_TIMESTAMP() AS loaded_at
        FROM classified
      """, p.dataset_id)
      USING p.client_id AS client, p.property_id AS prop,
            p.d_from AS d_from, p.d_to AS d_to,
            FORMAT_DATE('%Y%m%d', DATE_SUB(p.d_from, INTERVAL 1 DAY)) AS suf_from,
            FORMAT_DATE('%Y%m%d', p.d_to) AS suf_to,
            p.hostname_pattern AS host_re;

      COMMIT TRANSACTION;
    EXCEPTION WHEN ERROR THEN
      ROLLBACK TRANSACTION;
      RAISE USING MESSAGE = FORMAT('sp_load_ga4_sessions_for failed for %s (%s): %s',
                                   p.client_id, p.property_id, @@error.message);
    END;
  END FOR;
END;

-- =============================================================================
-- 4. ops.sp_load_ga4_sessions(days): the daily entry point
-- =============================================================================
-- Reloads the last `days` complete days (yesterday back to today - days) for every property.
-- Scheduled as CALL ops.sp_load_ga4_sessions(3) daily 07:00 UTC (GA4 revises the last ~3 days).
-- One-off backfill: CALL ops.sp_load_ga4_sessions(70).
CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.ops.sp_load_ga4_sessions`(days INT64)
BEGIN
  IF days IS NULL OR days < 1 OR days > 400 THEN
    RAISE USING MESSAGE = 'sp_load_ga4_sessions: days must be between 1 and 400';
  END IF;
  CALL `oneeighty-warehouse.ops.sp_load_ga4_sessions_for`(
    CAST(NULL AS STRING), DATE_SUB(CURRENT_DATE(), INTERVAL days DAY), DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY));
END;

-- =============================================================================
-- 5. mart.mart_ga4_sessions_daily
-- =============================================================================
-- Grain: client_id, date, channel_group, platform, source, medium, campaign_name, landing_path, device.
-- Money is converted to the CLIENT currency per row, with that month's ref.fx_rates rate
-- (same pattern as mart_daily_kpis: a missing rate gives NULL, never a wrong number; the
-- number of purchase sessions this affected is exposed as sessions_fx_missing).
--   * purchase currency = client currency: native revenue
--   * client currency USD: GA4's own purchase_revenue_in_usd (dobias CAD and GBP orders)
--   * otherwise: native revenue x ref.fx_rates(currency -> client currency, month)
-- Rows with session_kind = 'purchase_no_session' (platform 'unattributed') contribute
-- purchases and revenue but never sessions, so CVR stays purchases of real sessions.
-- Bounded to 25 months so the dashboard's date filter prunes the partitioned table.
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_ga4_sessions_daily` AS
WITH s AS (
  SELECT
    t.*,
    c.currency AS client_currency,
    CASE
      WHEN t.revenue IS NULL THEN CAST(NULL AS NUMERIC)
      WHEN t.currency = c.currency THEN t.revenue
      WHEN c.currency = 'USD' THEN t.revenue_usd
      ELSE t.revenue * fx.rate
    END AS revenue_client
  FROM `oneeighty-warehouse.stg.ga4_sessions` t
  JOIN `oneeighty-warehouse.ref.clients` c ON c.client_id = t.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
    ON  fx.month_start   = DATE_TRUNC(t.date, MONTH)
    AND fx.from_currency = t.currency
    AND fx.to_currency   = c.currency
  WHERE t.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH)
)
SELECT
  client_id,
  date,
  IFNULL(channel_group, 'Unattributed')   AS channel_group,
  platform,
  source,
  medium,
  campaign_name,
  landing_path,
  device,
  COUNTIF(session_kind = 'session')                                      AS sessions,
  COUNTIF(session_kind = 'session' AND engaged)                          AS engaged_sessions,
  COUNTIF(session_kind = 'session' AND has_view_item)                    AS sessions_view_item,
  COUNTIF(session_kind = 'session' AND has_add_to_cart)                  AS sessions_atc,
  COUNTIF(session_kind = 'session' AND has_begin_checkout)               AS sessions_checkout,
  COUNTIF(session_kind = 'session' AND has_purchase)                     AS sessions_purchase,
  SUM(purchases)                                                         AS purchases,
  SUM(revenue_client)                                                    AS revenue,
  COUNTIF(purchases > 0 AND revenue_client IS NULL)                      AS sessions_fx_missing,
  ANY_VALUE(client_currency)                                             AS currency
FROM s
GROUP BY client_id, date, channel_group, platform, source, medium, campaign_name, landing_path, device;
