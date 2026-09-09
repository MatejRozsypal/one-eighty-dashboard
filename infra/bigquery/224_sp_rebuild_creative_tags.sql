-- 224_sp_rebuild_creative_tags.sql
-- Creative Engine, phase 1f: the tag rebuild, as a stored procedure.
--
-- ── Why a procedure rather than SQL pasted into an n8n node ────────────────
-- This logic is the product. It decides which ad belongs to which concept, and
-- therefore what every persona, angle and offer figure on five screens means.
-- Pasted into a workflow node it would be un-reviewable, un-diffable, and would
-- silently fork the day somebody edits it in the n8n UI at 23:00. Here it is a
-- file, and the workflow's job shrinks to `CALL ref.sp_rebuild_creative_tags()`.
--
-- Rebuilds ref.personas, ref.concepts, ref.creators and ref.creative_tags in
-- full on every run, and appends anything it refused to guess at to
-- ops.clickup_sync_issues.
--
-- Run order: AFTER 222.

-- =============================================================================
-- NAME KEY — the one normalisation both sides of the name match go through
-- =============================================================================
-- An ad name and a ClickUp task name are written by the same person under the
-- same convention, and are meant to be the same string. In practice they differ
-- by a doubled space, a stray trailing colon, a `|` typed as an `I`, or a
-- diacritic dropped on one side. None of those are differences of meaning, and
-- every one of them costs a whole ad's worth of tagging.
--
-- So the key is the name reduced to what a person reads it as: lower case,
-- diacritics stripped, punctuation gone, and the bare token `i` removed —
-- because in this account `I` is used as a pipe (`Testery I TOF I STAT I CZ`)
-- and the two spellings must land on the same key.
--
-- Deliberately NOT normalised away: dates, stage tokens, version numbers and
-- market codes. `... | 13AUG | ...` and `... | 4SEP | ...` are two different
-- creatives and must stay two different keys — collapsing them would attach one
-- ad's spend to another ad's concept, which no figure on any screen would look
-- wrong enough to reveal.
CREATE OR REPLACE FUNCTION `oneeighty-warehouse.ref.creative_name_key`(s STRING)
RETURNS STRING AS ((
  ARRAY_TO_STRING(ARRAY(
    SELECT tok
    FROM UNNEST(SPLIT(
      REGEXP_REPLACE(
        LOWER(REGEXP_REPLACE(NORMALIZE(IFNULL(s, ''), NFD), r'\p{Mn}', '')),
        r'[^a-z0-9]+', ' '), ' ')) AS tok
    WHERE tok != '' AND tok != 'i'), ' ')
));

CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.ref.sp_rebuild_creative_tags`()
BEGIN
  DECLARE run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP();

  -- ===========================================================================
  -- FIELD MAP — refresh the mechanical half, validate the curated half
  -- ===========================================================================
  -- Plain-value fields (short_text, drop_down, url, number) are matched by NAME
  -- and refreshed automatically: they are space-level, shared across clients,
  -- and a rename is the only thing that moves them.
  --
  -- RELATIONSHIP FIELDS ARE NEVER AUTO-DISCOVERED. Venev's ad pipeline carries
  -- two of them, and the one plainly called `Concept` points at MANAMI's concept
  -- list. Auto-discovery by name would pick exactly the wrong one and attach one
  -- brand's ads to another brand's concepts, which no figure on any screen would
  -- look odd enough to reveal. Those rows stay curated in ref.clickup_field_map;
  -- this only checks that the pinned field still exists and reports any second
  -- relationship field it finds beside it.
  MERGE `oneeighty-warehouse.ref.clickup_field_map` T
  USING (
    SELECT
      f.client_id, f.list_kind,
      CASE f.name
        WHEN 'Creative ID'       THEN 'creative_id'
        WHEN 'Content Format'    THEN 'content_format'
        WHEN 'Content Purpose'   THEN 'production_type'
        WHEN 'Market'            THEN 'market'
        WHEN 'Visual Type'       THEN 'visual_type'
        WHEN 'Offer'             THEN 'offer'
        WHEN 'Production method' THEN 'production_method'
        WHEN 'Creator'           THEN 'creator'
        WHEN 'Creator type'      THEN 'creator_type'
        WHEN 'Body'              THEN 'body'
        WHEN 'Hook'              THEN 'hook'
        WHEN 'Production cost'   THEN 'production_cost'
        WHEN 'Brief'             THEN 'brief'
      END AS logical,
      ANY_VALUE(f.field_id) AS field_id,
      ANY_VALUE(f.type)     AS field_type,
      -- Two fields answering to one logical name is recorded, never resolved.
      IF(COUNT(*) > 1,
         STRING_AGG(f.field_id, ', ' ORDER BY f.field_id), NULL) AS ambiguous_with
    FROM `oneeighty-warehouse.stg.stg_clickup_fields` f
    WHERE f.type != 'list_relationship'
    GROUP BY f.client_id, f.list_kind, logical
    HAVING logical IS NOT NULL
  ) S
  ON T.client_id = S.client_id AND T.list_kind = S.list_kind AND T.logical = S.logical
  WHEN MATCHED THEN UPDATE SET
    field_id = S.field_id, field_type = S.field_type,
    ambiguous_with = S.ambiguous_with, synced_at = run_at
  WHEN NOT MATCHED THEN INSERT
    (client_id, list_kind, logical, field_id, field_type, ambiguous_with, synced_at)
    VALUES (S.client_id, S.list_kind, S.logical, S.field_id, S.field_type, S.ambiguous_with, run_at);

  -- ===========================================================================
  -- PERSONAS
  -- ===========================================================================
  CREATE OR REPLACE TABLE `oneeighty-warehouse.ref.personas` AS
  SELECT
    t.client_id,
    t.task_id                                                    AS persona_id,
    t.task_name                                                  AS name,
    (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Awareness'      LIMIT 1) AS awareness,
    (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Segment'        LIMIT 1) AS segment,
    t.status,
    t.task_id                                                    AS clickup_task_id,
    t.task_url                                                   AS clickup_url,
    run_at                                                       AS synced_at
  FROM `oneeighty-warehouse.stg.stg_clickup_tasks` t
  WHERE t.list_kind = 'personas';

  -- ===========================================================================
  -- CONCEPTS
  -- ===========================================================================
  -- `multi_valued` is set when ClickUp held more than one angle or persona.
  -- SOP_master 4.4 says a concept has exactly one of each, so a second value is
  -- a data-entry error. It is recorded and flagged, never concatenated into
  -- something that would then appear in a breakdown as its own angle.
  CREATE OR REPLACE TABLE `oneeighty-warehouse.ref.concepts` AS
  WITH raw AS (
    SELECT
      t.client_id,
      t.task_id,
      t.task_name,
      t.task_url,
      t.status,
      DATE(t.date_created) AS created_at,
      ARRAY(SELECT f.value_text FROM UNNEST(t.custom_fields) f
             WHERE f.name = 'Angle' AND f.value_text IS NOT NULL)   AS angles,
      ARRAY(SELECT id FROM UNNEST(
              (SELECT f.value_ids FROM UNNEST(t.custom_fields) f
                WHERE f.name IN ('Persona', 'Persona Bank') LIMIT 1)) AS id) AS persona_ids,
      (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Offer'      LIMIT 1) AS offer,
      (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Hypothesis' LIMIT 1) AS hypothesis,
      (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Concept ID' LIMIT 1) AS explicit_id
    FROM `oneeighty-warehouse.stg.stg_clickup_tasks` t
    WHERE t.list_kind = 'concepts'
  )
  SELECT
    client_id,
    -- Prefer an explicit `Concept ID` field; fall back to a leading Cnn token
    -- in the task name, which is how they are actually written today.
    COALESCE(
      NULLIF(TRIM(explicit_id), ''),
      REGEXP_EXTRACT(task_name, r'\b(C\d{2,3})\b'),
      task_id
    )                                        AS concept_id,
    -- ── The same thing, minus the fallback ────────────────────────────────
    -- `concept_id` must always be present and unique because everything joins
    -- on it, so it falls back to the ClickUp task id. That fallback is a
    -- database key and not a name: six of Manami's nine concepts have no
    -- `Concept ID` filled, and the screens were printing `86ca9t2h4` beside a
    -- Czech concept name as though somebody had chosen it.
    --
    -- This column is what a person wrote, or nothing.
    COALESCE(
      NULLIF(TRIM(explicit_id), ''),
      REGEXP_EXTRACT(task_name, r'\b(C\d{2,3})\b')
    )                                        AS concept_code,
    task_name                                AS name,
    persona_ids[SAFE_OFFSET(0)]              AS persona_id,
    angles[SAFE_OFFSET(0)]                   AS angle,
    offer,
    hypothesis,
    status,
    created_at,
    task_id                                  AS clickup_task_id,
    task_url                                 AS clickup_url,
    (ARRAY_LENGTH(angles) > 1 OR ARRAY_LENGTH(persona_ids) > 1) AS multi_valued,
    run_at                                   AS synced_at
  FROM raw;

  -- ===========================================================================
  -- CREATORS
  -- ===========================================================================
  -- Identity only. ClickUp has no creator registry with pay terms — the `Creator`
  -- field is a dropdown of names — so this derives the roster from what is
  -- actually assigned on ad tasks.
  --
  -- ⚠ PAY MODEL AND RATES ARE NOT HERE. They live in Postgres
  -- (`creator_rates`, edited in the dashboard) because they are a manually
  -- entered input like every other cost assumption in this app, and because the
  -- frontend service account is read-only on the warehouse and so could never
  -- write them here. `ref.creators.pay_model` in CREATIVE_ENGINE_BRIEF.md 4.3
  -- is the one place this build deviates from the brief; the derivation table
  -- is implemented exactly as specified, only somewhere writable.
  CREATE OR REPLACE TABLE `oneeighty-warehouse.ref.creators` AS
  SELECT
    client_id,
    TO_HEX(MD5(CONCAT(client_id, '|', creator_name)))  AS creator_id,
    creator_name                                       AS name,
    ANY_VALUE(creator_type)                            AS creator_type,
    CAST(NULL AS STRING)  AS pay_model,
    CAST(NULL AS NUMERIC) AS rate,
    CAST(NULL AS INT64)   AS deliverables_per_shoot,
    CAST(NULL AS NUMERIC) AS product_cogs,
    CAST(NULL AS NUMERIC) AS usage_fee,
    CAST(NULL AS NUMERIC) AS rev_share_pct,
    TRUE                                               AS active,
    run_at                                             AS synced_at
  FROM `oneeighty-warehouse.stg.stg_clickup_ad_tasks`
  WHERE creator_name IS NOT NULL AND TRIM(creator_name) != ''
  GROUP BY client_id, creator_name;

  -- ===========================================================================
  -- CREATIVE TAGS — the join
  -- ===========================================================================
  -- One row per (client_id, ad_id). A task with a comma-separated `Creative ID`
  -- produces several rows: post-ID graduation gives the same creative a second
  -- ad_id, and both are the same creative and the same task.
  --
  -- Persona, angle and offer come FROM THE CONCEPT and are never read off the
  -- ad task. An ad inherits and cannot override (SOP_master 4.4), so reading
  -- them per ad would let a typo on one task invent a persona.
  CREATE OR REPLACE TABLE `oneeighty-warehouse.ref.creative_tags` AS
  WITH exploded AS (
    SELECT
      a.client_id,
      TRIM(ad) AS ad_id,
      a.task_id,
      -- Carried because funnel stage is parsed out of it: no ClickUp field
      -- holds TOF/MOF/BOF, so the ad's name is the only place it exists.
      a.task_name,
      a.task_url,
      a.concept_task_id,
      a.content_format,
      a.content_purpose,
      a.market,
      a.body_code,
      a.hook_code,
      a.production_method,
      a.creator_name,
      a.creator_type,
      a.production_cost,
      a.brief_url,
      a.created_date
    FROM `oneeighty-warehouse.mart.mart_clickup_ad_tasks` a,
    UNNEST(SPLIT(IFNULL(a.creative_id_raw, ''), ',')) AS ad
    -- Meta ad ids are long numerics. Anything else in this field is a note
    -- somebody typed, and must not become a phantom ad id.
    WHERE REGEXP_CONTAINS(TRIM(ad), r'^\d{6,}$')
  ),

  -- ── The second way in: the ad's own name ────────────────────────────────
  -- `Creative ID` is filled in by hand after an ad goes live, and on a real
  -- account it mostly is not: on Manami it carried an id on 15 of 65 tasks,
  -- which left half the account's spend untagged while the pipeline knew
  -- perfectly well what every one of those ads was.
  --
  -- The ad name is the other half of the same convention. A brief is written as
  -- `Persona - Description | STAGE | FORMAT | DATE | vN | MKT` and the ad is
  -- launched under that name, so an exact match on the normalised name is not a
  -- guess about which creative this is — it is the same string, typed once.
  --
  -- Two guards, because this is the arm that could do damage:
  --   · a name that resolves to more than one task is skipped and recorded.
  --     Two briefs sharing a name is a data-entry error, and picking one of
  --     them would attribute an ad to a coin flip.
  --   · `creative_id` always wins. Where somebody has stated the id, that
  --     statement is the answer and the name is not consulted.
  -- Anything short of an exact match — a date that moved, `V1` against `V2` —
  -- stays out and goes to the unmapped queue for a person to confirm. Those
  -- near-misses are usually genuinely different creatives.
  ad_names AS (
    SELECT
      client_id,
      ad_id,
      -- Ads get renamed. The most recent name is the one the pipeline's task
      -- was named after, or was renamed to match.
      MAX_BY(ad_name, date_start) AS ad_name
    FROM `oneeighty-warehouse.stg.stg_meta_ad_insights`
    WHERE ad_name IS NOT NULL
    GROUP BY client_id, ad_id
  ),
  named_tasks AS (
    SELECT
      a.*,
      `oneeighty-warehouse.ref.creative_name_key`(a.task_name) AS name_key
    FROM `oneeighty-warehouse.mart.mart_clickup_ad_tasks` a
    WHERE a.task_name IS NOT NULL
  ),
  unique_names AS (
    SELECT client_id, name_key
    FROM named_tasks
    WHERE name_key != ''
    GROUP BY client_id, name_key
    HAVING COUNT(DISTINCT task_id) = 1
  ),
  by_name AS (
    SELECT
      n.client_id,
      n.ad_id,
      t.task_id,
      t.task_name,
      t.task_url,
      t.concept_task_id,
      t.content_format,
      t.content_purpose,
      t.market,
      t.body_code,
      t.hook_code,
      t.production_method,
      t.creator_name,
      t.creator_type,
      t.production_cost,
      t.brief_url,
      t.created_date
    FROM ad_names n
    JOIN named_tasks t
      ON t.client_id = n.client_id
     AND t.name_key = `oneeighty-warehouse.ref.creative_name_key`(n.ad_name)
    JOIN unique_names u
      ON u.client_id = t.client_id AND u.name_key = t.name_key
    LEFT JOIN exploded e
      ON e.client_id = n.client_id AND e.ad_id = n.ad_id
    WHERE e.ad_id IS NULL
  ),
  matched AS (
    SELECT *, 'creative_id' AS match_method, CAST(1.0 AS NUMERIC) AS match_confidence
    FROM exploded
    UNION ALL
    -- Not 1.0. The id is a statement; the name is an agreement, and an
    -- agreement can be broken by a rename nobody carried across.
    SELECT *, 'name_exact' AS match_method, CAST(0.95 AS NUMERIC) AS match_confidence
    FROM by_name
  )
  SELECT
    e.client_id,
    e.ad_id,
    e.task_id                                       AS clickup_task_id,
    e.task_url                                      AS clickup_url,
    cn.concept_id,
    cn.persona_id,
    cn.angle,
    cn.offer,
    -- ── Funnel stage ────────────────────────────────────────────────────
    -- NO CLICKUP FIELD HOLDS THIS. `Content Purpose` looks like it should and
    -- does not: verified against the live list on 9 Sep 2026, its options are
    -- Net-new / Offer-Promo / Winner Variant. Mapping it to TOF/MOF/BOF would
    -- have set stage NULL on every ad in the account while looking like it
    -- worked.
    --
    -- So stage is parsed out of the ad NAME, which does carry it by convention
    -- (`... | TOF | STAT | b1h3 | ...`), and is left NULL where the name does
    -- not. A guessed stage is worse than an absent one: the Breakdown screen
    -- would then compare three funnel positions that nobody assigned.
    REGEXP_EXTRACT(UPPER(IFNULL(e.task_name, '')), r'\b(TOF|MOF|BOF)\b') AS stage,

    -- ── Production type ─────────────────────────────────────────────────
    -- What `Content Purpose` actually is, kept under its real meaning. This is
    -- the better signal for the 80/20 rule than any naming heuristic: Net-new
    -- against Winner Variant is exactly the split the rule is about, stated by
    -- whoever briefed the ad.
    NULLIF(TRIM(IFNULL(e.content_purpose, '')), '')  AS production_type,

    -- ── Format ──────────────────────────────────────────────────────────
    -- The live options are `DYN | Video`, `STAT | Static`, `CAR | Carousel` —
    -- the code and the label in one string. Matching on the leading token
    -- survives a rename of the human half.
    CASE
      WHEN STARTS_WITH(UPPER(IFNULL(e.content_format, '')), 'STAT') THEN 'STAT'
      WHEN STARTS_WITH(UPPER(IFNULL(e.content_format, '')), 'DYN')  THEN 'DYN'
      WHEN STARTS_WITH(UPPER(IFNULL(e.content_format, '')), 'CAR')  THEN 'CAR'
      WHEN STARTS_WITH(UPPER(IFNULL(e.content_format, '')), 'DPA')  THEN 'DPA'
      ELSE NULL END                                 AS format,
    e.body_code,
    e.hook_code,
    e.production_method,
    TO_HEX(MD5(CONCAT(e.client_id, '|', IFNULL(e.creator_name, '')))) AS creator_id,
    e.creator_type,
    e.production_cost,
    IF(e.production_cost IS NULL, 'settings', 'manual')  AS production_cost_source,
    e.brief_url,
    -- Market options are emoji-prefixed in ClickUp (`🇨🇿 CZ`, `🇸🇰 SK`,
    -- `🇨🇿+🇸🇰 Both`). The two-letter code is what everything downstream
    -- filters on, so the flag is stripped here rather than in five places.
    CASE
      WHEN e.market IS NULL THEN NULL
      WHEN CONTAINS_SUBSTR(e.market, 'Both') THEN 'CZ+SK'
      ELSE NULLIF(TRIM(REGEXP_REPLACE(e.market, r'[^A-Za-z+]', '')), '')
    END                                             AS market,
    e.created_date                                  AS launched_at,
    e.match_method,
    e.match_confidence,
    run_at                                          AS synced_at
  FROM matched e
  LEFT JOIN `oneeighty-warehouse.ref.concepts` cn
    ON cn.client_id = e.client_id AND cn.clickup_task_id = e.concept_task_id
  -- ── One row per ad, enforced here rather than assumed ────────────────────
  -- `mart_creative_perf` LEFT JOINs this table onto daily ad insights, so a
  -- second row for one ad does not read as a duplicate tag — it silently
  -- DOUBLES that ad's spend, revenue and impressions on every Creative screen.
  -- Manami has one today: two pipeline tasks carry the same id in `Creative
  -- ID`, which is what happens when a task is duplicated to make a variant and
  -- the field is copied with it.
  --
  -- The strongest claim wins: a stated id over a matched name, then the most
  -- recently briefed task, then the id, so the choice is stable between runs
  -- rather than whatever the shuffle returned first. The collision itself is
  -- recorded below; this only stops it from corrupting the numbers meanwhile.
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY e.client_id, e.ad_id
    ORDER BY e.match_confidence DESC, e.created_date DESC, e.task_id
  ) = 1;

  -- ===========================================================================
  -- ISSUES — what was refused rather than guessed
  -- ===========================================================================
  INSERT INTO `oneeighty-warehouse.ops.clickup_sync_issues`
    (synced_at, client_id, severity, kind, entity_id, detail)

  -- A concept carrying two angles or two personas. Not fatal, but every figure
  -- attributed to it is now attributed to one of two possible answers.
  SELECT run_at, client_id, 'warn', 'multi_angle', concept_id,
         CONCAT('Concept "', IFNULL(name, ''), '" holds more than one angle or persona. First value used.')
  FROM `oneeighty-warehouse.ref.concepts`
  WHERE multi_valued

  UNION ALL

  -- The guard against the Venev relationship-field defect. An ad tagged with a
  -- concept belonging to another client means the sync followed a field
  -- pointing at the wrong list, and a breakdown will silently mix two brands.
  SELECT run_at, t.client_id, 'error', 'cross_client_concept', t.ad_id,
         CONCAT('Ad ', t.ad_id, ' resolved to concept ', c.concept_id,
                ' owned by client ', c.client_id, '. Check ref.clickup_field_map.')
  FROM `oneeighty-warehouse.ref.creative_tags` t
  JOIN `oneeighty-warehouse.ref.concepts` c
    ON c.concept_id = t.concept_id
  WHERE t.client_id != c.client_id

  UNION ALL

  -- A tagged ad whose concept row does not exist: the relationship points at a
  -- task that is not in the concept list, or the concept list did not sync.
  SELECT run_at, t.client_id, 'warn', 'concept_missing', t.ad_id,
         CONCAT('Ad ', t.ad_id, ' carries a ClickUp task but resolved to no concept.')
  FROM `oneeighty-warehouse.ref.creative_tags` t
  WHERE t.concept_id IS NULL

  UNION ALL

  -- Two pipeline tasks claiming the same ad id in `Creative ID`. One of them is
  -- being used and the other ignored, and which one is arbitrary from the
  -- outside — so it is named here rather than left to look like agreement.
  SELECT run_at, client_id, 'warn', 'duplicate_creative_id', ad_id,
         CONCAT('Ad ', ad_id, ' is claimed by ', CAST(COUNT(DISTINCT task_id) AS STRING),
                ' pipeline tasks (', STRING_AGG(DISTINCT task_id, ', '),
                '). One was used; clear the Creative ID on the others.')
  FROM (
    SELECT a.client_id, TRIM(ad) AS ad_id, a.task_id
    FROM `oneeighty-warehouse.mart.mart_clickup_ad_tasks` a,
    UNNEST(SPLIT(IFNULL(a.creative_id_raw, ''), ',')) AS ad
    WHERE REGEXP_CONTAINS(TRIM(ad), r'^\d{6,}$')
  )
  GROUP BY client_id, ad_id
  HAVING COUNT(DISTINCT task_id) > 1

  UNION ALL

  -- Two pipeline tasks whose names normalise to the same key. The name match
  -- refuses both rather than picking one, so any ad launched under that name is
  -- left untagged and shows up in the unmapped queue. Renaming one of the two
  -- tasks fixes it.
  SELECT run_at, client_id, 'warn', 'ambiguous_task_name', ANY_VALUE(task_id),
         CONCAT(CAST(COUNT(DISTINCT task_id) AS STRING),
                ' pipeline tasks share the name "', ANY_VALUE(task_name),
                '". Name matching skipped all of them.')
  FROM `oneeighty-warehouse.mart.mart_clickup_ad_tasks`
  WHERE task_name IS NOT NULL
  GROUP BY client_id, `oneeighty-warehouse.ref.creative_name_key`(task_name)
  HAVING COUNT(DISTINCT task_id) > 1

  UNION ALL

  -- A relationship field on an ad pipeline that the curated map does not name.
  -- Venev's stale `Concept` (05c15839-...) shows up here every run until it is
  -- deleted, which is the point: it is being ignored, and that stays visible
  -- rather than becoming something everyone forgot was still there.
  SELECT run_at, f.client_id, 'warn', 'unmapped_relationship_field', f.field_id,
         CONCAT('Relationship field "', IFNULL(f.name, ''), '" (', f.field_id,
                ') on the ', f.list_kind, ' list is not in ref.clickup_field_map',
                IFNULL(CONCAT(' and points at list ', f.target_list_id), ''),
                '. It is being ignored.')
  FROM `oneeighty-warehouse.stg.stg_clickup_fields` f
  LEFT JOIN `oneeighty-warehouse.ref.clickup_field_map` m
    ON m.client_id = f.client_id AND m.field_id = f.field_id
  WHERE f.type = 'list_relationship' AND m.field_id IS NULL

  UNION ALL

  -- The curated map naming a field ClickUp no longer has. Until it is fixed the
  -- concept join silently returns nothing and every ad reads as untagged.
  SELECT run_at, m.client_id, 'error', 'field_map_stale', m.field_id,
         CONCAT('ref.clickup_field_map names ', m.logical, ' = ', m.field_id,
                ', which no longer exists in ClickUp.')
  FROM `oneeighty-warehouse.ref.clickup_field_map` m
  LEFT JOIN `oneeighty-warehouse.stg.stg_clickup_fields` f
    ON f.client_id = m.client_id AND f.field_id = m.field_id
  WHERE f.field_id IS NULL;
END;
