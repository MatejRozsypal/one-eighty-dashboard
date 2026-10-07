-- =============================================================================
-- 279h_plan_seed_retire.sql
-- Promo pacing, package ca1, part 3 of 3: ClickUp is the only input. mart.plan_input_v
-- stops reading ref.plan_seed (no per-field fallback, no seed-only tasks).
--
-- Why: the owner rule of 2026-10-07 is "ClickUp is the source of truth and the only input".
--   The seed fallback was a bridge until the fields existed. Today it still injects
--   MER cap % (30 / 27 / 24 / 28 on Oct to Jan, 25.4 on Q4, 25 on F4, 27 on G2), values
--   from the 6 October plan that the 7 October rebuild replaced with aMER floors and the
--   scale rule. Every other seed value is already in ClickUp (checked: `note` lists only
--   mer_cap_pct, 7 Ethia tasks, 0 seed-only tasks).
--
-- Change: CREATE OR REPLACE VIEW mart.plan_input_v (279f without seed_all / seed_cur),
--   same columns; is_seed is always FALSE and note always NULL (kept for the schema).
--   ref.plan_seed is NOT dropped (history, rollback = redeploy 279f section 3).
--   Then CALL mart.sp_refresh_plan_pacing().
-- Effect (QA, raw/12 section 4.3): mart.plan_input differs on exactly the 7 rows above
--   (mer_cap_pct and note to NULL); in mart.plan_pacing only mer_cap_pct goes to NULL on
--   the matching month / quarter / promo / gate rows (MER cap line disappears on the page),
--   G2's result no longer requires MER <= 27 % (that condition was removed from G2 on
--   2026-10-07). No target, actual, status or projection changes.
-- Deploy order: after 279f and 279g, once the owner agrees (independent of the new fields).
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_input_v` AS
WITH
loader AS (
  -- Descriptive and scoping fields from the LATEST snapshot (stg_clickup_plan, p);
  -- versions only carry the target values and the status used to find the original.
  SELECT v.client_id, v.task_id, p.level, p.name, p.start_date, p.end_date,
         LOWER(TRIM(p.status))                              AS status,
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
         v.valid_from                                       AS version_at,
         FALSE                                              AS is_seed,
         CAST(NULL AS STRING)                               AS note,
         LOWER(TRIM(v.status))                              AS version_status,
         CAST(v.target_cm3 AS NUMERIC)                      AS target_cm3,
         CAST(v.target_amer AS FLOAT64)                     AS target_amer
  FROM `oneeighty-warehouse.stg.stg_clickup_plan_versions` v
  JOIN `oneeighty-warehouse.stg.stg_clickup_plan` p USING (client_id, task_id)
),
ranked AS (
  SELECT s.*,
         ROW_NUMBER() OVER (PARTITION BY client_id, task_id ORDER BY version DESC, version_at DESC) AS rn_cur,
         ROW_NUMBER() OVER (PARTITION BY client_id, task_id
                            ORDER BY IF(version_status IN ('approved', 'done'), 0, 1), version, version_at) AS rn_orig
  FROM loader s
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
  o.ad_budget            AS orig_ad_budget,
  c.target_cm3,
  c.target_amer,
  o.target_cm3           AS orig_target_cm3,
  o.target_amer          AS orig_target_amer
FROM ranked c
JOIN ranked o
  ON o.client_id = c.client_id AND o.task_id = c.task_id AND o.rn_orig = 1
WHERE c.rn_cur = 1;

CALL `oneeighty-warehouse.mart.sp_refresh_plan_pacing`();
