-- 005_create_raw_ecomail.sql
-- Raw layer for Ecomail (Czech email platform). Three tables: campaigns, automations (flows), subscribers.
--
-- IMPORTANT: Ecomail's flows endpoint returns CUMULATIVE all-time stats, not period-windowed.
-- We tag every row with metric_type so the mart layer treats them differently from campaigns.
--
-- Run order: AFTER 002.

-- =============================================================================
-- CAMPAIGNS — single-send broadcasts
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_ecomail_campaigns` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,

  campaign_id          STRING    NOT NULL,
  campaign_name        STRING,
  campaign_type        STRING,                  -- newsletter | abtest | etc.
  language             STRING,                  -- cs | sk | en — for CZ/SK split
  status               STRING,
  sent_at              TIMESTAMP,

  list_id              STRING,
  list_name            STRING,

  -- Engagement
  recipients           INT64,
  delivered            INT64,
  bounces              INT64,
  hard_bounces         INT64,
  soft_bounces         INT64,
  opens                INT64,
  unique_opens         INT64,
  open_rate            NUMERIC,
  clicks               INT64,
  unique_clicks        INT64,
  click_rate           NUMERIC,
  unsubscribes         INT64,
  spam_complaints      INT64,

  -- Revenue (Ecomail conversion tracking)
  conversions          INT64,
  revenue              NUMERIC,
  currency             STRING,

  payload_json         STRING
)
PARTITION BY DATE(sent_at)
CLUSTER BY client_id, language
OPTIONS (
  description = "Ecomail campaigns. Period-windowed metrics — sums correctly across any date range.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- AUTOMATIONS / FLOWS — cumulative stats
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_ecomail_automations` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  snapshot_date        DATE      NOT NULL,      -- the date this snapshot was taken (partition key)

  automation_id        STRING    NOT NULL,
  automation_name      STRING,
  status               STRING,
  -- 'cumulative' = all-time stats from Ecomail (what the API returns natively)
  -- 'period'     = if we ever derive period stats by diffing snapshots
  metric_type          STRING    NOT NULL,

  emails_sent          INT64,
  delivered            INT64,
  opens                INT64,
  unique_opens         INT64,
  open_rate            NUMERIC,
  clicks               INT64,
  unique_clicks        INT64,
  click_rate           NUMERIC,

  conversions          INT64,
  revenue              NUMERIC,
  currency             STRING,

  payload_json         STRING
)
PARTITION BY snapshot_date
CLUSTER BY client_id, automation_id
OPTIONS (
  description = "Ecomail automations (flows). CUMULATIVE all-time stats — re-snapshot daily. To derive period metrics, diff two snapshots.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- SUBSCRIBERS — list health snapshot
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_ecomail_subscribers` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  snapshot_date        DATE      NOT NULL,

  list_id              STRING    NOT NULL,
  list_name            STRING,
  total_subscribers    INT64,
  active_subscribers   INT64,
  unsubscribed         INT64,
  bounced              INT64,
  spam_complained      INT64,
  payload_json         STRING
)
PARTITION BY snapshot_date
CLUSTER BY client_id, list_id
OPTIONS (
  description = "Ecomail subscriber counts. Daily snapshot per list.",
  require_partition_filter = TRUE
);
