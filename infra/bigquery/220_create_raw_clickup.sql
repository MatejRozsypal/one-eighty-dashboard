-- 220_create_raw_clickup.sql
-- Creative Engine, phase 1b: the ClickUp landing zone and its two registries.
--
-- Nothing in the repo touched ClickUp before this. There is no ClickUp secret,
-- no workflow and no raw table — see runbooks/27_clickup_to_bigquery.md, which
-- is the executable half of this file.
--
-- Run order: AFTER 002 (ref.clients must exist).

-- =============================================================================
-- RAW TASKS — append-only snapshot, exactly like the Meta raw tables
-- =============================================================================
-- Custom fields land as a repeated STRUCT rather than one column per field.
-- Per-field columns would mean a migration every time somebody adds a dropdown
-- in ClickUp, and the field set is still changing — `Offer`, `Creator`, `Body`,
-- `Hook` and `Production cost` do not exist yet at all.
--
-- `value_text` carries the RESOLVED dropdown label, never the orderindex
-- integer ClickUp returns. The integer is meaningless six months later, and
-- meaningless-but-plausible is the failure mode that survives review.
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_clickup_tasks` (
  client_id     STRING    NOT NULL,
  ingested_at   TIMESTAMP NOT NULL,
  snapshot_date DATE      NOT NULL,

  list_kind     STRING    NOT NULL,               -- 'ad_pipeline' | 'concepts' | 'personas'
  list_id       STRING    NOT NULL,
  task_id       STRING    NOT NULL,
  task_name     STRING,
  task_url      STRING,
  status        STRING,
  status_type   STRING,

  date_created  TIMESTAMP,
  date_updated  TIMESTAMP,
  date_closed   TIMESTAMP,
  assignees     ARRAY<STRING>,

  custom_fields ARRAY<STRUCT<
    field_id   STRING,
    name       STRING,
    type       STRING,
    value_text STRING,                            -- resolved label for dropdowns
    value_num  NUMERIC,
    value_ids  ARRAY<STRING>                      -- related task ids for relationships
  >>,

  payload_json  STRING
)
PARTITION BY snapshot_date
CLUSTER BY client_id, list_kind, task_id
OPTIONS (
  description = "ClickUp tasks from the three creative lists per client. Append-only daily snapshot; stg dedupes on (client_id, task_id) by newest ingested_at.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- RAW FIELD DEFINITIONS — snapshot of GET /list/{id}/field
-- =============================================================================
-- Fetched on every sync for two reasons. The first is mechanical: ClickUp
-- returns a dropdown's value as the option's `orderindex` INTEGER, not its
-- label, so resolving "2" to "Testovaci sada" needs the definition. The second
-- is the one that matters: comparing what ClickUp actually has against the
-- curated field map is how a field pointing at the wrong client's list gets
-- noticed instead of quietly working.
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_clickup_fields` (
  client_id     STRING    NOT NULL,
  ingested_at   TIMESTAMP NOT NULL,
  snapshot_date DATE      NOT NULL,
  list_kind     STRING    NOT NULL,
  list_id       STRING    NOT NULL,
  field_id      STRING    NOT NULL,
  name          STRING,
  type          STRING,
  -- For a list_relationship field: the list it points at. This is the column
  -- that catches Venev's `Concept` field aiming at Manami's concept list.
  target_list_id STRING,
  options_json  STRING,                           -- [{orderindex, name, id}, ...]
  payload_json  STRING
)
PARTITION BY snapshot_date
CLUSTER BY client_id, list_kind
OPTIONS (
  description = "ClickUp custom-field definitions per list. Resolves dropdown orderindex to label, and is what the field-map drift check compares against.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- LIST REGISTRY — which three lists belong to which client
-- =============================================================================
-- Onboarding a client means duplicating the `_Template client` folder
-- (901516477964) and inserting three rows here. Same principle as ref.clients:
-- the workflow loops over a registry, it never carries a per-client branch.
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.clickup_lists` (
  client_id STRING NOT NULL,
  list_kind STRING NOT NULL,                      -- 'ad_pipeline' | 'concepts' | 'personas'
  list_id   STRING NOT NULL,
  folder_id STRING,
  active    BOOL   NOT NULL
)
OPTIONS (description = "Maps each client to its ClickUp ad pipeline, concept and persona lists.");

MERGE `oneeighty-warehouse.ref.clickup_lists` T
USING (
  SELECT * FROM UNNEST([
    STRUCT('manami' AS client_id, 'ad_pipeline' AS list_kind, '901521546599' AS list_id, CAST(NULL AS STRING) AS folder_id, TRUE AS active),
    STRUCT('manami', 'concepts',    '901523916078', CAST(NULL AS STRING), TRUE),
    STRUCT('manami', 'personas',    '901523916330', CAST(NULL AS STRING), TRUE),
    STRUCT('venev',  'ad_pipeline', '901524795825', CAST(NULL AS STRING), TRUE),
    STRUCT('venev',  'concepts',    '901524795828', CAST(NULL AS STRING), TRUE),
    STRUCT('venev',  'personas',    '901524795826', CAST(NULL AS STRING), TRUE)
  ])
) S
ON T.client_id = S.client_id AND T.list_kind = S.list_kind
WHEN MATCHED THEN UPDATE SET list_id = S.list_id, active = S.active
WHEN NOT MATCHED THEN INSERT ROW;

-- =============================================================================
-- FIELD MAP — logical name to ClickUp field UUID, per client and list
-- =============================================================================
-- Most fields on the ad pipeline are SPACE-level and so share a UUID across
-- clients. Relationship fields do not, and one of them is currently wrong:
-- Venev's ad pipeline carries a `Concept` field (05c15839-…) pointing at
-- MANAMI's concept list. Left in place, the sync attaches Venev ads to Manami
-- concepts and nothing complains.
--
-- The loader therefore resolves fields THROUGH THIS TABLE and ignores any
-- relationship field it does not name. It refreshes the map from
-- GET /list/{id}/field on every run and WARNS — never silently picks — when a
-- logical name resolves to more than one field. Silent duplicate resolution is
-- precisely how the Venev defect would have propagated unnoticed.
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.clickup_field_map` (
  client_id  STRING NOT NULL,
  list_kind  STRING NOT NULL,
  logical    STRING NOT NULL,                     -- 'creative_id', 'concept_rel', …
  field_id   STRING NOT NULL,
  field_type STRING NOT NULL,
  -- Set when the loader saw a second field answering to the same logical name.
  -- Surfaced on the Data Health page rather than resolved by guessing.
  ambiguous_with STRING,
  synced_at  TIMESTAMP
)
OPTIONS (description = "Logical field name to ClickUp custom-field UUID. Refreshed every sync; ambiguity is recorded, never resolved by guessing.");

-- Verified against the live workspace on 8 Sep 2026. The loader overwrites
-- these on its first run; they are seeded so a first run has something to
-- validate against rather than discovering the schema and trusting it.
MERGE `oneeighty-warehouse.ref.clickup_field_map` T
USING (
  SELECT * FROM UNNEST([
    -- Space-level, shared across every client
    STRUCT('manami' AS client_id, 'ad_pipeline' AS list_kind, 'creative_id' AS logical, 'a80bdd5a-b4e5-4e70-81ce-0be80d57b768' AS field_id, 'short_text' AS field_type),
    STRUCT('manami', 'ad_pipeline', 'content_format', '4bac144c-3d1f-465f-b8e8-0b8d6903297c', 'drop_down'),
    STRUCT('manami', 'ad_pipeline', 'production_type','27534262-67e8-4dfd-b669-1e62618de015', 'drop_down'),
    STRUCT('manami', 'ad_pipeline', 'market',         '4ec43059-4de0-410c-a097-b1496acc25bf', 'drop_down'),
    STRUCT('manami', 'ad_pipeline', 'visual_type',    'db1172b8-0b1a-4d47-84e4-ab627937ac77', 'drop_down'),
    STRUCT('venev',  'ad_pipeline', 'creative_id',    'a80bdd5a-b4e5-4e70-81ce-0be80d57b768', 'short_text'),
    STRUCT('venev',  'ad_pipeline', 'content_format', '4bac144c-3d1f-465f-b8e8-0b8d6903297c', 'drop_down'),
    STRUCT('venev',  'ad_pipeline', 'production_type','27534262-67e8-4dfd-b669-1e62618de015', 'drop_down'),
    STRUCT('venev',  'ad_pipeline', 'market',         '4ec43059-4de0-410c-a097-b1496acc25bf', 'drop_down'),
    STRUCT('venev',  'ad_pipeline', 'visual_type',    'db1172b8-0b1a-4d47-84e4-ab627937ac77', 'drop_down'),
    -- Relationship fields: per-client, and the ONLY concept field each client
    -- may use. Venev's stale 05c15839-… is deliberately absent, so the loader
    -- ignores it even while it still exists in ClickUp.
    STRUCT('manami', 'ad_pipeline', 'concept_rel', '248a6bfa-d0f7-41e4-a130-64b0eeddbfbe', 'list_relationship'),
    STRUCT('venev',  'ad_pipeline', 'concept_rel', 'bcf4d0be-3b8c-46b6-975c-c3958fb5c77c', 'list_relationship')
  ])
) S
ON T.client_id = S.client_id AND T.list_kind = S.list_kind AND T.logical = S.logical
WHEN MATCHED THEN UPDATE SET field_id = S.field_id, field_type = S.field_type
WHEN NOT MATCHED THEN INSERT (client_id, list_kind, logical, field_id, field_type, synced_at)
  VALUES (S.client_id, S.list_kind, S.logical, S.field_id, S.field_type, CURRENT_TIMESTAMP());
