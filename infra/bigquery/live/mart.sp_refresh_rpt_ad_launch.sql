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
