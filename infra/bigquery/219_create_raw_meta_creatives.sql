-- 219_create_raw_meta_creatives.sql
-- Creative Engine, phase 1a: the Meta side of the warehouse.
--
-- Four new raw objects plus an ALTER on the existing ad-insights table:
--
--   1. raw_meta_ad_creatives          the creative itself — asset, copy, format
--   2. raw_meta_adset_insights        ad-set daily. Missing entirely until now
--   3. raw_meta_ad_breakdown_demo     age x gender, ad level, daily
--   4. raw_meta_ad_breakdown_placement publisher_platform x platform_position
--   5. ALTER raw_meta_ad_insights     video quartiles + outbound clicks
--
-- See CREATIVE_ENGINE_BRIEF.md section 4.1 and runbooks/28_meta_creative_assets.md.
-- Run order: AFTER 009. API version pinned at v22.0, matching the workflow.
--
-- ── Why ad-set grain is its own table rather than a SUM over ads ────────────
-- Every money verdict in the decision engine is taken at ad-set level or above
-- (07-analyzing.md gate order). Reconstructing that by summing ad rows loses
-- `adset_name`, and silently drops any ad set with delivery but no ad rows —
-- which is exactly the case where something is wrong and you want to see it.

-- =============================================================================
-- 1. AD CREATIVES — one row per (client, ad) per nightly snapshot
-- =============================================================================
-- Snapshot rather than upsert, matching every other raw table here: the stg
-- view takes the newest row per (client_id, ad_id). An ad's creative can change
-- underneath its id (Advantage+ rotates text), so keeping the history is free
-- and the alternative is silently overwriting evidence.
--
-- `image_hash` and `video_id` are the STABLE identifiers. Meta's `image_url`
-- and `thumbnail_url` carry signed tokens that expire within hours, so they are
-- deliberately NOT the serving path — `asset_uri` points at our own GCS mirror
-- and is what the dashboard renders. Storing Meta's URL and rendering it a day
-- later fills the grid with broken images.
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_meta_ad_creatives` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  snapshot_date        DATE      NOT NULL,

  ad_id                STRING    NOT NULL,
  creative_id          STRING,
  adset_id             STRING,
  adset_name           STRING,
  campaign_id          STRING,
  campaign_name        STRING,
  effective_status     STRING,                    -- ACTIVE | PAUSED | ARCHIVED | ...

  object_type          STRING,                    -- VIDEO | SHARE | PHOTO | DPA
  image_hash           STRING,                    -- stable; the URL is not
  video_id             STRING,                    -- stable; the source URL is not
  effective_object_story_id STRING,               -- the post ID. Graduation key.

  -- Copy, as Meta serves it. Single image/video ads carry one of each; an
  -- Advantage+ or dynamic ad carries several, and the *_json columns hold the
  -- full rotation while the scalar holds the first.
  title                STRING,
  body                 STRING,
  link_description     STRING,
  call_to_action_type  STRING,
  link_url             STRING,
  bodies_json          STRING,                    -- asset_feed_spec.bodies[]
  titles_json          STRING,                    -- asset_feed_spec.titles[]
  descriptions_json    STRING,                    -- asset_feed_spec.descriptions[]

  -- The GCS mirror. NULL asset_uri means the download has not happened or was
  -- refused (video source needs the video permission on the system user); the
  -- UI shows the thumbnail and says so rather than rendering a broken frame.
  asset_uri            STRING,                    -- gs://oneeighty-creatives/...
  asset_kind           STRING,                    -- image | video
  thumb_uri            STRING,                    -- 400px webp
  asset_bytes          INT64,
  video_length_sec     NUMERIC,                   -- needed to scale the retention curve

  payload_json         STRING
)
PARTITION BY snapshot_date
CLUSTER BY client_id, ad_id
OPTIONS (
  description = "Meta ad creatives: asset pointers, copy and format. Daily snapshot. Assets are mirrored to GCS because Meta's CDN URLs expire — see runbooks/28.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- 2. AD SET DAILY INSIGHTS — the grain money verdicts are taken at
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_meta_adset_insights` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  ingest_source        STRING    NOT NULL,        -- 'backfill' | 'cron'

  ad_account_id        STRING    NOT NULL,
  campaign_id          STRING    NOT NULL,
  campaign_name        STRING,
  adset_id             STRING    NOT NULL,
  adset_name           STRING,

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
  outbound_clicks      INT64,

  actions              ARRAY<STRUCT<action_type STRING, value NUMERIC>>,
  action_values        ARRAY<STRUCT<action_type STRING, value NUMERIC>>,

  payload_json         STRING
)
PARTITION BY date_start
CLUSTER BY client_id, adset_id
OPTIONS (
  description = "Meta Ads ad-set-level daily insights. Period metrics — sum-safe across date ranges. The grain every scale/kill verdict is taken at.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- 3 + 4. BREAKDOWNS — delivery diagnosis, not ROAS comparison
-- =============================================================================
-- Row multiplier is roughly 12x for age x gender and 8x for placement. On
-- Manami's volume that is a few thousand rows a day, which is nothing.
--
-- ⚠ Purchase counts inside a breakdown are a fraction of an already small
-- number: one ad split six ways by age has single-digit purchases per bucket.
-- The columns exist so the UI can gate them behind the same confidence rules as
-- everything else — they are NOT there to rank age groups by ROAS. Read these
-- for "where is Meta putting this and is that where the buyer is".
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_meta_ad_breakdown_demo` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  ad_account_id        STRING,
  ad_id                STRING    NOT NULL,
  date_start           DATE      NOT NULL,
  date_stop            DATE,

  age                  STRING    NOT NULL,        -- '18-24' … '65+'
  gender               STRING    NOT NULL,        -- female | male | unknown

  spend                NUMERIC,
  impressions          INT64,
  reach                INT64,
  clicks               INT64,
  purchases            INT64,
  purchase_value       NUMERIC,

  payload_json         STRING
)
PARTITION BY date_start
CLUSTER BY client_id, ad_id
OPTIONS (
  description = "Meta ad-level daily insights broken down by age and gender. For delivery diagnosis; purchase counts per bucket are too thin to rank on.",
  require_partition_filter = TRUE
);

CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_meta_ad_breakdown_placement` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  ad_account_id        STRING,
  ad_id                STRING    NOT NULL,
  date_start           DATE      NOT NULL,
  date_stop            DATE,

  publisher_platform   STRING    NOT NULL,        -- facebook | instagram | audience_network | messenger
  platform_position    STRING    NOT NULL,        -- feed | story | reels | ...
  impression_device    STRING,

  spend                NUMERIC,
  impressions          INT64,
  reach                INT64,
  clicks               INT64,
  purchases            INT64,
  purchase_value       NUMERIC,

  payload_json         STRING
)
PARTITION BY date_start
CLUSTER BY client_id, ad_id
OPTIONS (
  description = "Meta ad-level daily insights broken down by publisher platform and position. Delivery diagnosis.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- 5. EXTRA FIELDS ON THE EXISTING AD-INSIGHTS TABLE
-- =============================================================================
-- These are extra `fields` on a request the hourly workflow already makes, so
-- the ingestion cost is one line in a node config.
--
-- Together with the existing video_play_actions (start) and video_thruplays
-- (15s) this gives EIGHT real points across a video's duration: play, 3s, 25%,
-- 50%, 15s, 75%, 95%, 100%. The ad detail panel draws exactly those and
-- interpolates between them. No reconstruction from hook and hold rate.
--
-- Backfill beyond Meta's ~37-month insights retention wall is impossible
-- (infra/meta_backfill.py, MAX_MONTHS = 37). Older ads keep NULLs, and the UI
-- must draw no curve at all rather than a partial one.
ALTER TABLE `oneeighty-warehouse.raw.raw_meta_ad_insights`
  ADD COLUMN IF NOT EXISTS video_p25_watched  INT64
    OPTIONS (description = "video_p25_watched_actions[].video_view — reached 25% of duration."),
  ADD COLUMN IF NOT EXISTS video_p50_watched  INT64
    OPTIONS (description = "video_p50_watched_actions[].video_view — reached 50%."),
  ADD COLUMN IF NOT EXISTS video_p75_watched  INT64
    OPTIONS (description = "video_p75_watched_actions[].video_view — reached 75%."),
  ADD COLUMN IF NOT EXISTS video_p95_watched  INT64
    OPTIONS (description = "video_p95_watched_actions[].video_view — reached 95%."),
  ADD COLUMN IF NOT EXISTS video_p100_watched INT64
    OPTIONS (description = "video_p100_watched_actions[].video_view — completions."),
  ADD COLUMN IF NOT EXISTS video_30s_watched  INT64
    OPTIONS (description = "video_30_sec_watched_actions[].video_view."),
  ADD COLUMN IF NOT EXISTS video_avg_time_watched_sec NUMERIC
    OPTIONS (description = "video_avg_time_watched_actions[].video_view, in seconds. PER-DAY AVERAGE — never SUM, and never AVG across rows without weighting by impressions."),
  ADD COLUMN IF NOT EXISTS outbound_clicks        INT64
    OPTIONS (description = "outbound_clicks[].outbound_click — clicks that left Meta. The CTR Nathan actually reads."),
  ADD COLUMN IF NOT EXISTS unique_outbound_clicks INT64
    OPTIONS (description = "unique_outbound_clicks[].outbound_click."),
  ADD COLUMN IF NOT EXISTS video_quartile_raw STRING
    OPTIONS (description = "The five quartile arrays as one JSON blob, so a future metric needs no re-ingest.");
