-- =============================================================================
-- qa/254_rpt_ad_launch_regression.sql
-- Regression and acceptance for 254_rpt_ad_launch.sql (HR1, creative hit rate).
-- Run 2026-10-05, first in mart_qa, then against prod. Results are under each check.
--
-- Candidates (mart_qa, prefix hr1_):
--   hr1_sp_refresh_rpt_ad_launch  PROCEDURE  the 254 procedure with the names mapped
--   hr1_rpt_ad_launch             TABLE      built by it
-- Name mapping used to build the candidate from live/mart.sp_refresh_rpt_ad_launch.sql:
--   sed -e 's/oneeighty-warehouse\.mart\.sp_refresh_rpt_ad_launch/oneeighty-warehouse.mart_qa.hr1_sp_refresh_rpt_ad_launch/' \
--       -e 's/oneeighty-warehouse\.mart\.rpt_ad_launch/oneeighty-warehouse.mart_qa.hr1_rpt_ad_launch/g' \
--       -e 's/`oneeighty-warehouse\.mart`\.__TABLES__/`oneeighty-warehouse.mart_qa`.__TABLES__/' \
--       -e "s/table_id = 'rpt_ad_launch'/table_id = 'hr1_rpt_ad_launch'/"
-- The sources stay the prod views (mart.mart_meta_ad_perf, mart.mart_creative_asset), read only.
-- For the prod run replace `mart_qa.hr1_rpt_ad_launch` by `mart.rpt_ad_launch` in the queries.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Build, timing (CALL as a script, child jobs)
-- -----------------------------------------------------------------------------
-- CALL `oneeighty-warehouse.mart_qa.hr1_sp_refresh_rpt_ad_launch`();
-- Results:  mart_qa first run 14.1 s, replace run 12.3 s; prod first run 9.95 s.
--           299 MB processed, 309 MB billed per CALL (CTAS 299 MB, checks 10 MB billed).
--           Acceptance "under 30 s": met. Child jobs carry feature=rpt-ad-launch-refresh.
--           459 rows, 119,657 bytes on prod. refreshed_at advanced on every successful run.

-- -----------------------------------------------------------------------------
-- 2. Table equals lifetime sums recomputed from mart_meta_ad_perf, both directions.
--    Expect 0, 0, and the same row count on both sides (459).
-- -----------------------------------------------------------------------------
WITH src AS (
  SELECT client_id, ad_id,
    MIN(IF(impressions > 0, date, NULL)) AS first_date, MAX(IF(impressions > 0, date, NULL)) AS last_date,
    COUNTIF(impressions > 0) AS active_days,
    IFNULL(SUM(spend),0) AS spend, IFNULL(SUM(revenue),0) AS revenue,
    IFNULL(SUM(purchases),0) AS purchases, IFNULL(SUM(impressions),0) AS impressions,
    IFNULL(SUM(video_play_actions),0) AS video_plays
  FROM `oneeighty-warehouse.mart.mart_meta_ad_perf` WHERE date < CURRENT_DATE() GROUP BY client_id, ad_id
),
srcj AS (
  SELECT TO_JSON_STRING(STRUCT(client_id, ad_id, first_date, last_date, active_days, spend, revenue,
                               purchases, impressions, video_plays)) AS j
  FROM src WHERE first_date IS NOT NULL),
tbl AS (
  SELECT TO_JSON_STRING(STRUCT(client_id, ad_id, first_date, last_date, active_days, spend, revenue,
                               purchases, impressions, video_plays)) AS j
  FROM `oneeighty-warehouse.mart_qa.hr1_rpt_ad_launch`)
