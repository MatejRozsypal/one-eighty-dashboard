-- =============================================================================
-- 280_creative_mapping.sql
-- Creative suite (package cs1): ads reach their concept and persona again.
--
-- Why
--   On 2026-10-08 Ethia had 179 ads with spend and 0 carrying a concept, while
--   all 24 of its ClickUp ad tasks had the Concept field filled. Three causes,
--   none of them in the hourly sync, which is healthy:
--     1. Relationship fields were resolved by NAME. Every client folder was
--        cloned from a template, so each list still carries fields called
--        `Concept` and `Persona` that point at ANOTHER client's list. Ethia had
--        no curated concept_rel row at all, so its link was never read; its
--        concepts' persona came from whichever `Persona` field came first, the
--        empty one pointing at Manami's Persona Bank. RawBark names its real
--        ones `RAW: Concept` / `RAW: Persona` and would have failed the same way.
--     2. The name match needed a byte-equal key, so `17AUG-26` against
--        `2026-08-17`, `HEROSHOT` against `Hero Shot`, and Ads Manager's
--        ` - Copy` suffix each cost an ad its tag.
--     3. `Creative ID` accepted any long number. Manami's advent tasks hold
--        16-digit ids that are not Meta ad ids, which became phantom tags and
--        stopped the name match from being tried for those tasks.
--
-- Change
--   ALTER  ref.clickup_field_map ADD COLUMN source ('curated' | 'target_list').
--   NEW    ref.creative_name_key_v2(s), the v1 key with dates, ` - Copy` and
--          STATIC/STAT normalised. Nothing that carries meaning is dropped.
--   REPLACE ref.sp_rebuild_creative_tags():
--     a. concept_rel and persona_rel are derived each run from TARGET LIST: the
--        one relationship field on the client's ad pipeline (concept list) that
--        points at the client's own registered concept (persona) list. A
--        curated row still wins. Two candidates is recorded, never resolved.
--     b. concept persona is read from persona_rel only, never by field name.
--     c. Creative ID values are only used when they are a Meta ad id the
--        warehouse has seen; anything else is reported as creative_id_not_an_ad.
--     d. Tasks still named with the brief template (`PersonaID-NAME | STAGE |
--        ...`) never take part in a name match and are reported.
--     e. Match tiers, strongest first: creative_id 1.00, name_exact 0.95,
--        name_normalised 0.90, name_market_variant 0.85 (same brief, other
--        market; market read from the ad name), name_date_shifted 0.80 (same
--        name, launch date moved after the brief; only when one task has that
--        name and the ad started on or after the task was created).
--     f. concept_code also recognises `RAW-K2` / `K7` style codes.
--   REPLACE VIEW mart.mart_creative_unmapped, adds pipeline_start and
--          before_pipeline, so ads launched before a client had a ClickUp ad
--          pipeline stop reading as filing work nobody did.
--
-- Not changed
--   Matching never looks at anything other than the ad's name and stated id.
--   Prefix differences (`UGC Stop Scrolling` vs `Stop Scrolling`) and version
--   differences (v1 vs v2) are different strings and stay unmapped for a person.
--
-- Effect, measured on mart_qa.cs1_* against live on 2026-10-08
--   ethia   tags 3 -> 3, with concept 0 -> 3, with persona 0 -> 3
--   manami  real-ad tags 41 -> 52, with concept 30 -> 31
--   venev   tags 14 -> 15 (concept stays 1: 33 of 36 ad tasks have no VEN: Concept filled)
--
-- Based on: 224_sp_rebuild_creative_tags.sql, whose procedure body is
--   byte-equal to the live routine (md5 cd6c9a51ecc60f546a186c3c47b30257 on
--   2026-10-08), and live/mart.mart_creative_unmapped.sql.
-- QA copies: mart_qa.cs1_rel_fields, cs1_concepts, cs1_ad_tasks, cs1_creative_tags_v2.
-- Deploy: away from :45 to :48 UTC (the hourly sync calls this procedure).
--   Run this file, then CALL ref.sp_rebuild_creative_tags(), then 280b if approved.
-- =============================================================================

