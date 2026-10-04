-- 202_stg_google_ads.sql
-- Deployed 2026-10-01. Replaces the hardcoded per-account version (2026-07-03).
--
-- Account -> client mapping lives in ref.clients (gads_customer_id), not in this view.
-- Reads the DTS base tables p_ads_* with a wildcard, so a new account under the MCC is
-- picked up without editing the view. (The ads_* objects are views and cannot be queried
-- through a prefix; the p_ads_* base tables can.)
--
-- Onboarding a new Google Ads client = one UPDATE, no view change:
--   UPDATE `oneeighty-warehouse.ref.clients`
--   SET gads_customer_id = <digits, no dashes>, has_gads = TRUE, gads_currency = '<account currency>',
--       updated_at = CURRENT_TIMESTAMP()
--   WHERE client_id = '<client>';
-- Then check ops.v_gads_coverage: status must be 'ok'.

-- 1. Registry column (done once)
ALTER TABLE `oneeighty-warehouse.ref.clients`
  ADD COLUMN IF NOT EXISTS gads_customer_id INT64
  OPTIONS (description = 'Google Ads customer id (digits only, no dashes). stg_google_ads_campaign_insights maps account -> client through this column. Set together with has_gads and gads_currency when onboarding.');

UPDATE `oneeighty-warehouse.ref.clients` SET gads_customer_id = 5865960448 WHERE client_id = 'manami';
UPDATE `oneeighty-warehouse.ref.clients`
SET gads_customer_id = 9406261058, has_gads = TRUE, gads_currency = 'CZK', updated_at = CURRENT_TIMESTAMP()
WHERE client_id = 'rawbark';

-- 2. stg view
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_google_ads_campaign_insights` AS
WITH client_map AS (
  SELECT gads_customer_id AS customer_id, client_id
  FROM `oneeighty-warehouse.ref.clients`
  WHERE has_gads AND gads_customer_id IS NOT NULL
),
stats AS (
  SELECT
    segments_date                    AS date,
    customer_id,
    campaign_id,
    SUM(metrics_cost_micros) / 1e6   AS spend,
    SUM(metrics_impressions)         AS impressions,
    SUM(metrics_clicks)              AS clicks,
    SUM(metrics_conversions)         AS purchases,
    SUM(metrics_conversions_value)   AS purchase_value
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_CampaignBasicStats_*`
  WHERE segments_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY date, customer_id, campaign_id
),
campaigns AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT customer_id, campaign_id, campaign_name,
      ROW_NUMBER() OVER (PARTITION BY customer_id, campaign_id ORDER BY _PARTITIONTIME DESC) AS rn
    FROM `oneeighty-warehouse.raw_google_ads.p_ads_Campaign_*`
  ) WHERE rn = 1
)
SELECT
  m.client_id,
  st.date                          AS date_start,
  st.date                          AS date_stop,
  CAST(st.customer_id AS STRING)   AS ad_account_id,
  CAST(st.campaign_id AS STRING)   AS campaign_id,
  c.campaign_name,
  st.spend,
  st.impressions,
  st.clicks,
  st.purchases,
  st.purchase_value
FROM stats st
JOIN client_map m USING (customer_id)
LEFT JOIN campaigns c USING (customer_id, campaign_id);

