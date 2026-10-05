-- =============================================================================
-- 255_rpt_ad_launch_v2.sql
-- mart.rpt_ad_launch v2: fixed is_video and three new columns (video_start_share,
-- adset_first_date, is_new_adset). Package ME1 of the Meta engine audit follow-up
-- (03_audit.md changes C1 and C7, owner decisions 2026-10-05).
--
-- Problem
--   C1. is_video was `video_plays > 0` over the lifetime. A banner that got a few video plays
--       (carousel cards, auto-played previews) was counted as video, so the hook rate of the
--       "average video" was dragged down and the Video / Static split was wrong.
--   C7. The hit rate by launch context (ad launched with a new ad set vs added to an existing
--       one) and the pack-level hit rate (ad sets with at least one winner / ad sets launched)
--       need the first delivery day of the ad set.
--
-- Change (additive columns, one semantic fix; the table is rebuilt by the same procedure)
--   is_video          TRUE when video_plays / impressions >= 0.30 over the ad lifetime, OR when
--                     mart.mart_creative_asset has a non-empty video_id for the ad. Both parts
--                     are needed: the share catches ads whose asset row is missing (Ethia has 0
--                     rows in mart_creative_asset, see audit C8), the asset catches video ads
--                     with a low start share. Replaces `video_plays > 0`.
--   video_start_share FLOAT64, video_plays / impressions (video starts as in the lifetime
--                     column video_plays = sum of video_play_actions), NULL when impressions = 0.
--   adset_first_date  DATE, earliest first_date among the ads of the same (client_id, adset_id).
--                     adset_id is the ad's latest ad set, as in the existing column.
--   is_new_adset      BOOL, first_date <= adset_first_date + 2 days: the ad started delivering
--                     within 2 days of its ad set, so it launched with the pack. FALSE means the
--                     ad was added to an ad set that had been running longer. Never NULL
--                     (adset_id is present on all 459 ads today).
--   Unchanged: all 28 existing columns, their order, types and semantics apart from is_video.
--   The 3 new columns are appended after refreshed_at, so the table has 31 columns.
--   The procedure keeps its name, schedule, ASSERTs and swap; only the SELECT changed
--   (a life2 CTE with the window MIN for adset_first_date, has_video_asset in the asset CTE).
--
-- Based on the deployed migration 254 (live/mart.sp_refresh_rpt_ad_launch.sql, procedure body md5
-- equal to the live ROUTINES.ddl, checked 2026-10-05) and on mart.mart_meta_ad_perf and
-- mart.mart_creative_asset read 2026-10-05. Neither view is changed.
--
-- Affected clients: all four rebuild; only is_video changes among existing columns (60 ads
-- of 459 go from video to non-video, none the other way: Dobias 4, Ethia 17, Manami 35,
-- Venev 4).
--
-- Regression (qa/255_regression.sql, run in mart_qa with prefix me1_, then on prod):
--   all other columns identical to the old logic rebuilt on the same source in the same hour,
--   EXCEPT DISTINCT both directions 0 and 0 on 459 rows. A comparison against the table
--   deployed that morning shows 16 ads and prior_roas differing in the 5th to 7th digit: Meta
--   restated 2026-10-04 spend by cents between the two builds, not a logic change.
--   Launch context (not pre-existing, not relaunch, first_date > 2025-10-01), audit 2.6:
--   Dobias 31 new / 4 existing, Ethia 64 / 92, Manami 65 / 55, Venev 9 / 0. Pack level (ad sets
--   launched in the same window): Dobias 15, Ethia 14, Manami 31 (equals audit 3.4).
--
-- Cost and timing: unchanged, about 300 MB and 12 to 14 s per CALL.
-- Scheduler: unchanged, the owner's scheduled query keeps calling the procedure by name; the
-- next scheduled run uses the new body.
--
-- Deploy order (owner approved the prod deploy of this migration after the mart_qa regression)
--   1. Statement 1 (procedure) and statement 2 (CALL, rebuilds the table with 31 columns).
--   2. Run the checks of qa/255_regression.sql against prod names.
-- Rollback: re-run 254_rpt_ad_launch.sql statement 1 (old procedure body) and the CALL.
-- =============================================================================

