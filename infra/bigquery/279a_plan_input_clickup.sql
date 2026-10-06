-- =============================================================================
-- 279a_plan_input_clickup.sql
-- Promo pacing (package pp1): mart.plan_input reads the ClickUp loader (277) for every
-- client. ref.plan_seed stays as a per-field fallback only.
--
-- Change (same columns as live mart.plan_input + refreshed_at, column `note` reused)
--   NEW VIEW mart.plan_input_v (logic below); mart.plan_input VIEW -> TABLE snapshot
--   mart.plan_input
--     source   stg.stg_clickup_plan_versions (one row per task version) joined to
--              stg.stg_clickup_plan (current task: presence, Mechanic, Coupon codes,
--              SKUs, UTM campaign). version = version_no, version_at = valid_from.
--     fallback a field that is NULL in ClickUp takes the value of the task's latest
--              ref.plan_seed row (same client_id + task_id). Today this fills Target
--              new customers on the Ethia Months and MER cap % (no ClickUp field yet).
--              `note` lists the fields filled from the seed ("seed: mer_cap_pct, ...").
--              A seed task that the loader does not return is kept as is (is_seed TRUE).
--     is_valid Target state: valid unless rejected (owner rule 2026-10-06: the planning
--              status is the ambitious line and must stay visible). Every other level:
--              approved or done (unchanged from 270).
--
-- Based on live view mart.plan_input (270, 2026-10-06) and the proposal in 277 section 3
--   (pp3), amended with the per-field fallback and the Target state rule.
-- Affected clients: ethia (values identical to the seed today, plus Target state
--   12/2027 from ClickUp), manami (new: 34 tasks). Regression: see raw/06 section 9.
-- Deploy order: 277 (sections 1 and 2), 279a, 279b, 279c.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_input_v` AS
WITH
seed_all AS (
  SELECT client_id, task_id, level, name, start_date, end_date, LOWER(TRIM(status)) AS status,
         target_revenue, target_orders, target_new_customers, ad_budget, mer_cap_pct,
         mechanic, day_multiplier, coupon_codes, skus, target_units, utm_campaign,
         version, version_at, is_seed, note
  FROM `oneeighty-warehouse.ref.plan_seed`
),
seed_cur AS (
  SELECT * EXCEPT (rn) FROM (
    SELECT s.*, ROW_NUMBER() OVER (PARTITION BY client_id, task_id ORDER BY version DESC, version_at DESC) AS rn
    FROM seed_all s)
  WHERE rn = 1
),
loader_raw AS (
  SELECT v.client_id, v.task_id, v.level, v.name, v.start_date, v.end_date,
         LOWER(TRIM(v.status))                              AS status,
         CAST(v.target_revenue AS NUMERIC)                  AS target_revenue,
         SAFE_CAST(ROUND(v.target_orders) AS INT64)         AS target_orders,
         SAFE_CAST(ROUND(v.target_new_customers) AS INT64)  AS target_new_customers,
         CAST(v.ad_budget AS NUMERIC)                       AS ad_budget,
         CAST(v.mer_cap_pct AS FLOAT64)                     AS mer_cap_pct,
         p.mechanic,
         CAST(v.day_multiplier AS FLOAT64)                  AS day_multiplier,
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
    ]) f WHERE f IS NOT NULL), ', ')), 'seed: ')               AS note
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
                            ORDER BY IF(status IN ('approved', 'done'), 0, 1), version, version_at) AS rn_orig
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

-- mart.plan_input becomes a table (snapshot of plan_input_v): the plan views reference it
-- several times and inlining the ClickUp raw parsing each time exceeds BigQuery's query
-- planning limit ("query is too complex", measured 2026-10-06). Refreshed as the first
-- step of mart.sp_refresh_plan_pacing() (279c). Same columns + refreshed_at.
DROP VIEW IF EXISTS `oneeighty-warehouse.mart.plan_input`;
CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_input` CLUSTER BY client_id, level
AS SELECT *, CURRENT_TIMESTAMP() AS refreshed_at FROM `oneeighty-warehouse.mart.plan_input_v`;
