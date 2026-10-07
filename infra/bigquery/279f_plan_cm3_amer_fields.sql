-- =============================================================================
-- 279f_plan_cm3_amer_fields.sql
-- Promo pacing, package ca1 (CM3 and aMER in plans and checkpoints), part 1 of 3:
-- read the four new ClickUp fields BY NAME into staging and mart.plan_input.
--
--   Target CM3        Number, client currency. Quarter / Month / Target state: CM3 target of
--                     the period (mart definition: revenue - cogs - fulfillment_cost -
--                     paid_spend). Checkpoint: floor, CM3 over Start..Due must reach it.
--   Target aMER       Number, multiple (2.55 = 2.55x). Quarter / Month / Target state: planned
--                     aMER of the period. Checkpoint: floor.
--   aMER window days  Number, Checkpoint only. Empty = the task window Start..Due; N = the
--                     trailing N days ending on Due.
--   aMER min spend    Number, client currency, Checkpoint only. Paid spend in the aMER window
--                     must reach it, otherwise the aMER condition is not met.
-- Field design and the owner steps: projects/promo-pacing/11-CLICKUP-CM3-AMER.md.
--
-- The fields do not exist in ClickUp yet (custom fields cannot be created through the
-- API). Until the owner creates them every new column is NULL and nothing downstream
-- changes; the hourly loader picks them up on the first run after they exist, because
-- the loader writes every field definition and value it sees and staging reads by name.
--
-- Change (CREATE OR REPLACE, columns APPENDED, nothing removed or moved)
--   stg.stg_clickup_plan           + target_cm3, target_amer, amer_window_days, amer_min_spend
--   stg.stg_clickup_plan_versions  + the same four; versioned (part of the fingerprint only
--                                    when one of them is set, so existing fingerprints and
--                                    version numbers are byte-identical)
--   mart.plan_input_v              + target_cm3, target_amer, amer_window_days,
--                                    amer_min_spend, orig_target_cm3, orig_target_amer.
--                                    No ref.plan_seed fallback for the new fields.
--   then CALL mart.sp_refresh_plan_pacing() (procedure unchanged) so the mart.plan_input
--   table carries the new columns before 279g creates views that reference them.
--
-- Based on: live stg.stg_clickup_plan / stg_clickup_plan_versions (277 sections 1 and 2,
--   deployed) and live mart.plan_input_v (279e, deployed), read 2026-10-07.
-- Affected clients: none until the fields are filled (QA: EXCEPT DISTINCT both ways on the
--   old columns = 0 rows, raw/12 section 4).
-- QA copies: mart_qa.ca1_stg_clickup_plan, ca1_stg_clickup_plan_versions, ca1_plan_input_v,
--   ca1_plan_input.
-- Deploy order: 279f, 279g, then 279h (seed retirement) when the owner agrees.
-- =============================================================================