ALTER TABLE `oneeighty-warehouse.ref.clickup_field_map`
  ADD COLUMN IF NOT EXISTS source STRING
  OPTIONS (description = "curated: set by hand, wins. target_list: derived each sync from the field that points at the client's own list.");
UPDATE `oneeighty-warehouse.ref.clickup_field_map` SET source = 'curated'
WHERE source IS NULL AND logical IN ('concept_rel', 'persona_rel');

-- =============================================================================
-- NAME KEY: the one normalisation both sides of the name match go through
-- =============================================================================
-- An ad name and a ClickUp task name are written by the same person under the
-- same convention, and are meant to be the same string. In practice they differ
-- by a doubled space, a stray trailing colon, a `|` typed as an `I`, or a
-- diacritic dropped on one side. None of those are differences of meaning, and
-- every one of them costs a whole ad's worth of tagging.
--
-- So the key is the name reduced to what a person reads it as: lower case,
-- diacritics stripped, punctuation gone, and the bare token `i` removed,
-- because in this account `I` is used as a pipe (`Testery I TOF I STAT I CZ`)
-- and the two spellings must land on the same key.
--
-- Deliberately NOT normalised away: dates, stage tokens, version numbers and
-- market codes. `... | 13AUG | ...` and `... | 4SEP | ...` are two different
-- creatives and must stay two different keys; collapsing them would attach one
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

-- =============================================================================
-- NAME KEY v2: the same key with three spellings unified
-- =============================================================================
-- Each of these is a difference of spelling, never of meaning:
--   · dates: 17AUG, 17AUG-26, 17AUGUST and 2026-08-17 are one date, written
--     here as one token (d0817). Two different dates stay two different tokens,
--     so the v1 rule that `13AUG` and `4SEP` are two creatives still holds.
--   · ` - Copy`, ` - Copy 2` at the end: Ads Manager appends it when an ad is
--     duplicated into another ad set. The creative is the same one.
--   · STATIC and STAT are one format code.
-- The key is returned with spaces removed, so `HEROSHOT` and `Hero Shot` meet.
CREATE OR REPLACE FUNCTION `oneeighty-warehouse.ref.creative_name_dates`(s STRING)
RETURNS STRING AS (
  REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
  REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
  REGEXP_REPLACE(
    REGEXP_REPLACE(IFNULL(s, ''), r'(20\d{2})-(\d{2})-(\d{2})', r' D\2_\3 '),
    r'(?i)(\d{1,2})JAN[A-Z]*(-\d{2}\b)?', r' D01_\1 '), r'(?i)(\d{1,2})FEB[A-Z]*(-\d{2}\b)?', r' D02_\1 '),
    r'(?i)(\d{1,2})MAR[A-Z]*(-\d{2}\b)?', r' D03_\1 '), r'(?i)(\d{1,2})APR[A-Z]*(-\d{2}\b)?', r' D04_\1 '),
    r'(?i)(\d{1,2})MAY[A-Z]*(-\d{2}\b)?', r' D05_\1 '), r'(?i)(\d{1,2})JUN[A-Z]*(-\d{2}\b)?', r' D06_\1 '),
    r'(?i)(\d{1,2})JUL[A-Z]*(-\d{2}\b)?', r' D07_\1 '), r'(?i)(\d{1,2})AUG[A-Z]*(-\d{2}\b)?', r' D08_\1 '),
    r'(?i)(\d{1,2})SEP[A-Z]*(-\d{2}\b)?', r' D09_\1 '), r'(?i)(\d{1,2})OCT[A-Z]*(-\d{2}\b)?', r' D10_\1 '),
    r'(?i)(\d{1,2})NOV[A-Z]*(-\d{2}\b)?', r' D11_\1 '), r'(?i)(\d{1,2})DEC[A-Z]*(-\d{2}\b)?', r' D12_\1 '),
    r'D(\d{2})_0?(\d{1,2})', r'd\1\2')
);

