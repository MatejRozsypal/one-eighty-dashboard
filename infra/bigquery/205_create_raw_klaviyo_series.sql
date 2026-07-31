-- =============================================================================
-- 205 — Raw landing tables for Klaviyo DAILY time-series + subscriber growth.
-- Feeds the date-picker-driven Email dashboard (runbook 19).
--
-- campaign_series / flow_series: one row per (entity, metric_date) from the
--   *-series-reports endpoints (interval=daily). Daily buckets are non-overlapping,
--   so stg can SUM across dates safely (no double-count — unlike values-reports).
-- subscriber_daily: daily new / exclusions / point-in-time total (metric-aggregates
--   + a daily segment-size snapshot).
--
-- All three: PARTITION BY DATE(ingested_at), require_partition_filter (append-only
-- snapshots; stg takes latest snapshot per entity-day).
-- =============================================================================

CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_klaviyo_campaign_series` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  ingest_source        STRING,
  metric_date          DATE      NOT NULL,
  campaign_id          STRING    NOT NULL,
  campaign_message_id  STRING,
  send_channel         STRING,
  recipients           NUMERIC,
  delivered            NUMERIC,
  bounced              NUMERIC,
  opens                NUMERIC,
  opens_unique         NUMERIC,
  clicks               NUMERIC,
  clicks_unique        NUMERIC,
  conversions          NUMERIC,
  conversion_value     NUMERIC,
  unsubscribes         NUMERIC,
  spam_complaints      NUMERIC,
  payload_json         STRING
)
PARTITION BY DATE(ingested_at)
CLUSTER BY client_id, campaign_id
OPTIONS (require_partition_filter = TRUE);

CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_klaviyo_flow_series` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  ingest_source        STRING,
  metric_date          DATE      NOT NULL,
  flow_id              STRING    NOT NULL,
  flow_message_id      STRING,
  send_channel         STRING,
  recipients           NUMERIC,
  delivered            NUMERIC,
  bounced              NUMERIC,
  opens                NUMERIC,
  opens_unique         NUMERIC,
  clicks               NUMERIC,
  clicks_unique        NUMERIC,
  conversions          NUMERIC,
  conversion_value     NUMERIC,
  unsubscribes         NUMERIC,
  spam_complaints      NUMERIC,
  payload_json         STRING
)
PARTITION BY DATE(ingested_at)
CLUSTER BY client_id, flow_id
OPTIONS (require_partition_filter = TRUE);

CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_klaviyo_subscriber_daily` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  ingest_source        STRING,
  metric_date          DATE      NOT NULL,
  channel              STRING,             -- 'email' | 'sms'
  total_subscribers    INT64,              -- point-in-time segment size snapshot
  new_subscribers      INT64,              -- metric-aggregates: Subscribed to Email Marketing
  exclusions           INT64,              -- unsubscribes + bounces + spam complaints
  payload_json         STRING
)
PARTITION BY DATE(ingested_at)
CLUSTER BY client_id
OPTIONS (require_partition_filter = TRUE);
