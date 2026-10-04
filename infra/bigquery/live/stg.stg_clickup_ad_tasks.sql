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
  --
  -- ── Why the field map is joined OUTSIDE the subquery ────────────────────
  -- The obvious shape puts the JOIN to clickup_field_map inside the
  -- UNNEST subquery. BigQuery rejects that outright:
  --
  --   Correlated subqueries that reference other tables are not supported
  --   unless they can be de-correlated
  --
  -- because the subquery would be correlated on t.client_id *and* reach a
  -- second table. Joining the map at the top level first makes m.field_id an
  -- ordinary column of the current row, so the subquery reads only its own
  -- UNNEST and one scalar. Same result, and it parses.
  (SELECT f.value_ids[SAFE_OFFSET(0)]
     FROM UNNEST(t.custom_fields) f
    WHERE f.field_id = m.field_id
    LIMIT 1) AS concept_task_id
FROM `oneeighty-warehouse.stg.stg_clickup_tasks` t
-- LEFT, not INNER: a client with no concept_rel row in the map still has ads,
-- and dropping them would make an unmapped account look like an empty one.
LEFT JOIN `oneeighty-warehouse.ref.clickup_field_map` m
  ON  m.client_id = t.client_id
  AND m.list_kind = 'ad_pipeline'
  AND m.logical   = 'concept_rel'
WHERE t.list_kind = 'ad_pipeline';
