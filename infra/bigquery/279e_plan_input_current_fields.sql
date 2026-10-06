-- =============================================================================
-- 279e_plan_input_current_fields.sql
-- Promo pacing (package pp1): mart.plan_input took name, level, status, dates and Day
-- multiplier from the CURRENT VERSION of stg.stg_clickup_plan_versions. A version is cut
-- only when the fingerprint (level, status, dates, numeric targets) changes and keeps the
-- values of its FIRST snapshot, so a rename (not in the fingerprint) stayed stale:
-- 123ymga0zez read 'F12 · ...' while ClickUp says 'F13 · ...'.
--
-- Rule now: name, level, status, start_date, end_date, Day multiplier, Mechanic, Coupon
-- codes, SKUs and UTM campaign ALWAYS come from the latest snapshot
-- (stg.stg_clickup_plan). Versions carry only the target values (revenue, orders, new
-- customers, ad budget, MER cap, target units) and the version status that decides which
-- version is the "original" (first approved or done). Seed fallback unchanged.
--
-- Dates: in the fingerprint, so a date change already cut a new version and was not
-- stale (checked 2026-10-06: 0 differences in level, status, dates or multiplier between
-- stg_clickup_plan and mart.plan_input; 1 difference in name). With this file they no
-- longer depend on the fingerprint at all.
--
-- Change: CREATE OR REPLACE VIEW mart.plan_input_v, then CALL mart.sp_refresh_plan_pacing()
--   (procedure unchanged; it snapshots plan_input_v into the mart.plan_input table).
-- Based on: 279a as deployed 2026-10-06.
-- Affected: manami 123ymga0zez name; ethia unchanged (raw/06 section 14).
-- Deploy order: after 279d. Single file.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_input_v` AS
WITH
seed_all AS (
  SELECT client_id, task_id, level, name, start_date, end_date, LOWER(TRIM(status)) AS status,
         target_revenue, target_orders, target_new_customers, ad_budget, mer_cap_pct,
         mechanic, day_multiplier, coupon_codes, skus, target_units, utm_campaign,
         version, version_at, is_seed, note,
         LOWER(TRIM(status)) AS version_status
  FROM `oneeighty-warehouse.ref.plan_seed`
),
seed_cur AS (
  SELECT * EXCEPT (rn) FROM (
    SELECT s.*, ROW_NUMBER() OVER (PARTITION BY client_id, task_id ORDER BY version DESC, version_at DESC) AS rn
    FROM seed_all s)
  WHERE rn = 1
),
loader_raw AS (
  -- Descriptive and scoping fields from the LATEST snapshot (stg_clickup_plan, p);
  -- versions only carry the target values and the status used to find the original.
  SELECT v.client_id, v.task_id, p.level, p.name, p.start_date, p.end_date,
         LOWER(TRIM(p.status))                              AS status,
         LOWER(TRIM(v.status))                              AS version_status,
         CAST(v.target_revenue AS NUMERIC)                  AS target_revenue,
         SAFE_CAST(ROUND(v.target_orders) AS INT64)         AS target_orders,
         SAFE_CAST(ROUND(v.target_new_customers) AS INT64)  AS target_new_customers,
         CAST(v.ad_budget AS NUMERIC)                       AS ad_budget,
         CAST(v.mer_cap_pct AS FLOAT64)                     AS mer_cap_pct,
         p.mechanic,
         CAST(p.day_multiplier AS FLOAT64)                  AS day_multiplier,
         NULLIF(ARRAY_TO_STRING(p.coupon_codes, ', '), '')  AS coupon_codes,
         NULLIF(ARRAY_TO_STRING(p.skus, ', '), '')          AS skus,
         SAFE_CAST(ROUND(v.target_units) AS INT64)          AS target_units,
         NULLIF(ARRAY_TO_STRING(p.utm_campaigns, ', '), '') AS utm_campaign,
         v.version_no                                       AS version,
         v.valid_from                                       AS version_at
  FROM `oneeighty-warehouse.stg.stg_clickup_plan_versions` v
  JOIN `oneeighty-warehouse.stg.stg_clickup_plan` p USING (client_id, task_id)
),
loader AS (
  SELECT
    l.client_id, l.task_id, l.level, l.name, l.start_date, l.end_date, l.status,
    COALESCE(l.target_revenue, s.target_revenue)             AS target_revenue,
    COALESCE(l.target_orders, s.target_orders)               AS target_orders,
    COALESCE(l.target_new_customers, s.target_new_customers) AS target_new_customers,
    COALESCE(l.ad_budget, s.ad_budget)                       AS ad_budget,
    COALESCE(l.mer_cap_pct, s.mer_cap_pct)                   AS mer_cap_pct,
    COALESCE(l.mechanic, s.mechanic)                         AS mechanic,
    COALESCE(l.day_multiplier, s.day_multiplier)             AS day_multiplier,
    COALESCE(l.coupon_codes, s.coupon_codes)                 AS coupon_codes,
    COALESCE(l.skus, s.skus)                                 AS skus,
    COALESCE(l.target_units, s.target_units)                 AS target_units,
    COALESCE(l.utm_campaign, s.utm_campaign)                 AS utm_campaign,
    l.version, l.version_at,
    FALSE                                                    AS is_seed,
    NULLIF(CONCAT('seed: ', ARRAY_TO_STRING(ARRAY(SELECT f FROM UNNEST([
      IF(l.target_revenue IS NULL AND s.target_revenue IS NOT NULL, 'target_revenue', NULL),
      IF(l.target_orders IS NULL AND s.target_orders IS NOT NULL, 'target_orders', NULL),
      IF(l.target_new_customers IS NULL AND s.target_new_customers IS NOT NULL, 'target_new_customers', NULL),
      IF(l.ad_budget IS NULL AND s.ad_budget IS NOT NULL, 'ad_budget', NULL),
      IF(l.mer_cap_pct IS NULL AND s.mer_cap_pct IS NOT NULL, 'mer_cap_pct', NULL),
      IF(l.mechanic IS NULL AND s.mechanic IS NOT NULL, 'mechanic', NULL),
      IF(l.day_multiplier IS NULL AND s.day_multiplier IS NOT NULL, 'day_multiplier', NULL),
      IF(l.coupon_codes IS NULL AND s.coupon_codes IS NOT NULL, 'coupon_codes', NULL),
      IF(l.skus IS NULL AND s.skus IS NOT NULL, 'skus', NULL),
      IF(l.target_units IS NULL AND s.target_units IS NOT NULL, 'target_units', NULL),
      IF(l.utm_campaign IS NULL AND s.utm_campaign IS NOT NULL, 'utm_campaign', NULL)
    ]) f WHERE f IS NOT NULL), ', ')), 'seed: ')               AS note,
    l.version_status
  FROM loader_raw l
  LEFT JOIN seed_cur s USING (client_id, task_id)
),
src AS (
  SELECT * FROM loader
  UNION ALL
  SELECT * FROM seed_all s
  WHERE NOT EXISTS (SELECT 1 FROM loader l WHERE l.client_id = s.client_id AND l.task_id = s.task_id)
),
ranked AS (
  SELECT s.*,
         ROW_NUMBER() OVER (PARTITION BY client_id, task_id ORDER BY version DESC, version_at DESC) AS rn_cur,
         ROW_NUMBER() OVER (PARTITION BY client_id, task_id
                            ORDER BY IF(version_status IN ('approved', 'done'), 0, 1), version, version_at) AS rn_orig
  FROM src s
)
SELECT
  c.client_id, c.task_id, c.level, c.name, c.start_date, c.end_date, c.status,
  IF(c.level = 'Target state', IFNULL(c.status, '') != 'rejected',
     c.status IN ('approved', 'done'))                     AS is_valid,
  c.target_revenue, c.target_orders, c.target_new_customers, c.ad_budget, c.mer_cap_pct,
  c.mechanic, c.day_multiplier, c.coupon_codes, c.skus, c.target_units, c.utm_campaign,
  c.version, c.version_at, c.is_seed, c.note,
  o.version              AS version_original,
  o.target_revenue       AS orig_target_revenue,
  o.target_orders        AS orig_target_orders,
  o.target_new_customers AS orig_target_new_customers,
  o.ad_budget            AS orig_ad_budget
FROM ranked c
JOIN ranked o
  ON o.client_id = c.client_id AND o.task_id = c.task_id AND o.rn_orig = 1
WHERE c.rn_cur = 1;

CALL `oneeighty-warehouse.mart.sp_refresh_plan_pacing`();
