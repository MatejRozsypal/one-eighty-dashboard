-- 005_create_raw_ecomail.sql
-- Raw layer for Ecomail (Czech email platform). Three tables:
--   - raw_ecomail_campaigns   : single-send broadcasts (cumulative all-time stats from /campaigns/all-stats/)
--   - raw_ecomail_automations : pipelines / flows (cumulative all-time stats from /pipelines/{id}/stats)
--   - raw_ecomail_lists       : subscriber-list health snapshots (from /lists + /lists/{id})
--
-- Field names mirror the actual Ecomail API responses (NOT prettified) so the n8n transforms
-- can pass through `appendOrUpdate`-style auto-mapping cleanly.
--
-- Quirks:
--   * Ecomail's `sent_at` arrives as a 14-digit string (YYYYMMDDHHMMSS). The n8n transform
--     parses it to ISO-8601 before insert. Stored here as TIMESTAMP.
--   * `/campaigns/all-stats/` returns an object keyed by campaign_id; the transform
--     unpacks Object.entries(stats) into one row per campaign.
--   * Pipeline stats endpoint is `/pipelines/{id}/stats` (NOT /all-stats — that 404s).
--   * Both campaigns and pipelines return CUMULATIVE all-time numbers. The mart layer
--     derives period stats by diffing snapshots — see metric_type column on automations.
--   * Run order: AFTER 002.
--
-- If existing empty raw_ecomail_* tables are present from an earlier draft, run
-- 005a_drop_raw_ecomail.sql first.

-- =============================================================================
-- CAMPAIGNS — single-send broadcasts. Cumulative stats — append-only, latest by ingested_at wins in stg.
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_ecomail_campaigns` (
  client_id         STRING    NOT NULL,
  ingested_at       TIMESTAMP NOT NULL,

  campaign_id       STRING    NOT NULL,
  title             STRING,
  sent_at           TIMESTAMP,                      -- parsed from 14-digit YYYYMMDDHHMMSS string

  -- Volumes (Ecomail's native field names)
  inject            INT64,                           -- attempted sends
  delivery          INT64,                           -- successfully delivered
  delivery_rate     NUMERIC,
  open              INT64,                           -- unique opens
  total_open        INT64,                           -- total opens (incl. repeat opens)
  open_rate         NUMERIC,
  click             INT64,                           -- unique clicks
  total_click       INT64,                           -- total clicks
  click_rate        NUMERIC,
  bounce            INT64,
  bounce_rate       NUMERIC,
  spam              INT64,
  spam_rate         NUMERIC,
  unsub             INT64,
  unsub_rate        NUMERIC,

  -- Revenue / attribution
  conversions       INT64,
  conversions_value NUMERIC,                         -- attributed revenue, currency = list currency
  currency          STRING,                          -- not in /campaigns response — populated from ref.clients

  payload_json      STRING                           -- full original API row (audit)
)
PARTITION BY DATE(sent_at)
CLUSTER BY client_id
OPTIONS (
  description = "Ecomail campaigns. Cumulative all-time stats from /campaigns/all-stats/. Append-only — multiple rows per campaign_id over time. Use latest by ingested_at in stg.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- AUTOMATIONS / PIPELINES / FLOWS — cumulative stats. Daily snapshot.
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_ecomail_automations` (
  client_id         STRING    NOT NULL,
  ingested_at       TIMESTAMP NOT NULL,
  snapshot_date     DATE      NOT NULL,              -- partition column

  pipeline_id       STRING    NOT NULL,
  list_id           STRING,                          -- the list this pipeline runs against
  name              STRING,
  created_at        TIMESTAMP,
  updated_at        TIMESTAMP,

  -- 'cumulative' = all-time stats from Ecomail (what the API returns natively)
  -- 'period'     = if we ever derive period stats by diffing snapshots
  metric_type       STRING    NOT NULL,

  -- Lifecycle counts
  triggered         INT64,
  active            INT64,
  ended             INT64,
  send              INT64,
  inject            INT64,

  -- Engagement (Ecomail's native field names)
  open              INT64,
  total_open        INT64,
  open_rate         NUMERIC,
  click             INT64,
  total_click       INT64,
  click_rate        NUMERIC,
  ctr               NUMERIC,
  bounce            INT64,
  bounce_rate       NUMERIC,
  soft_bounce       INT64,
  hard_bounce       INT64,
  spam              INT64,
  unsub             INT64,
  delivery_rate     NUMERIC,

  -- Revenue
  conversions       INT64,
  conversions_value NUMERIC,
  conversions_average NUMERIC,
  conversionrate    NUMERIC,                         -- yes, one word — Ecomail's actual key

  payload_json      STRING
)
PARTITION BY snapshot_date
CLUSTER BY client_id, pipeline_id
OPTIONS (
  description = "Ecomail automations (pipelines / flows). CUMULATIVE all-time stats from /pipelines/{id}/stats. Daily snapshot. Period metrics derived by diffing two snapshots in mart layer.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- LISTS — subscriber-list health snapshot. Daily.
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_ecomail_lists` (
  client_id          STRING    NOT NULL,
  ingested_at        TIMESTAMP NOT NULL,
  snapshot_date      DATE      NOT NULL,

  list_id            STRING    NOT NULL,
  list_name          STRING,

  active_subscribers INT64,                          -- from /lists top level
  -- Breakdown from /lists/{id}.subscribers
  subscribed         INT64,
  unsubscribed       INT64,
  hard_bounced       INT64,
  soft_bounced       INT64,                          -- not always returned; nullable
  complained         INT64,
  unconfirmed        INT64,
  unknown            INT64,

  currency           STRING,                          -- /lists/{id}.list.settings.currency
  locale             STRING,                          -- /lists/{id}.list.settings.locale
  created            TIMESTAMP,                       -- list creation date

  payload_json       STRING
)
PARTITION BY snapshot_date
CLUSTER BY client_id, list_id
OPTIONS (
  description = "Ecomail subscriber-list health. Daily snapshot from /lists + /lists/{id}.",
  require_partition_filter = TRUE
);