SELECT 'src_minus_tbl' AS dir, COUNT(*) AS n FROM (SELECT j FROM srcj EXCEPT DISTINCT SELECT j FROM tbl)
UNION ALL SELECT 'tbl_minus_src', COUNT(*) FROM (SELECT j FROM tbl EXCEPT DISTINCT SELECT j FROM srcj)
UNION ALL SELECT 'src_rows', COUNT(*) FROM srcj
UNION ALL SELECT 'tbl_rows', COUNT(*) FROM tbl;
-- Result mart_qa: 0, 0, 459, 459.   Result prod: 0, 0, 459, 459.
-- Note: the source sums are wrapped in IFNULL like the procedure. Without it, 329 ads differ in
-- video_plays only (NULL in the source for ads with no video plays, 0 in the table). That is
-- the intended 0, not a defect.
-- Same ad set and same lifetimes as the scratch table mart_qa.hr_ad_life2 of the design run
-- (0 ads on either side only, 0 differing first_date, spend or purchases).

-- -----------------------------------------------------------------------------
-- 3. Per client: pre-existing, prior_roas, relaunches, launched in the 12 launch months
--    (first_date >= 2025-10-01, whole months as in the design table 1.4)
-- -----------------------------------------------------------------------------
SELECT client_id, COUNT(*) AS ads, COUNTIF(is_preexisting) AS preexisting,
  ROUND(ANY_VALUE(prior_roas), 4) AS prior_roas, MAX(through) AS thru,
  COUNTIF(is_relaunch AND NOT is_preexisting AND first_date >= '2025-10-01') AS relaunch_12m,
  COUNTIF(NOT is_preexisting AND first_date >= '2025-10-01') AS adgrain_12m,
  COUNTIF(NOT is_preexisting AND NOT is_relaunch AND first_date >= '2025-10-01') AS launched_12m
FROM `oneeighty-warehouse.mart_qa.hr1_rpt_ad_launch` GROUP BY 1 ORDER BY 1;
-- Result (mart_qa and prod identical):
--   dobias  64 ads  preexisting 6  prior 2.8422  relaunch_12m 23  ad grain 58   launched 35
--   ethia  179 ads  preexisting 1  prior 2.2832  relaunch_12m  0  ad grain 156  launched 156
--   manami 200 ads  preexisting 3  prior 2.0287  relaunch_12m 39  ad grain 161  launched 122
--   venev   16 ads  preexisting 7  prior 0.1078  relaunch_12m  0  ad grain 9    launched 9
-- Acceptance: pre-existing 6, 1, 3, 7 met. prior_roas 2.842, 2.283, 2.029, 0.108 met.
-- Relaunches Dobias 23, Manami 39 met (Manami 43 over all time: 4 are older than the window).
-- Ad grain and launched counts equal the design table 1.4 (58 / 35, 156, 161 / 122, 9).
-- Ethia: mart_creative_asset has 0 rows for it, so asset_key is NULL for all 179 ads and none is
-- a relaunch (is_relaunch is FALSE, never NULL). Known gap, not an HR1 defect.

-- -----------------------------------------------------------------------------
-- 4. Schema, uniqueness, no __next left, sane values. Expect 28 columns, dups 0, next_left 0, bad 0.
-- -----------------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM `oneeighty-warehouse.mart_qa`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'hr1_rpt_ad_launch') AS ncols,
  (SELECT COUNT(*) - COUNT(DISTINCT FORMAT('%s|%s', client_id, ad_id)) FROM `oneeighty-warehouse.mart_qa.hr1_rpt_ad_launch`) AS dups,
  (SELECT COUNT(*) FROM `oneeighty-warehouse.mart_qa`.__TABLES__ WHERE table_id = 'hr1_rpt_ad_launch__next') AS next_left,
  (SELECT COUNT(*) FROM `oneeighty-warehouse.mart_qa.hr1_rpt_ad_launch`
   WHERE age_days < 0 OR first_date > last_date OR purchases < 0 OR is_relaunch IS NULL) AS bad;
