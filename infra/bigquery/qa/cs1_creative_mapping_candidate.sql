-- cs1_creative_mapping_candidate.sql
-- QA candidate for migration 280 (creative mapping). Writes ONLY to mart_qa, prefix cs1_.
-- Reads live stg/ref. Compare cs1_creative_tags with ref.creative_tags before any deploy.

-- Name key v2: the v1 key plus three normalisations that change spelling, never meaning.
--   1. Dates: 17AUG, 17AUG-26, 17AUGUST, 2026-08-17 are one date and become one token (d0817).
--      Two different dates stay two different tokens.
--   2. Meta's duplicate suffix (" - Copy", " - Copy 2") is dropped: Ads Manager appends it
--      when an ad is duplicated into another ad set, the creative is the same.
--   3. STATIC and STAT are the same format code.
-- Versions (v1/v2), stages, markets and every other word are kept.
CREATE TEMP FUNCTION month_dates(s STRING) AS (
  REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
  REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
    REGEXP_REPLACE(s, r'(20\d{2})-(\d{2})-(\d{2})', r' D\2_\3 '),
    r'(?i)(\d{1,2})JAN[A-Z]*(-\d{2}\b)?', r' D01_\1 '), r'(?i)(\d{1,2})FEB[A-Z]*(-\d{2}\b)?', r' D02_\1 '),
    r'(?i)(\d{1,2})MAR[A-Z]*(-\d{2}\b)?', r' D03_\1 '), r'(?i)(\d{1,2})APR[A-Z]*(-\d{2}\b)?', r' D04_\1 '),
    r'(?i)(\d{1,2})MAY[A-Z]*(-\d{2}\b)?', r' D05_\1 '), r'(?i)(\d{1,2})JUN[A-Z]*(-\d{2}\b)?', r' D06_\1 '),
    r'(?i)(\d{1,2})JUL[A-Z]*(-\d{2}\b)?', r' D07_\1 '), r'(?i)(\d{1,2})AUG[A-Z]*(-\d{2}\b)?', r' D08_\1 '),
    r'(?i)(\d{1,2})SEP[A-Z]*(-\d{2}\b)?', r' D09_\1 '), r'(?i)(\d{1,2})OCT[A-Z]*(-\d{2}\b)?', r' D10_\1 '),
    r'(?i)(\d{1,2})NOV[A-Z]*(-\d{2}\b)?', r' D11_\1 '), r'(?i)(\d{1,2})DEC[A-Z]*(-\d{2}\b)?', r' D12_\1 ')
);
CREATE TEMP FUNCTION name_key_v2(s STRING) AS ((
  SELECT ARRAY_TO_STRING(ARRAY(
    SELECT CASE WHEN tok = 'static' THEN 'stat' ELSE tok END
    FROM UNNEST(SPLIT(
      REGEXP_REPLACE(
        LOWER(REGEXP_REPLACE(NORMALIZE(
          REGEXP_REPLACE(
            month_dates(REGEXP_REPLACE(IFNULL(s, ''), r'(?i)\s*[-–]\s*copy(\s*\d+)?\s*$', '')),
            r'D(\d{2})_0?(\d{1,2})', r'd\1\2'),
          NFD), r'\p{Mn}', '')),
        r'[^a-z0-9]+', ' '), ' ')) AS tok WITH OFFSET o
    WHERE tok != '' AND tok != 'i'
    ORDER BY o), ' ')
));
-- The same key without a trailing market code. Used only for the market-variant arm.
CREATE TEMP FUNCTION strip_market(k STRING) AS (
  REGEXP_REPLACE(k, r'( (cz|sk|hu|pl|ro|de|at|us|ca|uk|eu|both))+$', '')
);
CREATE TEMP FUNCTION market_of(k STRING) AS (
  UPPER(REGEXP_REPLACE(REGEXP_EXTRACT(k, r'((?: (?:cz|sk|hu|pl|ro|de|at|us|ca|uk|eu|both))+)$'), r'^ ', ''))
);