-- =============================================================================
-- 1. stg.stg_clickup_plan
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_clickup_plan` AS
WITH reg AS (
  SELECT l.client_id, l.list_id
  FROM `oneeighty-warehouse.ref.clickup_lists` l
  JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
  WHERE l.active AND l.list_kind = 'promo' AND c.status = 'active'
),
runs AS (
  SELECT client_id, list_id, MAX(ingested_at) AS last_run
  FROM (
    SELECT client_id, list_id, ingested_at FROM `oneeighty-warehouse.raw.raw_clickup_tasks`
    WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY) AND list_kind = 'promo'
    UNION ALL
    SELECT client_id, list_id, ingested_at FROM `oneeighty-warehouse.raw.raw_clickup_fields`
    WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY) AND list_kind = 'promo'
  )
  GROUP BY client_id, list_id
),
latest AS (
  SELECT
    t.* EXCEPT (custom_fields),
    ARRAY(
      SELECT AS STRUCT f.field_id, f.name, f.type,
        IF(TRIM(IFNULL(f.value_text, '')) = f.name, NULL, f.value_text) AS value_text,
        f.value_num, f.value_ids
      FROM UNNEST(t.custom_fields) AS f
    ) AS custom_fields
  FROM `oneeighty-warehouse.raw.raw_clickup_tasks` t
  JOIN reg  USING (client_id, list_id)
  JOIN runs r USING (client_id, list_id)
  WHERE t.snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
    AND t.list_kind = 'promo'
    AND t.ingested_at = r.last_run
  -- one row per task even if a run ever wrote a task twice
  QUALIFY ROW_NUMBER() OVER (PARTITION BY t.client_id, t.task_id ORDER BY t.ingested_at DESC) = 1
),
parsed AS (
  SELECT
    l.client_id,
    l.list_id,
    l.task_id,
    l.task_name AS name,
    l.task_url,
    l.status,
    l.status_type,
    c.currency,
    c.timezone,
    (SELECT f.value_text FROM UNNEST(l.custom_fields) f WHERE f.name = 'Level' LIMIT 1) AS level,
    DATE(TIMESTAMP_MILLIS(SAFE_CAST(JSON_VALUE(l.payload_json, '$.start_date') AS INT64)), c.timezone) AS start_date,
    DATE(TIMESTAMP_MILLIS(SAFE_CAST(JSON_VALUE(l.payload_json, '$.due_date')   AS INT64)), c.timezone) AS end_date,
    (SELECT f.value_num  FROM UNNEST(l.custom_fields) f WHERE f.name = 'Target revenue ex VAT' LIMIT 1) AS target_revenue,
    (SELECT f.value_num  FROM UNNEST(l.custom_fields) f WHERE f.name = 'Target orders'         LIMIT 1) AS target_orders,
    (SELECT f.value_num  FROM UNNEST(l.custom_fields) f WHERE f.name = 'Target new customers'  LIMIT 1) AS target_new_customers,
    (SELECT f.value_num  FROM UNNEST(l.custom_fields) f WHERE f.name = 'Ad budget'             LIMIT 1) AS ad_budget,
    (SELECT f.value_num  FROM UNNEST(l.custom_fields) f WHERE f.name = 'MER cap %'             LIMIT 1) AS mer_cap_pct,
    (SELECT f.value_text FROM UNNEST(l.custom_fields) f WHERE f.name = 'Mechanic'              LIMIT 1) AS mechanic,
    (SELECT f.value_num  FROM UNNEST(l.custom_fields) f WHERE f.name = 'Day multiplier'        LIMIT 1) AS day_multiplier,
    (SELECT f.value_text FROM UNNEST(l.custom_fields) f WHERE f.name = 'Coupon codes'          LIMIT 1) AS coupon_codes_raw,
    (SELECT f.value_text FROM UNNEST(l.custom_fields) f WHERE f.name = 'SKUs'                  LIMIT 1) AS skus_raw,
    (SELECT f.value_num  FROM UNNEST(l.custom_fields) f WHERE f.name = 'Target units'          LIMIT 1) AS target_units,
    (SELECT f.value_text FROM UNNEST(l.custom_fields) f WHERE f.name = 'UTM campaign'          LIMIT 1) AS utm_campaign_raw,
    (SELECT f.value_num  FROM UNNEST(l.custom_fields) f WHERE f.name = 'Target CM3'            LIMIT 1) AS target_cm3,
    (SELECT f.value_num  FROM UNNEST(l.custom_fields) f WHERE f.name = 'Target aMER'           LIMIT 1) AS target_amer,
    (SELECT f.value_num  FROM UNNEST(l.custom_fields) f WHERE f.name = 'aMER window days'      LIMIT 1) AS amer_window_days,
    (SELECT f.value_num  FROM UNNEST(l.custom_fields) f WHERE f.name = 'aMER min spend'        LIMIT 1) AS amer_min_spend,
    l.date_created,
    l.date_updated,
    l.ingested_at,
    l.snapshot_date
  FROM latest l
  JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
)
SELECT
  p.client_id,
  p.list_id,
  p.task_id,
  p.name,
  p.task_url,
  p.level,
  REGEXP_EXTRACT(p.name, r'^([FG]\d+) · ') AS phase_code,
  p.status,
  p.status_type,
  CASE
    WHEN p.level = 'Target state'        THEN IFNULL(p.status, '') != 'rejected'
    WHEN p.level IN ('Quarter', 'Month') THEN p.status = 'approved'
    WHEN p.level IS NOT NULL             THEN IFNULL(p.status, '') != 'rejected'
    ELSE FALSE
  END AS is_plan_valid,
  p.start_date,
  p.end_date,
  DATE_DIFF(p.end_date, p.start_date, DAY) + 1 AS window_days,
  p.currency,
  p.timezone,
  p.target_revenue,
  p.target_orders,
  p.target_new_customers,
  p.ad_budget,
  p.mer_cap_pct,
  p.mechanic,
  p.day_multiplier,
  ARRAY(SELECT UPPER(TRIM(x)) FROM UNNEST(SPLIT(IFNULL(p.coupon_codes_raw, ''), ',')) x
        WHERE TRIM(x) != '')                                   AS coupon_codes,
  ARRAY(SELECT TRIM(x) FROM UNNEST(SPLIT(IFNULL(p.skus_raw, ''), ',')) x
        WHERE TRIM(x) != '')                                   AS skus,
  p.target_units,
  ARRAY(SELECT LOWER(TRIM(x)) FROM UNNEST(SPLIT(IFNULL(p.utm_campaign_raw, ''), ',')) x
        WHERE TRIM(x) != '')                                   AS utm_campaigns,
  -- Locked names. Quarter and Month from Start (Due as fallback), Target state from Due.
  -- FORMAT_DATE('%B') is English in BigQuery.
  CASE p.level
    WHEN 'Quarter' THEN FORMAT('Q%d %d',
      EXTRACT(QUARTER FROM COALESCE(p.start_date, p.end_date)),
      EXTRACT(YEAR    FROM COALESCE(p.start_date, p.end_date)))
    WHEN 'Month'        THEN FORMAT_DATE('%B %Y', COALESCE(p.start_date, p.end_date))
    WHEN 'Target state' THEN FORMAT_DATE('Target state %m/%Y', p.end_date)
  END AS expected_name,
  CASE p.level
    WHEN 'Quarter' THEN TRIM(p.name) = FORMAT('Q%d %d',
      EXTRACT(QUARTER FROM COALESCE(p.start_date, p.end_date)),
      EXTRACT(YEAR    FROM COALESCE(p.start_date, p.end_date)))
    WHEN 'Month'        THEN TRIM(p.name) = FORMAT_DATE('%B %Y', COALESCE(p.start_date, p.end_date))
    WHEN 'Target state' THEN TRIM(p.name) = FORMAT_DATE('Target state %m/%Y', p.end_date)
    WHEN 'Promo'        THEN REGEXP_CONTAINS(p.name, r'^F\d+ · ')
    WHEN 'Checkpoint'   THEN REGEXP_CONTAINS(p.name, r'^G\d+ · ')
  END AS name_ok,
  p.date_created,
  p.date_updated,
  p.ingested_at,
  p.snapshot_date,
  -- 279f: CM3 and aMER fields (appended so existing column positions do not move)
  p.target_cm3,
  p.target_amer,
  SAFE_CAST(ROUND(p.amer_window_days) AS INT64) AS amer_window_days,
  p.amer_min_spend
FROM parsed p;


-- =============================================================================
-- 2. stg.stg_clickup_plan_versions
-- =============================================================================
-- One row per task per distinct state of the target fields. Consecutive snapshots with
-- the same fingerprint collapse into one version (gaps and islands); going back to an
-- earlier state is a new version.
--   valid_from   ClickUp side: version 1 = date_created, later versions = date_updated
--                of the first snapshot that shows the new values (the edit happened at or
--                before that moment, the loader sees it within the hour).
--   valid_to     valid_from of the next version, NULL for the current one.
--   observed_from / observed_to   when the loader first saw this version / the next one.
--   is_deleted   the task is not in stg.stg_clickup_plan (deleted in ClickUp, or its list
--                is no longer a registered active plan list). History is kept.
-- Fingerprint: level, status, start_date, end_date and every numeric target. Status is
-- included because approval is what turns a draft into the plan ("original vs current").
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_clickup_plan_versions` AS
WITH rows_ AS (
  SELECT
    t.client_id,
    t.task_id,
    t.task_name,
    t.status,
    t.ingested_at,
    t.date_created,
    t.date_updated,
    (SELECT IF(TRIM(IFNULL(f.value_text, '')) = f.name, NULL, f.value_text)
       FROM UNNEST(t.custom_fields) f WHERE f.name = 'Level' LIMIT 1)            AS level,
    DATE(TIMESTAMP_MILLIS(SAFE_CAST(JSON_VALUE(t.payload_json, '$.start_date') AS INT64)), c.timezone) AS start_date,
    DATE(TIMESTAMP_MILLIS(SAFE_CAST(JSON_VALUE(t.payload_json, '$.due_date')   AS INT64)), c.timezone) AS end_date,
    (SELECT f.value_num FROM UNNEST(t.custom_fields) f WHERE f.name = 'Target revenue ex VAT' LIMIT 1) AS target_revenue,
    (SELECT f.value_num FROM UNNEST(t.custom_fields) f WHERE f.name = 'Target orders'         LIMIT 1) AS target_orders,
    (SELECT f.value_num FROM UNNEST(t.custom_fields) f WHERE f.name = 'Target new customers'  LIMIT 1) AS target_new_customers,
    (SELECT f.value_num FROM UNNEST(t.custom_fields) f WHERE f.name = 'Ad budget'             LIMIT 1) AS ad_budget,
    (SELECT f.value_num FROM UNNEST(t.custom_fields) f WHERE f.name = 'MER cap %'             LIMIT 1) AS mer_cap_pct,
    (SELECT f.value_num FROM UNNEST(t.custom_fields) f WHERE f.name = 'Day multiplier'        LIMIT 1) AS day_multiplier,
    (SELECT f.value_num FROM UNNEST(t.custom_fields) f WHERE f.name = 'Target units'          LIMIT 1) AS target_units,
    (SELECT f.value_num FROM UNNEST(t.custom_fields) f WHERE f.name = 'Target CM3'            LIMIT 1) AS target_cm3,
    (SELECT f.value_num FROM UNNEST(t.custom_fields) f WHERE f.name = 'Target aMER'           LIMIT 1) AS target_amer,
    (SELECT f.value_num FROM UNNEST(t.custom_fields) f WHERE f.name = 'aMER window days'      LIMIT 1) AS amer_window_days,
    (SELECT f.value_num FROM UNNEST(t.custom_fields) f WHERE f.name = 'aMER min spend'        LIMIT 1) AS amer_min_spend
  FROM `oneeighty-warehouse.raw.raw_clickup_tasks` t
  JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
  WHERE t.snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
    AND t.list_kind = 'promo'
),
fp AS (
  SELECT *,
    -- 279f: the four new fields extend the fingerprint only when one is set, so every
    -- fingerprint (and every version boundary) of the history before 279f is unchanged.
    CONCAT(
      TO_JSON_STRING(STRUCT(level, status, start_date, end_date, target_revenue, target_orders,
        target_new_customers, ad_budget, mer_cap_pct, day_multiplier, target_units)),
      IF(target_cm3 IS NULL AND target_amer IS NULL AND amer_window_days IS NULL AND amer_min_spend IS NULL, '',
         TO_JSON_STRING(STRUCT(target_cm3, target_amer, amer_window_days, amer_min_spend)))) AS fingerprint
  FROM rows_
),
flagged AS (
  SELECT *,
    IF(fingerprint = LAG(fingerprint) OVER w, 0, 1) AS is_change
  FROM fp
  WINDOW w AS (PARTITION BY client_id, task_id ORDER BY ingested_at)
),
numbered AS (
  SELECT *, SUM(is_change) OVER (PARTITION BY client_id, task_id ORDER BY ingested_at) AS version_no
  FROM flagged
),
versions AS (
  SELECT
    client_id, task_id, version_no,
    ARRAY_AGG(STRUCT(task_name, status, level, start_date, end_date, target_revenue, target_orders,
      target_new_customers, ad_budget, mer_cap_pct, day_multiplier, target_units,
      date_created, date_updated, fingerprint,
      target_cm3, target_amer, amer_window_days, amer_min_spend) ORDER BY ingested_at LIMIT 1)[OFFSET(0)] AS v,
    MIN(ingested_at) AS observed_from
  FROM numbered
  GROUP BY client_id, task_id, version_no
)
SELECT
  x.client_id,
  x.task_id,
  x.version_no,
  x.v.task_name AS name,
  x.v.level,
  x.v.status,
  x.v.start_date,
  x.v.end_date,
  x.v.target_revenue,
  x.v.target_orders,
  x.v.target_new_customers,
  x.v.ad_budget,
  x.v.mer_cap_pct,
  x.v.day_multiplier,
  x.v.target_units,
  IF(x.version_no = 1, x.v.date_created, x.v.date_updated)                       AS valid_from,
  LEAD(IF(x.version_no = 1, x.v.date_created, x.v.date_updated))
    OVER (PARTITION BY x.client_id, x.task_id ORDER BY x.version_no)             AS valid_to,
  x.observed_from,
  LEAD(x.observed_from) OVER (PARTITION BY x.client_id, x.task_id ORDER BY x.version_no) AS observed_to,
  x.version_no = MAX(x.version_no) OVER (PARTITION BY x.client_id, x.task_id)     AS is_current,
  p.task_id IS NULL                                                              AS is_deleted,
  x.v.fingerprint,
  x.v.target_cm3,
  x.v.target_amer,
  SAFE_CAST(ROUND(x.v.amer_window_days) AS INT64)                                AS amer_window_days,
  x.v.amer_min_spend