-- 3. Health check: one row per Google Ads account in the transfer (and per client flagged
--    has_gads without an account). Anything other than status = 'ok' needs action.
CREATE OR REPLACE VIEW `oneeighty-warehouse.ops.v_gads_coverage` AS
WITH accounts AS (
  SELECT customer_id, customer_descriptive_name AS account_name, customer_currency_code AS account_currency,
         DATE(_PARTITIONTIME) AS last_transfer_date
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_Customer_*`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY _PARTITIONTIME DESC) = 1
),
stats AS (
  SELECT customer_id, MIN(segments_date) AS first_stats_date, MAX(segments_date) AS last_stats_date
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_CampaignBasicStats_*`
  GROUP BY customer_id
),
reg AS (
  SELECT client_id, has_gads, gads_currency, gads_customer_id
  FROM `oneeighty-warehouse.ref.clients`
  WHERE has_gads OR gads_customer_id IS NOT NULL
)
SELECT
  COALESCE(a.customer_id, r.gads_customer_id) AS customer_id,
  a.account_name, a.account_currency,
  r.client_id, r.has_gads, r.gads_currency,
  a.last_transfer_date,
  DATE_DIFF(CURRENT_DATE(), a.last_transfer_date, DAY) AS days_since_transfer,
  s.first_stats_date, s.last_stats_date,
  CASE
    WHEN a.customer_id IS NULL                                 THEN 'CLIENT_WITHOUT_ACCOUNT: gads_customer_id is not in the transfer (add the account under the MCC or fix the id)'
    WHEN r.client_id IS NULL                                   THEN 'UNMAPPED: set ref.clients.gads_customer_id, has_gads, gads_currency for the client'
    WHEN NOT COALESCE(r.has_gads, FALSE)                       THEN 'NO_FLAG: set ref.clients.has_gads = TRUE'
    WHEN r.gads_currency IS DISTINCT FROM a.account_currency   THEN 'CURRENCY_MISMATCH: ref.clients.gads_currency differs from the account currency'
    WHEN DATE_DIFF(CURRENT_DATE(), a.last_transfer_date, DAY) > 3 THEN 'STALE: transfer has not run for more than 3 days'
    ELSE 'ok'
  END AS status
FROM accounts a
FULL OUTER JOIN reg r ON r.gads_customer_id = a.customer_id
LEFT JOIN stats s ON s.customer_id = COALESCE(a.customer_id, r.gads_customer_id);

-- =============================================================================
-- HISTORY: header of the previous (2026-07-03, hardcoded single-account) version,
-- kept from the repo for the bug notes. Quoted lines are prefixed with '-- | '.
-- =============================================================================
-- | 202_stg_google_ads.sql
-- | =============================================================================
-- | stg_google_ads_campaign_insights - daily campaign-level Google Ads cost,
-- | flattened out of the BigQuery Data Transfer Service (DTS) landing tables.
-- | Mirrors the shape of stg_meta_campaign_insights so the mart treats both
-- | paid channels identically.
-- |
-- | DEPLOY PREREQS:
-- |   1. DTS Google Ads transfer running into `raw_google_ads` (see runbook 17).
-- |      Tables ads_CampaignBasicStats_<customer_id> + ads_Campaign_<customer_id>
-- |      must exist. CONFIRMED landed 2026-07 (Manami account 5865960448,
-- |      data from 2025-10-01).
-- |
-- | Cost is stored in MICROS (1e6 micros = 1 currency unit) -> divide by 1e6.
-- |
-- | -----------------------------------------------------------------------------
-- | 2026-07-03 - corrected two bugs from the original draft (verified against the
-- | landed DTS tables - both would have produced empty/failed output):
-- |
-- |   BUG 1 - wildcard over views. The draft read `ads_CampaignBasicStats_*`.
-- |     In this project the ads_* objects are VIEWS (thin wrappers over the
-- |     partitioned p_ads_* base tables in the DTS host project). BigQuery rejects
-- |     prefix/wildcard queries over views ("Views cannot be queried through
-- |     prefix"). Fix: reference each account's concrete view. There is exactly
-- |     one Google account today (Manami). Add a UNION ALL line per new account.
-- |
-- |   BUG 2 - `_LATEST_DATE = _DATA_DATE` zeroed all history. In these views
-- |     `_DATA_DATE = DATE(_PARTITIONTIME)` = the metric date, and `_LATEST_DATE`
-- |     is a constant literal (the last DTS run date). So that predicate collapses
-- |     to "only the single latest day", returning ~0 for every historical month.
-- |     There is no cross-run duplication here (one partition per metric date), so
-- |     no dedup is needed at all - just filter on segments_date. Fix: dropped the
-- |     predicate; aggregate straight over segments_date.
-- |
-- |   Verified after fix: June 2026 spend = 19,901.47 CZK, May = 18,068.77 CZK
-- |   (both match the Google Ads account totals).
-- | =============================================================================
-- | 