-- 1. Relationship fields resolved by TARGET LIST, not by name.
--    A client's concept link is the relationship field on its ad pipeline that points at its
--    own registered concept list. Template copies leave fields named `Concept` pointing at
--    another client's list; those are ignored because their target is not this client's list.
--    A curated row in ref.clickup_field_map still wins.
CREATE OR REPLACE TABLE `oneeighty-warehouse.mart_qa.cs1_rel_fields` AS
WITH own AS (
  SELECT f.client_id, f.list_kind, f.field_id, f.name, f.target_list_id, l.list_kind AS target_kind
  FROM `oneeighty-warehouse.stg.stg_clickup_fields` f
  JOIN `oneeighty-warehouse.ref.clickup_lists` l
    ON l.client_id = f.client_id AND l.list_id = f.target_list_id AND l.active
  WHERE f.type = 'list_relationship'
), derived AS (
  SELECT client_id, 'ad_pipeline' AS list_kind, 'concept_rel' AS logical,
         ANY_VALUE(field_id) AS field_id, COUNT(*) AS n
  FROM own WHERE list_kind = 'ad_pipeline' AND target_kind = 'concepts' GROUP BY client_id
  UNION ALL
  SELECT client_id, 'concepts', 'persona_rel', ANY_VALUE(field_id), COUNT(*)
  FROM own WHERE list_kind = 'concepts' AND target_kind = 'personas' GROUP BY client_id
)
SELECT d.client_id, d.list_kind, d.logical,
       COALESCE(m.field_id, IF(d.n = 1, d.field_id, NULL)) AS field_id,
       IF(m.field_id IS NOT NULL, 'curated', IF(d.n = 1, 'target_list', 'ambiguous')) AS source
FROM derived d
LEFT JOIN `oneeighty-warehouse.ref.clickup_field_map` m
  ON m.client_id = d.client_id AND m.list_kind = d.list_kind AND m.logical = d.logical;

