-- =============================================================================
-- 254_rpt_ad_launch.sql
-- One row per Meta ad: launch date and lifetime totals, materialised for the creative hit
-- rate (Creative, Paid, Reports). Package HR1 of 40_hit_rate_design.md, sections 2.1 to 2.3.
--
-- Problem
--   Launch cohorts need the first delivery day and lifetime totals of every ad. The marts
--   are views and cannot prune by date: a cohort query on mart.mart_meta_ad_perf processes
--   about 98 MB per client and takes 2 to 3 s on every page load.
--
-- Change (additive, nothing existing is modified)
--   NEW TABLE     mart.rpt_ad_launch, 28 columns, CLUSTER BY client_id, 459 rows, about 0.1 MB.
--                 Grain (client_id, ad_id). Columns:
--                   ad_name, campaign_id, adset_id, currency   latest values of the ad
--                   first_date, last_date, active_days         days with impressions > 0
--                   spend, revenue, purchases, impressions, video_plays   lifetime to history end
--                   history_start, through                     per client: first day with
--                                                              impressions, latest loaded day
--                   age_days = through - first_date
--                   is_preexisting   first_date <= history_start + 2 days (ads already running
--                                    when the client's Meta history starts)
--                   is_video         video_plays > 0 over the lifetime (the rule Reports uses)
--                   asset_key, is_relaunch   asset = video_id, else image_hash, else story id,
--                                    else creative_id (mart.mart_creative_asset). is_relaunch =
--                                    a later ad (first_date, then ad_id) of an asset that already
--                                    ran, including same-day duplicates across ad sets (owner
--                                    decision D1: relaunches are excluded from the hit rate).
--                                    FALSE when the asset is unknown (Ethia has 0 rows in
--                                    mart_creative_asset today, so none of its ads is a relaunch).
--                   concept_id, concept_name, persona_id, format_tag, production_type
--                                    from ref.creative_tags and ref.concepts (mostly empty)
--                   prior_roas       client Meta ROAS of the trailing 365 days to `through`,
--                                    sum over sum. The shrinkage anchor of the winner rule.
--                   refreshed_at
--   NEW PROCEDURE mart.sp_refresh_rpt_ad_launch(): the 253 pattern. Builds
--                 mart.rpt_ad_launch__next from mart.mart_meta_ad_perf (one scan, about
--                 300 MB), checks it, swaps it in with CREATE OR REPLACE TABLE ... COPY and
--                 drops __next. ASSERTs:
--                   * rows > 0
--                   * rows >= 90 % of the live table (skipped on the first run)
--                   * no duplicate (client_id, ad_id)
--                   * MAX(through) >= CURRENT_DATE() - 2
--                 Any failure ends the CALL with an error and leaves the live table as it
--                 was. Every child job carries the label feature=rpt-ad-launch-refresh.
--   Scheduler     NOT in this file and NOT an n8n node: the owner runs the CALL as a BigQuery
--                 scheduled query (text at the end of this file). Daily is enough because Meta
--                 lands daily.
--   Reader        The app, via the dashboard service account sa-frontend-reader (read access to
--                 dataset mart, see qa/254_rpt_ad_launch_regression.sql section 7).
--
-- Differences from the sketch in the design
--   * ad_name, campaign_id, adset_id are the latest value of the ad (ARRAY_AGG ... ORDER BY
--     date DESC), not ANY_VALUE, so a rebuild is deterministic when an ad is renamed.
--   * creative_id is NULLIF'd to '' like the other keys, and is_relaunch is never NULL.
--   * CLUSTER BY client_id only, no partitioning (459 rows).
--
-- Based on the live view mart.mart_meta_ad_perf (live/mart.mart_meta_ad_perf.sql) and
-- mart.mart_creative_asset, ref.creative_tags, ref.concepts, read 2026-10-05. None of them
-- is changed.
--
-- Affected clients: none (no existing object changes). Table rows per client: dobias 64,
-- ethia 179, manami 200, venev 16.
--
-- Regression (qa/254_rpt_ad_launch_regression.sql, run in mart_qa with prefix hr1_, then
-- again on prod): lifetime sums recomputed from mart_meta_ad_perf, EXCEPT DISTINCT both
-- directions on TO_JSON_STRING: 0 and 0 (459 rows each side). Pre-existing: Dobias 6,
-- Ethia 1, Manami 3, Venev 7. prior_roas 2.8422, 2.2832, 2.0287, 0.1078. Relaunches in the
-- 12 launch months: Dobias 23, Manami 39, Ethia 0, Venev 0.
--
-- Cost: about 300 MB per CALL (299 MB processed, about 310 MB billed), 12 to 14 s. Daily:
-- about 9 GB a month. App read: about 70 KB processed, 10 MB billed minimum.
--
-- IAM: the scheduled query runs as its owner (the owner's user, who can read and write
-- mart). No grant to a service account is needed. The n8n account sa-n8n-writer has no
-- rights on mart (see the 253 header), which is why the CALL is not an n8n node.
--
-- Deploy order (owner approved the prod deploy of this migration only, after the mart_qa
-- regression passed)
--   1. Statement 1 (procedure) and statement 2 (first CALL, about 14 s, creates the table).
--   2. Run the checks in qa/254_rpt_ad_launch_regression.sql against prod names.
--   3. Owner: create the scheduled query (text at the end).
-- Rollback: DROP TABLE mart.rpt_ad_launch, DROP TABLE IF EXISTS mart.rpt_ad_launch__next,
-- DROP PROCEDURE mart.sp_refresh_rpt_ad_launch; stop the scheduled query.
-- =============================================================================

-- 1. Procedure (identical to live/mart.sp_refresh_rpt_ad_launch.sql)
CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_rpt_ad_launch`()
OPTIONS (description = 'Rebuilds mart.rpt_ad_launch (one row per Meta ad: first delivery date, lifetime totals, pre-existing and relaunch flags, 12 month prior ROAS) from mart.mart_meta_ad_perf. Builds mart.rpt_ad_launch__next, checks it (rows > 0, >= 90 % of the current table, unique client_id and ad_id, latest day not older than 2 days), then swaps it in with CREATE OR REPLACE TABLE ... COPY. Any failure leaves the current table untouched. Migration 254. Run daily by a BigQuery scheduled query.')
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
               NULLIF(effective_object_story_id, ''), NULLIF(creative_id, '')) AS asset_key
    FROM `oneeighty-warehouse.mart.mart_creative_asset`
  )
  SELECT
    l.client_id, l.ad_id, l.ad_name, l.campaign_id, l.adset_id, l.currency,
    l.first_date, l.last_date, l.active_days,
    l.spend, l.revenue, l.purchases, l.impressions, l.video_plays,
    h.history_start, h.through,
    DATE_DIFF(h.through, l.first_date, DAY) AS age_days,
    l.first_date <= DATE_ADD(h.history_start, INTERVAL 2 DAY) AS is_preexisting,
    l.video_plays > 0 AS is_video,
    a.asset_key,
    IFNULL(a.asset_key IS NOT NULL AND ROW_NUMBER() OVER (
      PARTITION BY l.client_id, a.asset_key ORDER BY l.first_date, l.ad_id) > 1, FALSE) AS is_relaunch,
    t.concept_id, cn.name AS concept_name, t.persona_id,
    t.format AS format_tag, t.production_type,
    p.prior_roas,
    CURRENT_TIMESTAMP() AS refreshed_at
  FROM life l
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
  OPTIONS (description = 'One row per Meta ad: first delivery date, lifetime totals to the latest loaded day, pre-existing and relaunch flags, 12 month client ROAS prior. Built from mart.mart_meta_ad_perf by mart.sp_refresh_rpt_ad_launch (daily). Base for the creative hit rate. Migration 254.');

  DROP TABLE IF EXISTS `oneeighty-warehouse.mart.rpt_ad_launch__next`;
END;

-- 2. First build (creates mart.rpt_ad_launch). About 14 s, about 300 MB.
CALL `oneeighty-warehouse.mart.sp_refresh_rpt_ad_launch`();

-- -----------------------------------------------------------------------------
-- Scheduler (owner): BigQuery console, Scheduled queries, "Create scheduled query",
-- location EU, schedule "every day" at a time after the Meta insights load,
-- no destination table, query text:
--   CALL `oneeighty-warehouse.mart.sp_refresh_rpt_ad_launch`();
-- -----------------------------------------------------------------------------