FROM versions x
LEFT JOIN (SELECT client_id, task_id FROM `oneeighty-warehouse.stg.stg_clickup_plan`) p
  USING (client_id, task_id);


-- =============================================================================
-- 3. mart.plan_input_v (279e + the four fields)
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_input_v` AS
WITH
seed_all AS (
  SELECT client_id, task_id, level, name, start_date, end_date, LOWER(TRIM(status)) AS status,
         target_revenue, target_orders, target_new_customers, ad_budget, mer_cap_pct,
         mechanic, day_multiplier, coupon_codes, skus, target_units, utm_campaign,
         version, version_at, is_seed, note,
         LOWER(TRIM(status)) AS version_status,
         -- 279f: the seed never carries the CM3 / aMER fields (ClickUp only)
         CAST(NULL AS NUMERIC) AS target_cm3, CAST(NULL AS FLOAT64) AS target_amer,
         CAST(NULL AS INT64) AS amer_window_days, CAST(NULL AS NUMERIC) AS amer_min_spend
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
         v.valid_from                                       AS version_at,
         CAST(v.target_cm3 AS NUMERIC)                      AS target_cm3,
         CAST(v.target_amer AS FLOAT64)                     AS target_amer,
         v.amer_window_days,
         CAST(v.amer_min_spend AS NUMERIC)                  AS amer_min_spend
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
    l.version_status,
    l.target_cm3, l.target_amer, l.amer_window_days, l.amer_min_spend   -- no seed fallback
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
  o.ad_budget            AS orig_ad_budget,
  -- 279f (appended): CM3 and aMER targets and checkpoint qualifiers, ClickUp only
  c.target_cm3,
  c.target_amer,
  c.amer_window_days,
  c.amer_min_spend,
  o.target_cm3           AS orig_target_cm3,
  o.target_amer          AS orig_target_amer
FROM ranked c
JOIN ranked o
  ON o.client_id = c.client_id AND o.task_id = c.task_id AND o.rn_orig = 1
WHERE c.rn_cur = 1;

CALL `oneeighty-warehouse.mart.sp_refresh_plan_pacing`();