-- 2. Concepts with persona resolved through persona_rel.
CREATE OR REPLACE TABLE `oneeighty-warehouse.mart_qa.cs1_concepts` AS
WITH raw AS (
  SELECT t.client_id, t.task_id, t.task_name, t.task_url, t.status, DATE(t.date_created) AS created_at,
    ARRAY(SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Angle' AND f.value_text IS NOT NULL) AS angles,
    ARRAY(SELECT id FROM UNNEST(t.custom_fields) f, UNNEST(f.value_ids) id WHERE f.field_id = r.field_id) AS persona_ids,
    (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Offer' LIMIT 1) AS offer,
    (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Hypothesis' LIMIT 1) AS hypothesis,
    (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Concept ID' LIMIT 1) AS explicit_id
  FROM `oneeighty-warehouse.stg.stg_clickup_tasks` t
  LEFT JOIN `oneeighty-warehouse.mart_qa.cs1_rel_fields` r
    ON r.client_id = t.client_id AND r.list_kind = 'concepts' AND r.logical = 'persona_rel'
  WHERE t.list_kind = 'concepts'
)
SELECT client_id,
  COALESCE(NULLIF(TRIM(explicit_id), ''), REGEXP_EXTRACT(task_name, r'\b(C\d{2,3}|[A-Z]{2,4}-K\d{1,3}|K\d{1,3})\b'), task_id) AS concept_id,
  COALESCE(NULLIF(TRIM(explicit_id), ''), REGEXP_EXTRACT(task_name, r'\b(C\d{2,3}|[A-Z]{2,4}-K\d{1,3}|K\d{1,3})\b')) AS concept_code,
  task_name AS name, persona_ids[SAFE_OFFSET(0)] AS persona_id, angles[SAFE_OFFSET(0)] AS angle,
  offer, hypothesis, status, created_at, task_id AS clickup_task_id, task_url AS clickup_url,
  (ARRAY_LENGTH(angles) > 1 OR ARRAY_LENGTH(persona_ids) > 1) AS multi_valued
FROM raw;

-- 3. Ad tasks with the concept link resolved through concept_rel.
CREATE OR REPLACE TABLE `oneeighty-warehouse.mart_qa.cs1_ad_tasks` AS
SELECT a.* EXCEPT (concept_task_id),
  (SELECT f.value_ids[SAFE_OFFSET(0)] FROM UNNEST(t.custom_fields) f WHERE f.field_id = r.field_id LIMIT 1) AS concept_task_id
FROM `oneeighty-warehouse.stg.stg_clickup_ad_tasks` a
JOIN `oneeighty-warehouse.stg.stg_clickup_tasks` t ON t.client_id = a.client_id AND t.task_id = a.task_id
LEFT JOIN `oneeighty-warehouse.mart_qa.cs1_rel_fields` r
  ON r.client_id = a.client_id AND r.list_kind = 'ad_pipeline' AND r.logical = 'concept_rel';

-- 4. Tags: stated id, then exact name, then normalised name, then market variant.
CREATE OR REPLACE TABLE `oneeighty-warehouse.mart_qa.cs1_creative_tags` AS
WITH ads AS (
  SELECT client_id, ad_id, MAX_BY(ad_name, date_start) AS ad_name
  FROM `oneeighty-warehouse.stg.stg_meta_ad_insights` WHERE ad_name IS NOT NULL
  GROUP BY client_id, ad_id
),
tasks AS (
  SELECT a.*,
    `oneeighty-warehouse.ref.creative_name_key`(a.task_name) AS k1,
    name_key_v2(a.task_name) AS k2,
    strip_market(name_key_v2(a.task_name)) AS k3
  FROM `oneeighty-warehouse.mart_qa.cs1_ad_tasks` a
  WHERE a.task_name IS NOT NULL
    -- the unfilled brief template is not a name
    AND NOT REGEXP_CONTAINS(a.task_name, r'PersonaID-NAME|STAGE \| FORMAT')
),
u1 AS (SELECT client_id, k1 AS k, ANY_VALUE(task_id) AS tid FROM tasks WHERE k1 != '' GROUP BY 1, 2 HAVING COUNT(DISTINCT task_id) = 1),
u2 AS (SELECT client_id, k2 AS k, ANY_VALUE(task_id) AS tid FROM tasks WHERE k2 != '' GROUP BY 1, 2 HAVING COUNT(DISTINCT task_id) = 1),
u3 AS (SELECT client_id, k3 AS k, ANY_VALUE(task_id) AS tid FROM tasks WHERE k3 != '' GROUP BY 1, 2 HAVING COUNT(DISTINCT task_id) = 1),
by_id AS (
  -- Only ids that exist as ads. A number typed into Creative ID that is not an ad id
  -- (a post or media id) is reported, not turned into a phantom tag.
  SELECT a.client_id, TRIM(x) AS ad_id, a.task_id, 'creative_id' AS match_method, 1.00 AS conf, 1 AS rk
  FROM `oneeighty-warehouse.mart_qa.cs1_ad_tasks` a, UNNEST(SPLIT(IFNULL(a.creative_id_raw, ''), ',')) x
  JOIN ads d ON d.client_id = a.client_id AND d.ad_id = TRIM(REGEXP_REPLACE(x, r'[^0-9]', ''))
),
by_name AS (
  SELECT d.client_id, d.ad_id, u.tid, 'name_exact', 0.95, 2
  FROM ads d JOIN u1 u ON u.client_id = d.client_id AND u.k = `oneeighty-warehouse.ref.creative_name_key`(d.ad_name)
  UNION ALL
  SELECT d.client_id, d.ad_id, u.tid, 'name_normalised', 0.90, 3
  FROM ads d JOIN u2 u ON u.client_id = d.client_id AND u.k = name_key_v2(d.ad_name)
  UNION ALL
  -- Same brief launched in another market: concept, persona, angle and offer are the
  -- same; market is read off the ad's own name.
  SELECT d.client_id, d.ad_id, u.tid, 'name_market_variant', 0.85, 4
  FROM ads d JOIN u3 u ON u.client_id = d.client_id AND u.k = strip_market(name_key_v2(d.ad_name))
  WHERE market_of(name_key_v2(d.ad_name)) IS NOT NULL
),
matched AS (
  SELECT * FROM by_id UNION ALL SELECT * FROM by_name
)
SELECT m.client_id, m.ad_id, t.task_id AS clickup_task_id, t.task_url AS clickup_url,
  cn.concept_id, cn.persona_id, cn.angle, cn.offer,
  REGEXP_EXTRACT(UPPER(IFNULL(t.task_name, '')), r'\b(TOF|MOF|BOF)\b') AS stage,
  m.match_method, CAST(m.conf AS NUMERIC) AS match_confidence,
  IF(m.match_method = 'name_market_variant', market_of(name_key_v2(d.ad_name)), NULL) AS market_from_name,
  d.ad_name, t.task_name
FROM matched m
JOIN tasks t ON t.client_id = m.client_id AND t.task_id = m.task_id
JOIN ads d ON d.client_id = m.client_id AND d.ad_id = m.ad_id
LEFT JOIN `oneeighty-warehouse.mart_qa.cs1_concepts` cn
  ON cn.client_id = t.client_id AND cn.clickup_task_id = t.concept_task_id
QUALIFY ROW_NUMBER() OVER (PARTITION BY m.client_id, m.ad_id ORDER BY m.rk, t.created_date DESC, t.task_id) = 1;
