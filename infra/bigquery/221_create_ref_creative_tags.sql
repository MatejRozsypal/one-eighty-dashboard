-- 221_create_ref_creative_tags.sql
-- Creative Engine, phase 1c: the tagging spine.
--
-- These four tables are what turn a grid of ad IDs into an answer about which
-- personas, concepts, angles and offers earned the spend. Everything else in
-- this product is a projection of them.
--
-- All four are REBUILT IN FULL by the ClickUp sync on every run. They are a few
-- thousand rows; incremental logic here buys nothing but bugs.
--
-- Run order: AFTER 220.

-- =============================================================================
-- PERSONAS — the Persona Bank, one row per persona
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.personas` (
  client_id       STRING NOT NULL,
  persona_id      STRING NOT NULL,
  name            STRING,
  awareness       STRING,                         -- unaware … most aware
  segment         STRING,
  status          STRING,                         -- active | draft | dormant
  clickup_task_id STRING,
  clickup_url     STRING,
  synced_at       TIMESTAMP
)
OPTIONS (description = "Persona Bank, synced from each client's ClickUp persona list. Dormancy is computed from spend, not stored — see mart_creative_persona_capacity.");

-- =============================================================================
-- CONCEPTS — persona x angle x offer. Exactly one of each.
-- =============================================================================
-- SOP_master section 4.4: change the angle or the persona and it is a NEW
-- concept with a new ConceptID. That rule is what makes a concept measurable,
-- so `angle` and `persona_id` are scalars here, never arrays. If ClickUp
-- returns two angles on one concept the loader records the first and raises it
-- as a data-quality row rather than concatenating them into something that
-- reads like a finding.
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.concepts` (
  client_id       STRING NOT NULL,
  concept_id      STRING NOT NULL,                -- 'C07', or the ClickUp task id
  -- What a person actually wrote in `Concept ID`, or NULL. concept_id falls
  -- back to the task id so the joins always work; this one never does, so the
  -- UI can tell a chosen code from a database key.
  concept_code    STRING,
  name            STRING,
  persona_id      STRING,
  angle           STRING,                         -- one of the 18-value vocabulary
  offer           STRING,
  hypothesis      STRING,
  status          STRING,
  created_at      DATE,
  clickup_task_id STRING,
  clickup_url     STRING,
  -- TRUE when ClickUp held more than one angle or persona on this concept.
  -- Surfaced in the UI; never averaged away.
  multi_valued    BOOL,
  synced_at       TIMESTAMP
)
OPTIONS (description = "Creative concepts. One angle, one persona, one offer each — SOP_master 4.4.");

-- =============================================================================
-- CREATORS — who made it, and what that costs per ad
-- =============================================================================
-- Pay structures vary, so cost per ad is DERIVED from pay_model rather than
-- stored as one number that means something different per creator:
--
--   flat_per_asset    rate
--   per_shoot         rate / deliverables_per_shoot
--   product_gift      product_cogs
--   base_plus_usage   (rate / deliverables_per_shoot) + usage_fee
--   rev_share         rev_share_pct * attributed revenue, recomputed nightly
--   internal          from production_rates for that method and format
--
-- The derivation lives in dashboard/lib/creative/cost.ts so the Production ROI
-- screen and any future report cannot disagree about it.
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.creators` (
  client_id             STRING  NOT NULL,
  creator_id            STRING  NOT NULL,
  name                  STRING,
  creator_type          STRING,                   -- Agency | Brand employee | UGC creator | Influencer
  pay_model             STRING,                   -- see the table above
  rate                  NUMERIC,
  deliverables_per_shoot INT64,
  product_cogs          NUMERIC,
  usage_fee             NUMERIC,
  rev_share_pct         NUMERIC,
  active                BOOL,
  synced_at             TIMESTAMP
)
OPTIONS (description = "Creator registry and pay model. Cost per ad is derived from pay_model, never stored flat.");

-- =============================================================================
-- CREATIVE TAGS — the join. One row per (client_id, ad_id).
-- =============================================================================
-- ── Why this is many-to-one onto the ClickUp task ──────────────────────────
-- Post-ID graduation gives the same creative a SECOND Meta ad_id: the original
-- keeps running in its test ad set while a duplicate-by-post-ID runs in the
-- Scale campaign. Both are the same creative and the same task, so the ClickUp
-- `Creative ID` field is a comma-separated list and this table gets one row per
-- id. Modelling it one-to-one would force a choice between losing the scale
-- spend and double-counting the concept.
--
-- ── Why persona/angle/offer are denormalised from the CONCEPT ──────────────
-- An ad INHERITS them and cannot override them (SOP_master 4.4). Copying them
-- down at sync time means every query is a single scan and no query can
-- accidentally read an ad-level override that is not supposed to exist.
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.creative_tags` (
  client_id       STRING  NOT NULL,
  ad_id           STRING  NOT NULL,
  clickup_task_id STRING,
  clickup_url     STRING,

  concept_id      STRING,
  persona_id      STRING,
  angle           STRING,                         -- FROM THE CONCEPT. Never per-ad.
  offer           STRING,                         -- FROM THE CONCEPT. Never per-ad.

  stage           STRING,                         -- TOF | MOF | BOF, parsed from the ad name
  -- ClickUp's `Content Purpose`: Net-new | Offer-Promo | Winner Variant. This
  -- is the stated net-new-versus-iteration split the 80/20 rule turns on, and
  -- it is NOT the funnel stage however much the field name suggests otherwise.
  production_type STRING,
  format          STRING,                         -- STAT | DYN | CAR | DPA
  body_code       STRING,                         -- 'b1'
  hook_code       STRING,                         -- 'h3'

  production_method STRING,
  creator_id        STRING,
  creator_type      STRING,
  production_cost   NUMERIC,
  production_cost_source STRING,                  -- 'settings' | 'manual'

  brief_url       STRING,
  market          STRING,
  launched_at     DATE,

  -- How this row came to exist. Only 'creative_id' is machine-applied; every
  -- other method required a human to press Confirm, which then wrote the id
  -- back into ClickUp so the next sync resolves it as 'creative_id'.
  match_method     STRING,                        -- creative_id | name_exact | name_fuzzy | manual
  match_confidence NUMERIC,
  synced_at        TIMESTAMP
)
OPTIONS (description = "The join between Meta ad_ids and ClickUp creative tasks. Many ad_ids per task — post-ID graduation. Rebuilt in full every sync.");

-- =============================================================================
-- DATA-QUALITY LOG — what the sync refused to guess at
-- =============================================================================
-- Written by the same sync, read by the Data Health page. The alternative to a
-- table like this is a workflow that resolves ambiguity quietly, which is how
-- the Venev concept-field defect would have reached a client report.
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ops.clickup_sync_issues` (
  synced_at   TIMESTAMP NOT NULL,
  client_id   STRING,
  severity    STRING,                             -- 'warn' | 'error'
  kind        STRING,                             -- 'ambiguous_field' | 'multi_angle' | 'cross_client_concept' | 'placeholder_creative_id' | ...
  entity_id   STRING,
  detail      STRING
)
PARTITION BY DATE(synced_at)
OPTIONS (description = "Everything the ClickUp sync declined to resolve by guessing.");
