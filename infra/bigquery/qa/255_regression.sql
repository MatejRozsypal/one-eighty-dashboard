-- =============================================================================
-- qa/255_regression.sql
-- Regression and acceptance for 255_rpt_ad_launch_v2.sql (ME1, audit changes C1 and C7).
-- Run 2026-10-05, first in mart_qa (prefix me1_), then against prod. Results under each check.
--
-- mart_qa objects:
--   me1_sp_refresh_rpt_ad_launch   PROCEDURE  the 255 procedure, names mapped (comments dropped)
--   me1_rpt_ad_launch              TABLE      built by it (31 columns)
--   me1_rpt_ad_launch_before       TABLE      copy of prod mart.rpt_ad_launch before the deploy (28 columns)
--   me1_rpt_ad_launch_oldlogic     TABLE      the 254 logic rebuilt on today's source (same hour)
-- Name mapping used for the candidate (same as qa/254): mart.sp_refresh_rpt_ad_launch ->
-- mart_qa.me1_sp_refresh_rpt_ad_launch, mart.rpt_ad_launch -> mart_qa.me1_rpt_ad_launch,
-- `mart`.__TABLES__ -> `mart_qa`.__TABLES__, table_id 'rpt_ad_launch' -> 'me1_rpt_ad_launch'.
-- Sources stay the prod views, read only. For the prod run, replace mart_qa.me1_rpt_ad_launch
-- by mart.rpt_ad_launch.
-- =============================================================================

-- 1. Build. CALL mart_qa.me1_sp_refresh_rpt_ad_launch(): 299 MB processed, 310 MB billed.
--    Prod CALL: same 299 MB, 232 s of slot time, finished inside the 90 s sync window.

