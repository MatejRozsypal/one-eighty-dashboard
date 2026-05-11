-- 010_create_raw_instagram.sql
-- Raw layer for Instagram organic (Business account).
-- Two tables: media (posts/reels/carousels unified) + account-level daily insights.
--
-- Schemas based on actual /<ig_business_id>/media and /<ig_business_id>/insights
-- responses captured 2026-05-08. See infra/samples/ig_media.json, ig_reels.json,
-- ig_account_insights.json.
--
-- Notes:
--   * IG returns 'impressions' as NULL/absent on media in v22+ — column kept for
--     forward-compat but expect mostly nulls until Meta restores it.
--   * 'plays' metric was silently dropped from reels insights in v22+ — not stored.
--   * Reel-specific fields (avg watch time, total watch time, total_interactions)
--     are NULL for non-reel media. Use media_type to filter.
--
-- Run order: AFTER 002.

-- =============================================================================
-- MEDIA — posts, reels, carousels, stories (if accessible)
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_instagram_media` (
  client_id                       STRING    NOT NULL,
  ingested_at                     TIMESTAMP NOT NULL,
  ingest_source                   STRING    NOT NULL,    -- 'backfill' | 'reconcile'

  ig_business_id                  STRING    NOT NULL,
  media_id                        STRING    NOT NULL,
  media_type                      STRING,                 -- IMAGE | VIDEO | CAROUSEL_ALBUM | REELS
  caption                         STRING,
  media_url                       STRING,                 -- the CDN URL of the asset (signed, expires)
  permalink                       STRING,                 -- public permalink
  posted_at                       TIMESTAMP,              -- 'timestamp' from API

  -- Engagement counters (top-level, not insights — always available)
  like_count                      INT64,
  comments_count                  INT64,

  -- Lifetime insights (per-media, cumulative since post)
  reach                           INT64,
  impressions                     INT64,                  -- often NULL in v22+
  saved                           INT64,
  shares                          INT64,

  -- Reel-specific lifetime insights (NULL for non-reels)
  ig_reels_avg_watch_time_ms      INT64,
  ig_reels_video_view_total_time_ms INT64,
  total_interactions              INT64,                   -- likes + saves + comments + shares - undos

  payload_json                    STRING
)
PARTITION BY DATE(posted_at)
CLUSTER BY client_id, media_type
OPTIONS (
  description = "Instagram media (posts/reels/carousels). Append-only — insights cumulative, refresh by re-ingesting.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- ACCOUNT-LEVEL DAILY INSIGHTS
-- =============================================================================
-- Long format (one row per metric per day) — flexible across metric churn in API.
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_instagram_account_insights` (
  client_id        STRING    NOT NULL,
  ingested_at      TIMESTAMP NOT NULL,
  ingest_source    STRING    NOT NULL,

  ig_business_id   STRING    NOT NULL,
  metric_date      DATE      NOT NULL,                    -- end_time → DATE
  metric_name      STRING    NOT NULL,                    -- reach | follower_count | profile_views | website_clicks | ...
  metric_value     INT64,

  payload_json     STRING
)
PARTITION BY metric_date
CLUSTER BY client_id, metric_name
OPTIONS (
  description = "IG account-level daily insights. Long format — one row per (date, metric_name).",
  require_partition_filter = TRUE
);