-- Result: 28, 0, 0, 0 (mart_qa). Prod: the table DDL file live/mart.rpt_ad_launch.sql has md5
-- 27c2bb8d03f101ff6dbe52c8b7b918f6 (file without trailing newline) = INFORMATION_SCHEMA.TABLES.ddl;
-- the procedure body from "BEGIN" to the end has md5 99a2871c0482e3ab60b7040a94848801 in the file
-- and in INFORMATION_SCHEMA.ROUTINES.ddl.

-- -----------------------------------------------------------------------------
-- 5. Failure keeps the live table (mart_qa)
-- -----------------------------------------------------------------------------
-- 659 fake rows inserted (client_id hr1_fake and hr1_fake2, copies of the table), so the live
-- table had 1,118 rows and 90 % = 1,006 > 459 new rows:
-- INSERT INTO `oneeighty-warehouse.mart_qa.hr1_rpt_ad_launch`
--   SELECT * REPLACE('hr1_fake' AS client_id) FROM `oneeighty-warehouse.mart_qa.hr1_rpt_ad_launch`;
-- INSERT INTO `oneeighty-warehouse.mart_qa.hr1_rpt_ad_launch`
--   SELECT * REPLACE('hr1_fake2' AS client_id) FROM `oneeighty-warehouse.mart_qa.hr1_rpt_ad_launch` WHERE client_id = 'manami';
-- CALL `oneeighty-warehouse.mart_qa.hr1_sp_refresh_rpt_ad_launch`();
-- Result: "rpt_ad_launch refresh: new row count is below 90 % of the live table, live table kept".
-- Afterwards the table still had 1,118 rows (659 fake), so the failed CALL did not touch it.
-- The DELETE of client_id LIKE 'hr1_fake%' removed exactly 659 rows, the next CALL succeeded
-- (459 rows).

-- -----------------------------------------------------------------------------
-- 6. App read cost. Dry run of the HR1 app query (Manami, 12 launch months):
-- -----------------------------------------------------------------------------
SELECT ad_id, ad_name, first_date, age_days, spend, revenue, purchases,
       is_video, is_relaunch, concept_id, concept_name, prior_roas, through
FROM `oneeighty-warehouse.mart_qa.hr1_rpt_ad_launch`
WHERE client_id = 'manami' AND NOT is_preexisting
  AND first_date >= DATE '2025-10-01' AND first_date <= DATE '2026-10-04';
-- Result: 68,834 bytes processed on mart_qa and on prod (10 MB billed minimum). Acceptance
-- "under 1 MB": met.

-- -----------------------------------------------------------------------------
-- 7. IAM: the dashboard reads mart through sa-frontend-reader
-- -----------------------------------------------------------------------------
SELECT object_name, privilege_type, grantee
FROM `oneeighty-warehouse`.`region-eu`.INFORMATION_SCHEMA.OBJECT_PRIVILEGES
WHERE object_name = 'mart';
-- Result: sa-frontend-reader@oneeighty-warehouse.iam.gserviceaccount.com has
-- roles/bigquery.dataViewer on dataset mart (dataset level, so the new table inherits it; no
-- table level grant is needed). Also on the dataset: projectViewer, projectEditor, projectOwner,
-- user matej@oneeighty.cz dataOwner. The account itself was not impersonated: its read of
-- mart.rpt_ad_launch is inferred from the dataset grant, not exercised.

-- -----------------------------------------------------------------------------
-- 8. After the scheduled query exists (owner): one run a day, no errors.
-- -----------------------------------------------------------------------------
SELECT TIMESTAMP_TRUNC(creation_time, DAY) AS day, user_email, COUNT(*) AS jobs,
       COUNTIF(error_result IS NOT NULL) AS errors, SUM(total_bytes_billed) AS billed
FROM `oneeighty-warehouse`.`region-eu`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
WHERE creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 3 DAY)
  AND statement_type = 'SCRIPT' AND query LIKE '%sp_refresh_rpt_ad_launch%'
  AND query NOT LIKE '%CREATE OR REPLACE PROCEDURE%'
GROUP BY 1, 2 ORDER BY 1 DESC;