-- 1. Procedure (identical to live/mart.sp_refresh_rpt_ad_launch.sql)
CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_rpt_ad_launch`()
OPTIONS (description = 'Rebuilds mart.rpt_ad_launch (one row per Meta ad: first delivery date, lifetime totals, pre-existing and relaunch flags, video flag, ad set launch context, 12 month prior ROAS) from mart.mart_meta_ad_perf. Builds mart.rpt_ad_launch__next, checks it (rows > 0, >= 90 % of the current table, unique client_id and ad_id, latest day not older than 2 days), then swaps it in with CREATE OR REPLACE TABLE ... COPY. Any failure leaves the current table untouched. Migrations 254 and 255. Run daily by a BigQuery scheduled query.')
BEGIN
  DECLARE prev_rows INT64;
  DECLARE new_rows INT64;
  DECLARE dup_rows INT64;
  DECLARE max_through DATE;

  SET @@query_label = 'feature:rpt-ad-launch-refresh';

  -- Rows in the table that is live now. NULL on the first run (table absent).
  SET prev_rows = (
    SELECT row_count FROM `oneeighty-warehouse.mart`.__TABLES__
    WHERE table_id = 'rpt_ad_launch');

  -- 1. Build the next version beside the live one. One scan of mart_meta_ad_perf.
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.rpt_ad_launch__next`
  CLUSTER BY client_id
  OPTIONS (description = 'Staging copy for mart.sp_refresh_rpt_ad_launch. Not for reading.')
  AS
  WITH d AS (
    SELECT client_id, ad_id, date, ad_name, campaign_id, adset_id, currency,
           spend, revenue, purchases, impressions, video_play_actions
    FROM `oneeighty-warehouse.mart.mart_meta_ad_perf`
    WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH) AND date < CURRENT_DATE()
  ),
  hist AS (
    -- History start per client: ads already running on that day look launched that day.
    SELECT client_id, MIN(IF(impressions > 0, date, NULL)) AS history_start, MAX(date) AS through
    FROM d GROUP BY client_id
  ),
  prior AS (
    -- Shrinkage anchor: trailing 365 days of the client's Meta ROAS, sum over sum.
    SELECT d.client_id, SAFE_DIVIDE(SUM(d.revenue), SUM(d.spend)) AS prior_roas
    FROM d JOIN hist h USING (client_id)
    WHERE d.date > DATE_SUB(h.through, INTERVAL 365 DAY)
    GROUP BY d.client_id
  ),
  life AS (
    SELECT client_id, ad_id,
      ARRAY_AGG(ad_name ORDER BY date DESC LIMIT 1)[OFFSET(0)] AS ad_name,
      ARRAY_AGG(campaign_id ORDER BY date DESC LIMIT 1)[OFFSET(0)] AS campaign_id,
      ARRAY_AGG(adset_id ORDER BY date DESC LIMIT 1)[OFFSET(0)] AS adset_id,
      ANY_VALUE(currency) AS currency,
      MIN(IF(impressions > 0, date, NULL)) AS first_date,
      MAX(IF(impressions > 0, date, NULL)) AS last_date,
      COUNTIF(impressions > 0) AS active_days,
      IFNULL(SUM(spend), 0) AS spend,
      IFNULL(SUM(revenue), 0) AS revenue,
      IFNULL(SUM(purchases), 0) AS purchases,
      IFNULL(SUM(impressions), 0) AS impressions,
      IFNULL(SUM(video_play_actions), 0) AS video_plays
    FROM d
    GROUP BY client_id, ad_id
    HAVING first_date IS NOT NULL
  ),
  asset AS (
    -- The creative asset: video, else image, else post, else creative.
    SELECT client_id, ad_id,
      COALESCE(NULLIF(video_id, ''), NULLIF(image_hash, ''),
               NULLIF(effective_object_story_id, ''), NULLIF(creative_id, '')) AS asset_key,
      NULLIF(video_id, '') IS NOT NULL AS has_video_asset
    FROM `oneeighty-warehouse.mart.mart_creative_asset`
  ),
  life2 AS (
    -- Ad set launch context (255): first delivery day of the ad set = earliest first_date of
    -- its ads. An ad whose first delivery is within 2 days of that day launched with its ad set.
    SELECT l.*, MIN(l.first_date) OVER (PARTITION BY l.client_id, l.adset_id) AS adset_first_date
    FROM life l
  )
  SELECT
    l.client_id, l.ad_id, l.ad_name, l.campaign_id, l.adset_id, l.currency,
    l.first_date, l.last_date, l.active_days,
    l.spend, l.revenue, l.purchases, l.impressions, l.video_plays,
    h.history_start, h.through,
    DATE_DIFF(h.through, l.first_date, DAY) AS age_days,
    l.first_date <= DATE_ADD(h.history_start, INTERVAL 2 DAY) AS is_preexisting,
    -- 255: video when video starts are >= 30 % of impressions (a few plays on a banner are not
    -- a video), or when the creative asset carries a video_id.
    SAFE_DIVIDE(l.video_plays, l.impressions) >= 0.30 OR IFNULL(a.has_video_asset, FALSE) AS is_video,
    a.asset_key,
    IFNULL(a.asset_key IS NOT NULL AND ROW_NUMBER() OVER (
      PARTITION BY l.client_id, a.asset_key ORDER BY l.first_date, l.ad_id) > 1, FALSE) AS is_relaunch,
    t.concept_id, cn.name AS concept_name, t.persona_id,
    t.format AS format_tag, t.production_type,
    p.prior_roas,
    CURRENT_TIMESTAMP() AS refreshed_at,
    SAFE_DIVIDE(l.video_plays, l.impressions) AS video_start_share,
    l.adset_first_date,
    IFNULL(l.first_date <= DATE_ADD(l.adset_first_date, INTERVAL 2 DAY), FALSE) AS is_new_adset
  FROM life2 l
  JOIN hist h USING (client_id)
  LEFT JOIN prior p USING (client_id)
  LEFT JOIN asset a USING (client_id, ad_id)
  LEFT JOIN `oneeighty-warehouse.ref.creative_tags` t USING (client_id, ad_id)
  LEFT JOIN `oneeighty-warehouse.ref.concepts` cn
    ON cn.client_id = t.client_id AND cn.concept_id = t.concept_id;

  -- 2. Checks. A failed ASSERT ends the procedure here: the live table stays as it was.
  SET (new_rows, dup_rows, max_through) = (
    SELECT AS STRUCT
      COUNT(*),
      COUNT(*) - COUNT(DISTINCT FORMAT('%s|%s', client_id, ad_id)),
      MAX(through)
    FROM `oneeighty-warehouse.mart.rpt_ad_launch__next`);

  ASSERT new_rows > 0
    AS 'rpt_ad_launch refresh: mart_meta_ad_perf returned 0 ads, live table kept';
  ASSERT prev_rows IS NULL OR new_rows >= 0.9 * prev_rows
    AS 'rpt_ad_launch refresh: new row count is below 90 % of the live table, live table kept';
  ASSERT dup_rows = 0
    AS 'rpt_ad_launch refresh: duplicate client_id and ad_id rows, live table kept';
  ASSERT max_through >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)
    AS 'rpt_ad_launch refresh: latest loaded day is older than 2 days, live table kept';

  -- 3. Swap. One statement: readers see the old table or the new one, never a mix.
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.rpt_ad_launch`
  COPY `oneeighty-warehouse.mart.rpt_ad_launch__next`
  OPTIONS (description = 'One row per Meta ad: first delivery date, lifetime totals to the latest loaded day, pre-existing and relaunch flags, video flag and share, ad set launch context, 12 month client ROAS prior. Built from mart.mart_meta_ad_perf by mart.sp_refresh_rpt_ad_launch (daily). Base for the creative hit rate. Migrations 254 and 255.');

  DROP TABLE IF EXISTS `oneeighty-warehouse.mart.rpt_ad_launch__next`;
END;

-- 2. Rebuild now (creates the 31 column table). About 14 s, about 300 MB.
CALL `oneeighty-warehouse.mart.sp_refresh_rpt_ad_launch`();
