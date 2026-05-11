-- 009_create_raw_meta_ads.sql
-- Raw layer for Meta Ads (Marketing API insights).
-- Two tables: campaign-level daily insights, ad-level daily insights.
--
-- Schemas based on actual /act_<id>/insights responses captured 2026-05-08.
-- See infra/samples/meta_campaign_insights.json and meta_ad_insights.json.
--
-- Strategy:
--   * Insights are PERIOD-windowed (date_start..date_stop) — sum-safe across dates.
--   * Daily granularity: n8n requests with time_increment=1 so each row covers one day.
--   * Append-only — multiple rows per (client_id, campaign_id, date_start) possible if
--     Meta restates conversion attribution; mart layer takes latest by ingested_at.
--   * `actions` and `action_values` arrays preserve EVERY conversion event type
--     so the mart layer can pivot any conversion event later without re-ingest.
--   * Common metrics (purchases, revenue, ROAS) duplicated as flat columns for
--     fast queries; full arrays available for everything else.
--
-- Run order: AFTER 002.

-- =============================================================================
-- META AD ACCOUNT (slow-changing dimension, optional but cheap)
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_meta_ad_accounts` (
  client_id        STRING    NOT NULL,
  ingested_at      TIMESTAMP NOT NULL,
  snapshot_date    DATE      NOT NULL,

  ad_account_id    STRING    NOT NULL,            -- e.g. 'act_2132171383582833'
  name             STRING,
  currency         STRING,
  timezone         STRING,
  business_id      STRING,

  payload_json     STRING
)
PARTITION BY snapshot_date
CLUSTER BY client_id
OPTIONS (
  description = "Meta ad account metadata. Daily snapshot.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- CAMPAIGN-LEVEL DAILY INSIGHTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_meta_campaign_insights` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  ingest_source        STRING    NOT NULL,        -- 'backfill' | 'reconcile' | 'realtime'

  ad_account_id        STRING    NOT NULL,
  campaign_id          STRING    NOT NULL,
  campaign_name        STRING,

  -- Reporting window. With time_increment=1, date_start = date_stop = single day.
  date_start           DATE      NOT NULL,
  date_stop            DATE      NOT NULL,

  -- Core delivery (sum-safe)
  spend                NUMERIC,
  impressions          INT64,
  reach                INT64,
  frequency            NUMERIC,

  -- Engagement (sum-safe except CTR/CPC which are derived)
  clicks               INT64,
  ctr                  NUMERIC,
  cpc                  NUMERIC,

  -- Common conversion metrics extracted from actions[] for fast queries.
  -- Use the omni_* variants where available; they de-dupe cross-device.
  purchases            INT64,                     -- actions[].omni_purchase
  purchase_value       NUMERIC,                   -- action_values[].omni_purchase
  add_to_cart          INT64,                     -- actions[].add_to_cart
  initiate_checkout    INT64,                     -- actions[].initiate_checkout
  landing_page_views   INT64,                     -- actions[].landing_page_view
  link_clicks          INT64,                     -- actions[].link_click
  video_views          INT64,                     -- actions[].video_view (FB definition)
  purchase_roas        NUMERIC,                   -- purchase_roas[].omni_purchase

  -- Full arrays for any conversion not pulled out above.
  -- Mart can pivot these for funnel views, custom event tracking, etc.
  actions              ARRAY<STRUCT<action_type STRING, value NUMERIC>>,
  action_values        ARRAY<STRUCT<action_type STRING, value NUMERIC>>,

  payload_json         STRING
)
PARTITION BY date_start
CLUSTER BY client_id, campaign_id
OPTIONS (
  description = "Meta Ads campaign-level daily insights. Period metrics — sum-safe across date ranges.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- AD-LEVEL DAILY INSIGHTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_meta_ad_insights` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  ingest_source        STRING    NOT NULL,

  ad_account_id        STRING    NOT NULL,
  campaign_id          STRING    NOT NULL,
  adset_id             STRING,
  ad_id                STRING    NOT NULL,
  ad_name              STRING,

  date_start           DATE      NOT NULL,
  date_stop            DATE      NOT NULL,

  spend                NUMERIC,
  impressions          INT64,
  reach                INT64,
  frequency            NUMERIC,

  clicks               INT64,
  ctr                  NUMERIC,
  cpc                  NUMERIC,

  purchases            INT64,
  purchase_value       NUMERIC,
  add_to_cart          INT64,
  initiate_checkout    INT64,
  landing_page_views   INT64,
  link_clicks          INT64,
  video_views          INT64,                     -- actions[].video_view
  video_play_actions   INT64,                     -- video_play_actions[].video_view (3s+ Meta definition)
  video_thruplays      INT64,                     -- video_thruplay_watched_actions[].video_view

  actions                          ARRAY<STRUCT<action_type STRING, value NUMERIC>>,
  action_values                    ARRAY<STRUCT<action_type STRING, value NUMERIC>>,
  video_play_actions_raw           ARRAY<STRUCT<action_type STRING, value NUMERIC>>,
  video_thruplay_watched_actions_raw ARRAY<STRUCT<action_type STRING, value NUMERIC>>,

  payload_json         STRING
)
PARTITION BY date_start
CLUSTER BY client_id, ad_id
OPTIONS (
  description = "Meta Ads ad-level daily insights. Period metrics — sum-safe across date ranges.",
  require_partition_filter = TRUE
);
