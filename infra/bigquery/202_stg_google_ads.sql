-- 202_stg_google_ads.sql
-- =============================================================================
-- stg_google_ads_campaign_insights — daily campaign-level Google Ads cost,
-- flattened out of the BigQuery Data Transfer Service (DTS) landing tables.
-- Mirrors the shape of stg_meta_campaign_insights so the mart treats both
-- paid channels identically.
--
-- DEPLOY PREREQS:
--   1. DTS Google Ads transfer running into `raw_google_ads` (see runbook 17).
--      Tables ads_CampaignBasicStats_<customer_id> + ads_Campaign_<customer_id>
--      must exist. CONFIRMED landed 2026-07 (Manami account 5865960448,
--      data from 2025-10-01).
--
-- Cost is stored in MICROS (1e6 micros = 1 currency unit) -> divide by 1e6.
--
-- -----------------------------------------------------------------------------
-- 2026-07-03 — corrected two bugs from the original draft (verified against the
-- landed DTS tables — both would have produced empty/failed output):
--
--   BUG 1 — wildcard over views. The draft read `ads_CampaignBasicStats_*`.
--     In this project the ads_* objects are VIEWS (thin wrappers over the
--     partitioned p_ads_* base tables in the DTS host project). BigQuery rejects
--     prefix/wildcard queries over views ("Views cannot be queried through
--     prefix"). Fix: reference each account's concrete view. There is exactly
--     one Google account today (Manami). Add a UNION ALL line per new account.
--
--   BUG 2 — `_LATEST_DATE = _DATA_DATE` zeroed all history. In these views
--     `_DATA_DATE = DATE(_PARTITIONTIME)` = the metric date, and `_LATEST_DATE`
--     is a constant literal (the last DTS run date). So that predicate collapses
--     to "only the single latest day", returning ~0 for every historical month.
--     There is no cross-run duplication here (one partition per metric date), so
--     no dedup is needed at all — just filter on segments_date. Fix: dropped the
--     predicate; aggregate straight over segments_date.
--
--   Verified after fix: June 2026 spend = 19,901.47 CZK, May = 18,068.77 CZK
--   (both match the Google Ads account totals).
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_google_ads_campaign_insights` AS
WITH client_map AS (
  -- Google Ads customer_id (no dashes) -> our client_id. One row per client.
  -- Manami only for now (account 586-596-0448).
  SELECT 5865960448 AS customer_id, 'manami' AS client_id
  -- Add Dobias (or any new account) when Google launches, e.g.:
  -- UNION ALL SELECT 1234567890 AS customer_id, 'dobias' AS client_id
),
stats AS (
  -- One concrete per-account stats view per landed Google Ads account.
  -- (Wildcard ads_..._* is NOT usable — those are views; see BUG 1 above.)
  -- Add a UNION ALL block per new account, mirroring client_map.
  SELECT
    segments_date                    AS date,
    customer_id,
    campaign_id,
    SUM(metrics_cost_micros) / 1e6   AS spend,
    SUM(metrics_impressions)         AS impressions,
    SUM(metrics_clicks)              AS clicks,
    SUM(metrics_conversions)         AS purchases,
    SUM(metrics_conversions_value)   AS purchase_value
  FROM `oneeighty-warehouse.raw_google_ads.ads_CampaignBasicStats_5865960448`
  WHERE segments_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY date, customer_id, campaign_id
),
campaigns AS (
  -- Latest campaign name per (account, campaign). ads_Campaign_* is also a view,
  -- so reference the concrete per-account table and add a UNION ALL per account.
  SELECT * EXCEPT(rn) FROM (
    SELECT customer_id, campaign_id, campaign_name,
      ROW_NUMBER() OVER (PARTITION BY customer_id, campaign_id ORDER BY _DATA_DATE DESC) AS rn
    FROM `oneeighty-warehouse.raw_google_ads.ads_Campaign_5865960448`
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
