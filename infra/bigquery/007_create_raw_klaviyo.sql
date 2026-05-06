-- 007_create_raw_klaviyo.sql
-- Raw layer for Klaviyo (Dr. Dobias). Three tables: campaigns, flows, events.
--
-- Like Ecomail: flows are CUMULATIVE all-time stats. Use metric_type to flag.
-- Events are individual user actions (Received Email, Opened Email, Clicked Email, Placed Order, etc.)
--
-- Run order: AFTER 002.

-- =============================================================================
-- CAMPAIGNS — broadcast sends
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_klaviyo_campaigns` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,

  campaign_id          STRING    NOT NULL,
  campaign_name        STRING,
  channel              STRING,                  -- email | sms
  status               STRING,                  -- draft | sending | sent | cancelled
  send_time            TIMESTAMP,

  list_id              STRING,
  list_name            STRING,
  segment_id           STRING,

  -- Send stats
  recipients           INT64,
  delivered            INT64,
  bounces              INT64,

  -- Engagement
  opens                INT64,
  unique_opens         INT64,
  open_rate            NUMERIC,
  clicks               INT64,
  unique_clicks        INT64,
  click_rate           NUMERIC,
  unsubscribes         INT64,
  spam_complaints      INT64,

  -- Revenue (Klaviyo's attributed revenue)
  conversions          INT64,
  revenue              NUMERIC,
  currency             STRING,

  payload_json         STRING
)
PARTITION BY DATE(send_time)
CLUSTER BY client_id, channel
OPTIONS (
  description = "Klaviyo campaigns. Period-windowed metrics — sums correctly across any date range.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- FLOWS — automated sequences (cumulative)
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_klaviyo_flows` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  snapshot_date        DATE      NOT NULL,

  flow_id              STRING    NOT NULL,
  flow_name            STRING,
  status               STRING,                  -- live | paused | draft
  trigger_type         STRING,                  -- list | metric | date-based

  -- 'cumulative' = Klaviyo's all-time
  -- 'period'     = derived from event-level diff
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
CLUSTER BY client_id, flow_id
OPTIONS (
  description = "Klaviyo flows. Daily snapshots of cumulative stats. Diff snapshots for period attribution.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- EVENTS — individual user actions (the gold)
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_klaviyo_events` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,

  event_id             STRING    NOT NULL,
  event_name           STRING    NOT NULL,     -- 'Received Email', 'Opened Email', 'Placed Order', etc.
  event_date           DATE      NOT NULL,
  event_timestamp      TIMESTAMP,

  -- Profile (the customer)
  profile_id           STRING,
  profile_email        STRING,                  -- PII — frontend SA must not see this column

  -- Attribution
  campaign_id          STRING,
  flow_id              STRING,
  message_id           STRING,
  metric_id            STRING,

  -- Revenue (when event_name = 'Placed Order')
  revenue              NUMERIC,
  currency             STRING,
  order_id             STRING,                  -- joins to raw_shopify_orders

  payload_json         STRING
)
PARTITION BY event_date
CLUSTER BY client_id, event_name
OPTIONS (
  description = "Klaviyo events. The atomic engagement layer. Every email open, click, conversion. PII-bearing.",
  require_partition_filter = TRUE
);
