-- 011_create_raw_facebook.sql
-- Raw layer for Facebook organic (Page).
-- Schema based on actual /<page_id>/posts response captured 2026-05-08.
-- See infra/samples/fb_posts.json.
--
-- Notes:
--   * Page Insights API requires `read_insights` scope which wasn't available
--     in our app config during sampling — fb_page_insights table deferred.
--     Re-enable once scope is granted, then write 011a_create_raw_fb_page_insights.sql.
--   * Most "posts" on Manami's Page are actually reels (target.url = /reel/...).
--     Use attachment_target_url LIKE '%/reel/%' to filter if needed.
--   * Post-level insights are fetchable separately via /<post_id>/insights —
--     planned as a follow-up if needed; not in the v1 pull to keep API cost low.
--
-- Run order: AFTER 002.

-- =============================================================================
-- POSTS — Page posts (text/image/video/reel)
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_facebook_posts` (
  client_id              STRING    NOT NULL,
  ingested_at            TIMESTAMP NOT NULL,
  ingest_source          STRING    NOT NULL,            -- 'backfill' | 'reconcile'

  page_id                STRING    NOT NULL,
  post_id                STRING    NOT NULL,            -- the full {page_id}_{post_id} format
  message                STRING,
  created_at             TIMESTAMP,                     -- 'created_time' from API
  permalink_url          STRING,

  -- First attachment (most posts have exactly one; multi-attachment in payload_json)
  attachment_type        STRING,                        -- 'video_autoplay' | 'photo' | 'share' | 'album' | etc.
  attachment_target_id   STRING,                        -- the underlying video / album id
  attachment_target_url  STRING,                        -- e.g. https://www.facebook.com/reel/<id>/
  attachment_image_url   STRING,                        -- preview image src (signed, expires)
  attachment_video_url   STRING,                        -- direct video CDN URL (signed, expires)

  payload_json           STRING
)
PARTITION BY DATE(created_at)
CLUSTER BY client_id
OPTIONS (
  description = "Facebook Page posts. Insights deferred (need read_insights scope).",
  require_partition_filter = TRUE
);