-- The spaced form, used to strip a trailing market or a date token before the
-- spaces are removed.
CREATE OR REPLACE FUNCTION `oneeighty-warehouse.ref.creative_name_tokens_v2`(s STRING)
RETURNS STRING AS ((
  ARRAY_TO_STRING(ARRAY(
    SELECT IF(tok = 'static', 'stat', tok)
    FROM UNNEST(SPLIT(
      REGEXP_REPLACE(
        LOWER(REGEXP_REPLACE(NORMALIZE(
          `oneeighty-warehouse.ref.creative_name_dates`(
            REGEXP_REPLACE(IFNULL(s, ''), r'(?i)\s*[-–]\s*copy(\s*\d+)?\s*$', '')),
          NFD), r'\p{Mn}', '')),
        r'[^a-z0-9]+', ' '), ' ')) AS tok WITH OFFSET o
    WHERE tok != '' AND tok != 'i'
    ORDER BY o), ' ')
));

CREATE OR REPLACE FUNCTION `oneeighty-warehouse.ref.creative_name_key_v2`(s STRING)
RETURNS STRING AS (
  REPLACE(`oneeighty-warehouse.ref.creative_name_tokens_v2`(s), ' ', '')
);

CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.ref.sp_rebuild_creative_tags`()
BEGIN
  DECLARE run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP();

  -- ===========================================================================
  -- FIELD MAP: refresh the mechanical half, validate the curated half
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

  -- ── Relationship fields, resolved by where they point ─────────────────────
  -- Never by name: every client folder was cloned from a template, and the
  -- clone keeps fields called `Concept` and `Persona` that point at ANOTHER
  -- client's list (Ethia, Venev and RawBark each carry one aimed at Manami's).
  -- The field that means "this ad's concept" is the one relationship field on
  -- the client's ad pipeline whose target is the client's own registered
  -- concept list; likewise persona on the concept list. That is a fact about
  -- the field, not a guess from its label, and it works for `RAW: Concept`
  -- as well as `Concept`.
  --
  -- A curated row (source 'curated', or a row from before this column existed)
  -- always wins. Two candidates pointing at the same own list is recorded in
  -- ambiguous_with and nothing is derived.
  DELETE FROM `oneeighty-warehouse.ref.clickup_field_map`
  WHERE source = 'target_list';

  INSERT INTO `oneeighty-warehouse.ref.clickup_field_map`
    (client_id, list_kind, logical, field_id, field_type, ambiguous_with, synced_at, source)
  WITH own AS (
    SELECT f.client_id, f.list_kind, f.field_id,
           CASE
             WHEN f.list_kind = 'ad_pipeline' AND l.list_kind = 'concepts' THEN 'concept_rel'
             WHEN f.list_kind = 'concepts'    AND l.list_kind = 'personas' THEN 'persona_rel'
           END AS logical
    FROM `oneeighty-warehouse.stg.stg_clickup_fields` f
    JOIN `oneeighty-warehouse.ref.clickup_lists` l
      ON l.client_id = f.client_id AND l.list_id = f.target_list_id AND l.active
    WHERE f.type = 'list_relationship'
  )
  SELECT o.client_id, o.list_kind, o.logical,
         MIN(o.field_id), 'list_relationship',
         IF(COUNT(*) > 1, STRING_AGG(o.field_id, ', ' ORDER BY o.field_id), NULL),
         run_at, 'target_list'
  FROM own o
  WHERE o.logical IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM `oneeighty-warehouse.ref.clickup_field_map` m
      WHERE m.client_id = o.client_id AND m.list_kind = o.list_kind AND m.logical = o.logical)
  GROUP BY o.client_id, o.list_kind, o.logical
  -- An ambiguous pair is written with its field_id so the issue below can name
  -- it, but the readers skip any row with ambiguous_with set.
  ;

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
      -- Through persona_rel only. Reading `Persona` by name took the first of
      -- two fields with that label on Ethia's list, the empty one aimed at
      -- Manami's Persona Bank, and left all 30 Ethia concepts without one.
      ARRAY(SELECT id FROM UNNEST(t.custom_fields) f, UNNEST(f.value_ids) AS id
             WHERE f.field_id = pr.field_id)                       AS persona_ids,
      (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Offer'      LIMIT 1) AS offer,
      (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Hypothesis' LIMIT 1) AS hypothesis,
      (SELECT f.value_text FROM UNNEST(t.custom_fields) f WHERE f.name = 'Concept ID' LIMIT 1) AS explicit_id
    FROM `oneeighty-warehouse.stg.stg_clickup_tasks` t
    LEFT JOIN `oneeighty-warehouse.ref.clickup_field_map` pr
      ON  pr.client_id = t.client_id AND pr.list_kind = 'concepts'
      AND pr.logical = 'persona_rel' AND pr.ambiguous_with IS NULL
    WHERE t.list_kind = 'concepts'
  ),
  coded AS (
    SELECT raw.*,
      COALESCE(
        NULLIF(TRIM(explicit_id), ''),
        -- `C07` anywhere (Manami), or a client-prefixed `RAW-K2` at the start
        -- (RawBark). A bare `K2` is not taken: RawBark writes `varianta K2`
        -- inside other concepts' names.
        REGEXP_EXTRACT(task_name, r'\b(C\d{2,3})\b'),
        REGEXP_EXTRACT(task_name, r'^\s*([A-Z]{2,4}-K\d{1,3})\b')
      ) AS code
    FROM raw
  )
  SELECT
    client_id,
    -- Prefer an explicit `Concept ID` field; fall back to a leading Cnn token
    -- in the task name, which is how they are actually written today.
    -- A code written on two concepts would join every ad of one onto both, so
    -- a repeated code falls back to the task id for the key (and stays the
    -- display code).
    IF(code IS NULL OR COUNT(*) OVER (PARTITION BY client_id, code) > 1,
       task_id, code)                        AS concept_id,
    -- ── The same thing, minus the fallback ────────────────────────────────
    -- `concept_id` must always be present and unique because everything joins
    -- on it, so it falls back to the ClickUp task id. That fallback is a
    -- database key and not a name: six of Manami's nine concepts have no
    -- `Concept ID` filled, and the screens were printing `86ca9t2h4` beside a
    -- Czech concept name as though somebody had chosen it.
    --
    -- This column is what a person wrote, or nothing.
    code                                     AS concept_code,
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
  FROM coded;

  -- ===========================================================================
  -- CREATORS
  -- ===========================================================================
  -- Identity only. ClickUp has no creator registry with pay terms (the `Creator`
  -- field is a dropdown of names), so this derives the roster from what is
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
  -- CREATIVE TAGS: the join
  -- ===========================================================================
  -- One row per (client_id, ad_id). A task with a comma-separated `Creative ID`
  -- produces several rows: post-ID graduation gives the same creative a second
  -- ad_id, and both are the same creative and the same task.
  --
  -- Persona, angle and offer come FROM THE CONCEPT and are never read off the
  -- ad task. An ad inherits and cannot override (SOP_master 4.4), so reading
  -- them per ad would let a typo on one task invent a persona.
  CREATE OR REPLACE TABLE `oneeighty-warehouse.ref.creative_tags` AS
  WITH ad_names AS (
    SELECT
      client_id,
      ad_id,
      -- Ads get renamed. The most recent name is the one the pipeline's task
      -- was named after, or was renamed to match.
      MAX_BY(ad_name, date_start) AS ad_name,
      MIN(date_start)             AS first_seen
    FROM `oneeighty-warehouse.stg.stg_meta_ad_insights`
    WHERE ad_name IS NOT NULL
    GROUP BY client_id, ad_id
  ),
  tasks AS (
    SELECT
      a.client_id,
      a.task_id,
      -- Carried because funnel stage is parsed out of it: no ClickUp field
      -- holds TOF/MOF/BOF, so the name is the only place it exists.
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
      a.created_date,
      a.creative_id_raw,
      -- The brief template's own placeholder is not a name. Eleven Manami tasks
      -- still carry it; matching on it would pair every such task with nothing
      -- or, worse, with each other.
      REGEXP_CONTAINS(IFNULL(a.task_name, ''), r'PersonaID-NAME|STAGE \| FORMAT') AS is_placeholder,
      `oneeighty-warehouse.ref.creative_name_key`(a.task_name)   AS k_exact,
      `oneeighty-warehouse.ref.creative_name_key_v2`(a.task_name) AS k_norm,
      REPLACE(REGEXP_REPLACE(`oneeighty-warehouse.ref.creative_name_tokens_v2`(a.task_name),
        r'( (cz|sk|hu|pl|ro|de|at|us|ca|uk|eu|both))+$', ''), ' ', '')          AS k_nomkt,
      REPLACE(REGEXP_REPLACE(`oneeighty-warehouse.ref.creative_name_tokens_v2`(a.task_name),
        r'\bd\d{3,4}\b', ''), ' ', '')                                        AS k_nodate
    FROM `oneeighty-warehouse.mart.mart_clickup_ad_tasks` a
  ),
  ads AS (
    SELECT
      n.*,
      `oneeighty-warehouse.ref.creative_name_key`(n.ad_name)   AS k_exact,
      `oneeighty-warehouse.ref.creative_name_key_v2`(n.ad_name) AS k_norm,
      REPLACE(REGEXP_REPLACE(`oneeighty-warehouse.ref.creative_name_tokens_v2`(n.ad_name),
        r'( (cz|sk|hu|pl|ro|de|at|us|ca|uk|eu|both))+$', ''), ' ', '')          AS k_nomkt,
      REPLACE(REGEXP_REPLACE(`oneeighty-warehouse.ref.creative_name_tokens_v2`(n.ad_name),
        r'\bd\d{3,4}\b', ''), ' ', '')                                        AS k_nodate,
      UPPER(REPLACE(REGEXP_EXTRACT(`oneeighty-warehouse.ref.creative_name_tokens_v2`(n.ad_name),
        r' ((?:cz|sk|hu|pl|ro|de|at|us|ca|uk|eu|both)(?: (?:cz|sk|both))?)$'), ' ', '+')) AS name_market
    FROM ad_names n
  ),

  -- ── The first way in: the stated id ─────────────────────────────────────
  -- Only a value the warehouse has seen as a Meta ad id. Manami's advent tasks
  -- hold 16-digit numbers that are not ad ids; taken at face value they became
  -- tags for ads that do not exist, and the name match below was never tried
  -- for those tasks. They are reported as creative_id_not_an_ad instead.
  by_id AS (
    SELECT t.client_id, d.ad_id, t.task_id, 'creative_id' AS match_method,
           CAST(1.00 AS NUMERIC) AS match_confidence, 1 AS tier
    FROM tasks t, UNNEST(SPLIT(IFNULL(t.creative_id_raw, ''), ',')) AS raw_id
    JOIN ads d
      ON d.client_id = t.client_id
     AND d.ad_id = REGEXP_REPLACE(raw_id, r'[^0-9]', '')
  ),

  -- ── The second way in: the ad's own name ────────────────────────────────
  -- A brief is written as `Persona - Description | STAGE | FORMAT | DATE | vN |
  -- MKT` and the ad is launched under that name. Each tier below only ever
  -- compares one ad name with one task name, and each tier requires the key to
  -- belong to exactly one task: two briefs sharing a name is a data-entry error,
  -- and picking one would attribute an ad to a coin flip (ambiguous_task_name).
  --
  --   name_exact          0.95  the v1 key, unchanged
  --   name_normalised     0.90  dates, ` - Copy`, STATIC/STAT, spacing unified
  --   name_market_variant 0.85  same brief launched in another market. Concept,
  --                             persona, angle and offer do not depend on the
  --                             market; the market itself is read off the ad.
  --   name_date_shifted   0.80  same name, date moved between brief and launch
  --                             (`13AUG` brief, `4SEP` ad). Only forward in
  --                             time: the ad started on or after the brief.
  --
  -- Not attempted: a different version (v1/v2), an added or dropped word
  -- (`UGC Stop Scrolling` / `Stop Scrolling`). Those are usually different
  -- creatives and go to the unmapped queue for a person.
  u_exact  AS (SELECT client_id, k_exact  AS k, ANY_VALUE(task_id) AS tid FROM tasks WHERE NOT is_placeholder AND k_exact  != '' GROUP BY 1, 2 HAVING COUNT(DISTINCT task_id) = 1),
  u_norm   AS (SELECT client_id, k_norm   AS k, ANY_VALUE(task_id) AS tid FROM tasks WHERE NOT is_placeholder AND k_norm   != '' GROUP BY 1, 2 HAVING COUNT(DISTINCT task_id) = 1),
  u_nomkt  AS (SELECT client_id, k_nomkt  AS k, ANY_VALUE(task_id) AS tid FROM tasks WHERE NOT is_placeholder AND k_nomkt  != '' GROUP BY 1, 2 HAVING COUNT(DISTINCT task_id) = 1),
  u_nodate AS (SELECT client_id, k_nodate AS k, ANY_VALUE(task_id) AS tid, ANY_VALUE(created_date) AS created_date
               FROM tasks WHERE NOT is_placeholder AND k_nodate != '' GROUP BY 1, 2 HAVING COUNT(DISTINCT task_id) = 1),
  by_name AS (
    SELECT d.client_id, d.ad_id, u.tid AS task_id, 'name_exact', CAST(0.95 AS NUMERIC), 2
    FROM ads d JOIN u_exact u ON u.client_id = d.client_id AND u.k = d.k_exact
    UNION ALL
    SELECT d.client_id, d.ad_id, u.tid, 'name_normalised', CAST(0.90 AS NUMERIC), 3
    FROM ads d JOIN u_norm u ON u.client_id = d.client_id AND u.k = d.k_norm
    UNION ALL
    SELECT d.client_id, d.ad_id, u.tid, 'name_market_variant', CAST(0.85 AS NUMERIC), 4
    FROM ads d JOIN u_nomkt u ON u.client_id = d.client_id AND u.k = d.k_nomkt
    WHERE d.name_market IS NOT NULL
    UNION ALL
    SELECT d.client_id, d.ad_id, u.tid, 'name_date_shifted', CAST(0.80 AS NUMERIC), 5
    FROM ads d JOIN u_nodate u ON u.client_id = d.client_id AND u.k = d.k_nodate
    WHERE d.k_nodate != d.k_norm AND d.first_seen >= u.created_date
  ),
  matched AS (
    SELECT
      m.client_id, m.ad_id, m.match_method, m.match_confidence, m.tier,
      t.task_id, t.task_name, t.task_url, t.concept_task_id, t.content_format,
      t.content_purpose,
      -- A market variant's market is the ad's own, not the brief's.
      IF(m.match_method = 'name_market_variant', d.name_market, t.market) AS market,
      t.body_code, t.hook_code, t.production_method, t.creator_name,
      t.creator_type, t.production_cost, t.brief_url, t.created_date
    FROM (SELECT * FROM by_id UNION ALL SELECT * FROM by_name) m
    JOIN tasks t ON t.client_id = m.client_id AND t.task_id = m.task_id
    JOIN ads d   ON d.client_id = m.client_id AND d.ad_id = m.ad_id
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
    -- The live options are `DYN | Video`, `STAT | Static`, `CAR | Carousel`:
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
  -- second row for one ad does not read as a duplicate tag, it silently
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
  -- ISSUES: what was refused rather than guessed
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
  -- outside, so it is named here rather than left to look like agreement.
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
  WHERE f.field_id IS NULL

  UNION ALL

  -- Two relationship fields on one list both pointing at the client's own
  -- concept (or persona) list. Nothing is derived until one is removed.
  SELECT run_at, client_id, 'error', 'ambiguous_relationship_field', field_id,
         CONCAT('Two ', list_kind, ' fields point at this client''s own ',
                IF(logical = 'concept_rel', 'concept', 'persona'), ' list (', ambiguous_with,
                '). Neither is used until one is deleted.')
  FROM `oneeighty-warehouse.ref.clickup_field_map`
  WHERE source = 'target_list' AND ambiguous_with IS NOT NULL

  UNION ALL

  -- A number in Creative ID that is not an ad the warehouse has seen. Usually a
  -- post, media or creative id pasted from the wrong column in Ads Manager.
  SELECT run_at, a.client_id, 'warn', 'creative_id_not_an_ad', a.task_id,
         CONCAT('Task "', IFNULL(a.task_name, ''), '" has Creative ID ', TRIM(x),
                ', which is not a Meta ad id in this account. Paste the ad id instead.')
  FROM `oneeighty-warehouse.mart.mart_clickup_ad_tasks` a,
  UNNEST(SPLIT(IFNULL(a.creative_id_raw, ''), ',')) AS x
  WHERE REGEXP_CONTAINS(TRIM(x), r'\d{6,}')
    AND NOT EXISTS (
      SELECT 1 FROM `oneeighty-warehouse.stg.stg_meta_ad_insights` i
      WHERE i.client_id = a.client_id AND i.ad_id = REGEXP_REPLACE(x, r'[^0-9]', ''))
    -- an ad launched today has no insights row yet; give it a day
    AND a.created_date < DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)

  UNION ALL

  -- A brief still named with the template placeholder. No ad can ever be
  -- matched to it by name.
  SELECT run_at, client_id, 'warn', 'placeholder_task_name', task_id,
         CONCAT('Ad task ', task_id, ' (', IFNULL(status, 'no status'),
                ') is still named "', task_name, '". Rename it to the ad name.')
  FROM `oneeighty-warehouse.mart.mart_clickup_ad_tasks`
  WHERE REGEXP_CONTAINS(IFNULL(task_name, ''), r'PersonaID-NAME|STAGE \| FORMAT');
END;


-- =============================================================================
-- stg.stg_clickup_ad_tasks: based on live/stg.stg_clickup_ad_tasks.sql,
-- one condition added (ambiguous relationship rows are not followed).
-- =============================================================================
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
  -- 280: a derived row with two candidates is recorded, never used.
  AND m.ambiguous_with IS NULL
WHERE t.list_kind = 'ad_pipeline';


-- =============================================================================
-- mart.mart_creative_unmapped: based on live/mart.mart_creative_unmapped.sql.
-- Same rows and columns, plus two.
--
-- pipeline_start   the day the client's first real ad task was created in its
--                  ClickUp ad pipeline (template placeholders excluded). NULL
--                  when the client has no registered ad pipeline.
-- before_pipeline  the ad first delivered before that day, or the client has
--                  no pipeline. Such an ad never had a brief to be matched to:
--                  Ethia's 170-odd ads from January to August 2026 ran before
--                  its pipeline existed. Counting them as unmapped told the
--                  owner 98 % of Ethia's filing was missing when 100 % of the
--                  ads briefed in ClickUp were matched.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_creative_unmapped` AS
WITH pipeline AS (
  SELECT client_id, MIN(created_date) AS pipeline_start
  FROM `oneeighty-warehouse.stg.stg_clickup_ad_tasks`
  WHERE NOT REGEXP_CONTAINS(IFNULL(task_name, ''), r'PersonaID-NAME|STAGE \| FORMAT')
  GROUP BY client_id
),
unmapped AS (
  SELECT
    i.client_id,
    i.ad_id,
    ANY_VALUE(i.ad_name)      AS ad_name,
    ANY_VALUE(i.adset_id)     AS adset_id,
    SUM(i.spend)              AS spend,
    SUM(i.purchases)          AS purchases,
    SUM(i.purchase_value)     AS revenue,
    SUM(i.impressions)        AS impressions,
    MIN(i.date_start)         AS first_seen,
    MAX(i.date_start)         AS last_seen
  FROM `oneeighty-warehouse.stg.stg_meta_ad_insights` i
  LEFT JOIN `oneeighty-warehouse.ref.creative_tags` t
    ON t.client_id = i.client_id AND t.ad_id = i.ad_id
  WHERE i.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
    AND t.ad_id IS NULL
  GROUP BY i.client_id, i.ad_id
  HAVING SUM(i.spend) > 0
)
SELECT
  u.*,
  p.pipeline_start,
  (p.pipeline_start IS NULL OR u.first_seen < p.pipeline_start) AS before_pipeline
FROM unmapped u
LEFT JOIN pipeline p USING (client_id);