-- 2. All other columns identical to the old logic (the 254 SELECT rebuilt on today's source).
--    Expect 0, 0, 459 / 459.
WITH a AS (SELECT TO_JSON_STRING(t) j FROM (
  SELECT * EXCEPT(is_video, refreshed_at) FROM `oneeighty-warehouse.mart_qa.me1_rpt_ad_launch_oldlogic`) t),
b AS (SELECT TO_JSON_STRING(t) j FROM (
  SELECT * EXCEPT(is_video, refreshed_at, video_start_share, adset_first_date, is_new_adset)
  FROM `oneeighty-warehouse.mart_qa.me1_rpt_ad_launch`) t)
SELECT 'old_minus_new' AS dir, COUNT(*) AS n FROM (SELECT j FROM a EXCEPT DISTINCT SELECT j FROM b)
UNION ALL SELECT 'new_minus_old', COUNT(*) FROM (SELECT j FROM b EXCEPT DISTINCT SELECT j FROM a)
UNION ALL SELECT 'rows_old', COUNT(*) FROM a UNION ALL SELECT 'rows_new', COUNT(*) FROM b;
-- Result mart_qa: 0, 0, 459, 459.  Result prod (mart.rpt_ad_launch): 0, 0, 459 rows.
-- Note: against the table deployed that morning (me1_rpt_ad_launch_before) 16 ads differ in
-- spend, impressions or video_plays by cents or single units and prior_roas differs in the 5th
-- to 7th digit for dobias, ethia and manami (max abs 0.0000120). Cause: Meta restated the
-- 2026-10-04 ad-days between the two builds. Not a logic change, proven by this check.

-- 3. is_video: what changed. Expect only old true -> new false, 60 ads.
SELECT n.client_id,
  COUNTIF(o.is_video) AS old_video, COUNTIF(n.is_video) AS new_video,
  COUNTIF(o.is_video AND NOT n.is_video) AS leaving, COUNTIF(NOT o.is_video AND n.is_video) AS entering,
  COUNTIF(o.is_video AND NOT n.is_video AND NOT n.is_preexisting AND NOT n.is_relaunch
          AND n.first_date > '2025-10-01') AS leaving_12m_cohort,
  COUNTIF(n.video_start_share < 0.30 AND n.is_video) AS video_by_asset_only
FROM `oneeighty-warehouse.mart_qa.me1_rpt_ad_launch` n
JOIN `oneeighty-warehouse.mart_qa.me1_rpt_ad_launch_oldlogic` o USING (client_id, ad_id)
GROUP BY 1 ORDER BY 1;
-- Result (identical on prod):
--   client  old  new  leaving  entering  leaving_12m_cohort  video_by_asset_only
--   dobias   16   12     4        0          0                   0
--   ethia    77   60    17        0         15                   0
--   manami  114   79    35        0         25                   4
--   venev     9    5     4        0          4                   0
-- (leaving_12m_cohort with first_date >= 2025-10-01: Manami 26; including relaunch copies: Dobias 3,
-- Ethia 15, Manami 30, Venev 4.)
-- Total 60 leaving, 0 entering. Audit expectation "about 14 Ethia and 24 Manami": 15 and 25 here (26 with the 2025-10-01 ads),
-- the difference is the audit's slightly different cohort window and Meta restatements. The
-- video_id rule keeps 4 Manami ads video that the 30 % share alone would drop; it cannot help
-- Ethia (0 rows in mart_creative_asset, audit C8). Leaving ads had an average start share of
-- 0.02 (Ethia), 0.016 (Manami), 0.039 (Dobias): carousel and banner auto plays, not videos.

-- 4. Launch context, audit 2.6. Cohort = not pre-existing, not relaunch, first_date > 2025-10-01
--    (the audit window; first_date >= 2025-10-01 adds 2 Manami ads of 2025-10-01 that the audit
--    left out, hence its 120 against 122 launched in the design table).
SELECT client_id, COUNTIF(is_new_adset) AS new_adset_ads, COUNTIF(NOT is_new_adset) AS existing_adset_ads,
  COUNT(DISTINCT IF(is_new_adset, adset_id, NULL)) AS new_adsets
FROM `oneeighty-warehouse.mart_qa.me1_rpt_ad_launch`
WHERE NOT is_preexisting AND NOT is_relaunch AND first_date > '2025-10-01'
GROUP BY 1 ORDER BY 1;
-- Result (mart_qa and prod identical): dobias 31 / 4 (15 new ad sets), ethia 64 / 92 (14),
-- manami 65 / 55 (31), venev 9 / 0 (2). Equals audit 2.6 and the pack counts of audit 3.4
-- (Dobias 15, Ethia 14, Manami 31).

-- 5. Sanity. Expect ncols 31, dups 0, next_left 0, null flags 0, adset_first_date <= first_date.
SELECT
  (SELECT COUNT(*) FROM `oneeighty-warehouse.mart`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'rpt_ad_launch') AS ncols,
  (SELECT COUNT(*) - COUNT(DISTINCT FORMAT('%s|%s', client_id, ad_id)) FROM `oneeighty-warehouse.mart.rpt_ad_launch`) AS dups,
  (SELECT COUNT(*) FROM `oneeighty-warehouse.mart`.__TABLES__ WHERE table_id = 'rpt_ad_launch__next') AS next_left,
  (SELECT COUNTIF(is_new_adset IS NULL OR adset_first_date IS NULL OR is_video IS NULL OR adset_first_date > first_date)
   FROM `oneeighty-warehouse.mart.rpt_ad_launch`) AS bad;
-- Result prod: 31, 0, 0, 0.

-- 6. Prod objects equal the files.
--    live/mart.rpt_ad_launch.sql (without trailing newline) md5 e9c4f508574e04396d1826f062066db5
--      = md5(INFORMATION_SCHEMA.TABLES.ddl).
--    live/mart.sp_refresh_rpt_ad_launch.sql body from BEGIN to END; md5 65a043b8969cfe1af39e3bfa13ae12df
--      = md5(CONCAT(ROUTINES.routine_definition, ';')).
-- The ASSERT and swap code is unchanged from 254, where the failure path was tested (qa/254 section 5).
