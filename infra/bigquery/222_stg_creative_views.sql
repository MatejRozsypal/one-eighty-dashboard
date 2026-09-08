-- 222_stg_creative_views.sql
-- Creative Engine, phase 1d: staging views.
--
-- Same dedupe pattern as 200_create_stg_views.sql throughout: newest row per
-- natural key by ingested_at. The partition filter is in every view because
-- every underlying table sets require_partition_filter = TRUE.
--
-- Run order: AFTER 219, 220, 221.

-- =============================================================================
-- CREATIVES — newest snapshot per (client_id, ad_id)
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_meta_ad_creatives` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, ad_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_meta_ad_creatives`
  WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

-- =============================================================================
-- AD SET INSIGHTS — newest row per (client_id, adset_id, date_start)
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_meta_adset_insights` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, adset_id, date_start ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_meta_adset_insights`
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

-- =============================================================================
-- BREAKDOWNS — newest row per (client_id, ad_id, date, bucket)
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_meta_ad_breakdown_demo` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY client_id, ad_id, date_start, age, gender ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_meta_ad_breakdown_demo`
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_meta_ad_breakdown_placement` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY client_id, ad_id, date_start, publisher_platform, platform_position, impression_device
    ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_meta_ad_breakdown_placement`
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

-- =============================================================================
-- CLICKUP FIELD DEFINITIONS — newest snapshot per (client_id, list_id, field_id)
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_clickup_fields` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY client_id, list_id, field_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_clickup_fields`
  WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

-- =============================================================================
-- CLICKUP TASKS — newest snapshot per (client_id, task_id)
-- =============================================================================
-- The placeholder guard lives here rather than in the loader so that ANY reader
-- of this view is protected: `Creative ID` holds the literal string
-- "Creative ID" on all 65 Manami tasks. It is a field name that leaked into the
-- data, and treating it as an ad id would create a phantom ad that joins to
-- nothing and appears in every breakdown as an untagged row.
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_clickup_tasks` AS
SELECT
  * EXCEPT(rn, custom_fields),
  ARRAY(
    SELECT AS STRUCT
      f.field_id, f.name, f.type,
      -- A value equal to its own field's name is a placeholder, not data.
      IF(TRIM(IFNULL(f.value_text, '')) = f.name, NULL, f.value_text) AS value_text,
      f.value_num, f.value_ids
    FROM UNNEST(custom_fields) AS f
  ) AS custom_fields
FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, task_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_clickup_tasks`
  WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

-- Convenience: one row per ad-pipeline task with the fields the Unmapped queue
-- needs, flattened. Written as a view so the queue's candidate list and the
-- sync's own matcher cannot drift apart.
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_clickup_ad_tasks` AS
SELECT
  t.client_id,
  t.task_id,
  t.task_name,
  t.task_url,
  t.status,
  t.status_type,
  DATE(t.date_created) AS created_date,
  (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Creative ID' LIMIT 1) AS creative_id_raw,
  (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Content Format' LIMIT 1) AS content_format,
  (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Content Purpose' LIMIT 1) AS content_purpose,
  (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Market' LIMIT 1) AS market,
  (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Body' LIMIT 1) AS body_code,
  (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Hook' LIMIT 1) AS hook_code,
  (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Production method' LIMIT 1) AS production_method,
  (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Creator' LIMIT 1) AS creator_name,
  (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Creator type' LIMIT 1) AS creator_type,
  (SELECT f.value_num  FROM UNNEST(t.custom_fields) f WHERE f.name = 'Production cost' LIMIT 1) AS production_cost,
  (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Brief' LIMIT 1) AS brief_url,
  -- Resolved through the field map, so Venev's stale Manami-pointing `Concept`
  -- field is ignored even while it exists. Any other relationship field is not
  -- consulted at all.
  (SELECT f.value_ids[SAFE_OFFSET(0)]
     FROM UNNEST(t.custom_fields) f
     JOIN `oneeighty-warehouse.ref.clickup_field_map` m
       ON m.field_id = f.field_id AND m.client_id = t.client_id AND m.logical = 'concept_rel'
    LIMIT 1) AS concept_task_id
FROM `oneeighty-warehouse.stg.stg_clickup_tasks` t
WHERE t.list_kind = 'ad_pipeline';
