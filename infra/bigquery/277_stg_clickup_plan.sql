-- 277_stg_clickup_plan.sql
-- Purpose:   staging for the plan lists (ref.clickup_lists.list_kind = 'promo'):
--            stg.stg_clickup_plan          one row per task present in the LATEST load of
--                                          each registered plan list
--            stg.stg_clickup_plan_versions one row per task per distinct state of the
--                                          target fields, from the full snapshot history
--            (section 3, PROPOSED ONLY) the swap of mart.plan_input (270) from
--            ref.plan_seed to these views.
-- Based on:  live raw.raw_clickup_tasks / raw.raw_clickup_fields (220, unchanged),
--            live stg.stg_clickup_tasks placeholder rule, ref.clients.timezone,
--            live mart.plan_input (270, deployed 2026-10-06 ~12:30 UTC, read from repo
--            oe-dash-wt/pp1-plan-pacing). Fields per projects/promo-pacing/
--            05-ARCHITEKTURA.md section A (English names). Read on 2026-10-06.
-- Affected:  sections 1 and 2 create new views only: no existing view changes, no
--            regression diff. Section 3 changes mart.plan_input: see its own header.
-- Tested:    as mart_qa.pp3_stg_clickup_plan, mart_qa.pp3_stg_clickup_plan_versions and
--            mart_qa.pp3_plan_input_candidate (same SQL, dataset swapped), results in
--            projects/promo-pacing/raw/08-pp3-report.md.
-- Deploy:    the hourly loader is active (n8n wf_clickup_to_bigquery, id UHK8312UpMEEtnLm).
--            1. sections 1 and 2 as is, 2. 278, 3. section 3 only after owner OK.
--
-- Conventions
-- - Native ClickUp dates (start_date, due_date) are epoch ms. The team sets them as
--   dates, ClickUp stores 04:00 Europe/Prague, so DATE(TIMESTAMP_MILLIS(ms), timezone)
--   gives the intended calendar day. timezone comes from ref.clients.
-- - Fields are read BY NAME (same as stg_clickup_ad_tasks). A missing field (for example
--   `MER cap %`, `UTM campaign` today) simply yields NULL / [].
-- - Presence. The loader writes plan lists in FULL on every hourly run (tasks and field
--   definitions). The newest ingested_at of a list (tasks or fields) is its latest load,
--   and only tasks in that load are in stg_clickup_plan. A task deleted in ClickUp, or a
--   list that is no longer registered/active in ref.clickup_lists, disappears on the next
--   run. Version history keeps everything and flags it is_deleted.
-- - The latest load is searched in the last 14 days of partitions only (cost: the plan
--   views run hourly). If a list had no successful load for 14 days its tasks drop out of
--   stg_clickup_plan; by then /health has shown the sync failing for two weeks.
-- - is_plan_valid encodes the owner rule of 2026-10-06 (one period = one task):
--   Target state counts unless rejected (status planning is the ambitious line),
--   Quarter and Month count only when approved, Promo and Checkpoint unless rejected.
-- - The locked prefixes are `F<n> · ` and `G<n> · ` (middle dot U+00B7).

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
  p.snapshot_date
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
    (SELECT f.value_num FROM UNNEST(t.custom_fields) f WHERE f.name = 'Target units'          LIMIT 1) AS target_units
  FROM `oneeighty-warehouse.raw.raw_clickup_tasks` t
  JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
  WHERE t.snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
    AND t.list_kind = 'promo'
),
fp AS (
  SELECT *,
    TO_JSON_STRING(STRUCT(level, status, start_date, end_date, target_revenue, target_orders,
      target_new_customers, ad_budget, mer_cap_pct, day_multiplier, target_units)) AS fingerprint
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
      date_created, date_updated, fingerprint) ORDER BY ingested_at LIMIT 1)[OFFSET(0)] AS v,
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
  x.v.fingerprint
FROM versions x
LEFT JOIN (SELECT client_id, task_id FROM `oneeighty-warehouse.stg.stg_clickup_plan`) p
  USING (client_id, task_id);


-- =============================================================================
-- 3. PROPOSED, NOT DEPLOYED: swap mart.plan_input (270) to the loader
-- =============================================================================
-- Owner OK needed. Same output columns as live mart.plan_input, so 271 to 276 do not
-- change. Only the `src` CTE differs from 270:
--   * one src row per task version from stg_clickup_plan_versions, for tasks that are in
--     stg_clickup_plan (present in the latest load); version = version_no,
--     version_at = valid_from, is_seed = FALSE. Mechanic, Coupon codes, SKUs and UTM
--     campaign come from the current task (they are not versioned).
--   * ref.plan_seed rows stay ONLY for task_ids the loader does not return.
-- Value differences to expect (checked in mart_qa.pp3_plan_input_candidate, see report):
--   * seed-only values disappear: Target new customers on the Ethia Months and MER cap %
--     (the field does not exist in ClickUp yet). Enter them in ClickUp first, or accept.
--   * is_valid keeps 270's rule (approved or done). The new owner rule (Target state
--     counts unless rejected) lives in stg.is_plan_valid; 271/273 must read it there or
--     270 must adopt it: decision for the pp1 owner.
--
-- CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_input` AS
-- WITH
-- loader AS (
--   SELECT v.client_id, v.task_id, v.level, v.name, v.start_date, v.end_date,
--          LOWER(TRIM(v.status)) AS status,
--          CAST(v.target_revenue AS NUMERIC)                  AS target_revenue,
--          SAFE_CAST(ROUND(v.target_orders) AS INT64)         AS target_orders,
--          SAFE_CAST(ROUND(v.target_new_customers) AS INT64)  AS target_new_customers,
--          CAST(v.ad_budget AS NUMERIC)                       AS ad_budget,
--          CAST(v.mer_cap_pct AS FLOAT64)                     AS mer_cap_pct,
--          p.mechanic,
--          CAST(v.day_multiplier AS FLOAT64)                  AS day_multiplier,
--          NULLIF(ARRAY_TO_STRING(p.coupon_codes, ', '), '')  AS coupon_codes,
--          NULLIF(ARRAY_TO_STRING(p.skus, ', '), '')          AS skus,
--          SAFE_CAST(ROUND(v.target_units) AS INT64)          AS target_units,
--          NULLIF(ARRAY_TO_STRING(p.utm_campaigns, ', '), '') AS utm_campaign,
--          v.version_no                                       AS version,
--          v.valid_from                                       AS version_at,
--          FALSE                                              AS is_seed,
--          CAST(NULL AS STRING)                               AS note
--   FROM `oneeighty-warehouse.stg.stg_clickup_plan_versions` v
--   JOIN `oneeighty-warehouse.stg.stg_clickup_plan` p USING (client_id, task_id)
-- ),
-- src AS (
--   SELECT * FROM loader
--   UNION ALL
--   SELECT client_id, task_id, level, name, start_date, end_date, LOWER(TRIM(status)) AS status,
--          target_revenue, target_orders, target_new_customers, ad_budget, mer_cap_pct,
--          mechanic, day_multiplier, coupon_codes, skus, target_units, utm_campaign,
--          version, version_at, is_seed, note
--   FROM `oneeighty-warehouse.ref.plan_seed` s
--   WHERE NOT EXISTS (SELECT 1 FROM loader l WHERE l.client_id = s.client_id AND l.task_id = s.task_id)
-- ),
-- ranked AS (
--   SELECT s.*,
--          ROW_NUMBER() OVER (PARTITION BY client_id, task_id ORDER BY version DESC, version_at DESC) AS rn_cur,
--          ROW_NUMBER() OVER (PARTITION BY client_id, task_id
--                             ORDER BY IF(status IN ('approved', 'done'), 0, 1), version, version_at) AS rn_orig
--   FROM src s
-- )
-- SELECT
--   c.client_id, c.task_id, c.level, c.name, c.start_date, c.end_date, c.status,
--   c.status IN ('approved', 'done') AS is_valid,
--   c.target_revenue, c.target_orders, c.target_new_customers, c.ad_budget, c.mer_cap_pct,
--   c.mechanic, c.day_multiplier, c.coupon_codes, c.skus, c.target_units, c.utm_campaign,
--   c.version, c.version_at, c.is_seed, c.note,
--   o.version              AS version_original,
--   o.target_revenue       AS orig_target_revenue,
--   o.target_orders        AS orig_target_orders,
--   o.target_new_customers AS orig_target_new_customers,
--   o.ad_budget            AS orig_ad_budget
-- FROM ranked c
-- JOIN ranked o
--   ON o.client_id = c.client_id AND o.task_id = c.task_id AND o.rn_orig = 1
-- WHERE c.rn_cur = 1;
