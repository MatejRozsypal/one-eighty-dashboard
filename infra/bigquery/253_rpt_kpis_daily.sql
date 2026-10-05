-- =============================================================================
-- 253_rpt_kpis_daily.sql
-- Materialise mart.mart_daily_kpis into mart.rpt_kpis_daily for Reports (QA finding C-03).
--
-- Problem
--   mart.mart_daily_kpis is a VIEW over raw orders, ad insights and Google Ads tables. It
--   cannot prune by date: a compiled Reports widget (90 days, 5 clients) processes
--   419.5 MB and 1,644 slot seconds, 3.0 s, for about 450 rows. A 13-widget report fires
--   several of these per filter change, which is the 15 to 25 s settle time in C-03.
--
-- Change (additive, nothing existing is modified)
--   NEW TABLE     mart.rpt_kpis_daily: the 34 view columns (same names, order, types) plus
--                 refreshed_at TIMESTAMP. PARTITION BY DATE_TRUNC(date, MONTH),
--                 CLUSTER BY client_id, date. 5,368 rows, 1.6 MB, 61 partitions today.
--   NEW PROCEDURE mart.sp_refresh_rpt_kpis(): builds mart.rpt_kpis_daily__next from the
--                 view (one scan, about 450 MB), checks it, then swaps it in with
--                 CREATE OR REPLACE TABLE ... COPY (one statement, readers see the old or
--                 the new table, never a mix) and drops __next. Checks (ASSERT):
--                   * rows > 0
--                   * rows >= 90 % of the live table (skipped on the first run)
--                   * no duplicate (client_id, date)
--                   * MAX(date) >= CURRENT_DATE() - 2
--                 Any failure ends the CALL with an error and leaves the live table as it
--                 was (__next stays behind until the next run overwrites it).
--                 Every child job carries the label feature=rpt-kpis-refresh.
--   Scheduler     n8n workflow "BQ: refresh rpt_kpis_daily" (id BnRCbPqaYSO0zwIS, created
--                 INACTIVE 2026-10-05, export infra/n8n/wf_rpt_kpis_refresh.json): hourly at
--                 :10, one BigQuery node `CALL mart.sp_refresh_rpt_kpis()`, credential
--                 "BQ Service Account", error workflow "Error workflow".
--   Reader        Reports only, via QF1 commit 4 (MARTS.kpis.table = "mart.rpt_kpis_daily").
--                 Snapshot, Goals, Paid keep reading the view (owner decision 1 default).
--
-- Deviation from the plan (20_triage_plan.md, QF3): monthly instead of daily partitions.
--   Measured in mart_qa (same procedure, only the partition spec differs):
--     PARTITION BY date (1,827 partitions):  CALL 70 to 88 s (CTAS 24 to 27 s, COPY 38 to 52 s)
--     PARTITION BY month (61 partitions):    CALL 12 to 13 s (CTAS 4 to 5 s,  COPY 1.7 s)
--   Bytes for the 90-day widget are the same order either way (36 KB vs 35 KB processed;
--   BigQuery bills a 10 MB minimum per table anyway). Daily partitions of 3 rows each are
--   also close to the 4,000 partitions-per-job limit in about 6 years. Monthly avoids both.
--   NOTE: CREATE OR REPLACE refuses to change a partition spec ("Cannot replace a table
--   with a different partitioning spec"). To change it later: DROP TABLE
--   mart.rpt_kpis_daily, then CALL the procedure (verified in mart_qa).
--
-- Based on the live view mart.mart_daily_kpis read from INFORMATION_SCHEMA.VIEWS on
-- 2026-10-05: md5 9a5405191e68a9be6d52f8f6b5e8cfdc (= the 235 body, = live/mart.mart_daily_kpis.sql).
-- The view is NOT changed. The table copies it with SELECT k.*, so a later view change
-- reaches the table on the next hourly run (a new column too).
--
-- Affected clients: none (no existing object changes). The table equals the view for all
-- five clients: EXCEPT DISTINCT both directions on TO_JSON_STRING (refreshed_at excluded,
-- date < CURRENT_DATE(), the three FLOAT64 google_* columns rounded to 6 decimals):
-- 0 rows and 0 rows. Unrounded, only RawBark differs (249 to 257 rows, varying between
-- runs): last-digit FLOAT64 summation noise, known from 235. Details: qa/253_regression.sql.
--
-- Cost: about 450 MB per CALL, 24 x 30 = 720 runs, about 325 GB per month, roughly USD 2
-- at EU on-demand prices (likely inside the free TiB). Storage 1.6 MB.
--
-- IAM (must be decided before step 2 of the deploy, see statement 0)
--   The n8n credential "BQ Service Account" runs as sa-n8n-writer (JOBS_BY_PROJECT: it
--   writes raw, ref, ops). Dataset ACLs (INFORMATION_SCHEMA.OBJECT_PRIVILEGES, 2026-10-05):
--   sa-n8n-writer has dataEditor on raw, ref and ops, and NOTHING on mart. In the last 60
--   days it never read or wrote mart. Procedures run with the caller's rights, so without a
--   grant the hourly CALL fails (cannot read the view, cannot create tables in mart).
--   Project-level IAM was not visible to the read-only check; the grant is harmless if
--   the account already has it.
--   Statement 0 grants dataEditor on mart. Side effect to accept: that account could also
--   replace mart views. Alternative without any IAM change: run the CALL as a BigQuery
--   scheduled query owned by the owner (text at the end of this file) and leave the n8n
--   workflow inactive.
--
-- Deploy order (owner OK needed, Decision 1)
--   0. GRANT (statement 0), or choose the scheduled-query alternative.
--   1. Statement 1 (procedure) and statement 2 (first CALL, about 13 s, creates the table).
--   2. Run the checks in qa/253_regression.sql section P (prod).
--   3. n8n: open "BQ: refresh rpt_kpis_daily", run it once manually, confirm success and
--      that refreshed_at advanced, then activate (publish) it.
--   4. Merge QF1 commit 4 (registry switch), deploy the dashboard.
-- Rollback: revert QF1 commit 4 first (Reports reads the view again), deactivate the
-- workflow, then DROP TABLE mart.rpt_kpis_daily, DROP TABLE IF EXISTS
-- mart.rpt_kpis_daily__next, DROP PROCEDURE mart.sp_refresh_rpt_kpis, and REVOKE the grant.
-- =============================================================================

-- 0. Let the n8n service account run the refresh (read the view, replace the table).
--    Run in the EU location. Skip if the scheduled-query alternative is chosen.
GRANT `roles/bigquery.dataEditor`
ON SCHEMA `oneeighty-warehouse.mart`
TO "serviceAccount:sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com";

-- 1. Procedure (identical to live/mart.sp_refresh_rpt_kpis.sql)
CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_rpt_kpis`()
OPTIONS (description = 'Rebuilds mart.rpt_kpis_daily from mart.mart_daily_kpis. Builds mart.rpt_kpis_daily__next, checks it (rows > 0, >= 90 % of the current table, unique client_id and date, latest date not older than 2 days), then swaps it in with CREATE OR REPLACE TABLE ... COPY. Any failure leaves the current table untouched. Migration 253. Called hourly by the n8n workflow "BQ: refresh rpt_kpis_daily".')
BEGIN
  DECLARE prev_rows INT64;
  DECLARE new_rows INT64;
  DECLARE dup_rows INT64;
  DECLARE max_date DATE;

  SET @@query_label = 'feature:rpt-kpis-refresh';

  -- Rows in the table that is live now. NULL on the first run (table absent).
  SET prev_rows = (
    SELECT row_count FROM `oneeighty-warehouse.mart`.__TABLES__
    WHERE table_id = 'rpt_kpis_daily');

  -- 1. Build the next version beside the live one. One scan of the view.
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.rpt_kpis_daily__next`
  PARTITION BY DATE_TRUNC(date, MONTH)
  CLUSTER BY client_id, date
  OPTIONS (description = 'Staging copy for mart.sp_refresh_rpt_kpis. Not for reading.')
  AS
  SELECT k.*, CURRENT_TIMESTAMP() AS refreshed_at
  FROM `oneeighty-warehouse.mart.mart_daily_kpis` AS k;

  -- 2. Checks. A failed ASSERT ends the procedure here: the live table stays as it was.
  SET (new_rows, dup_rows, max_date) = (
    SELECT AS STRUCT
      COUNT(*),
      COUNT(*) - COUNT(DISTINCT FORMAT('%s|%t', client_id, date)),
      MAX(date)
    FROM `oneeighty-warehouse.mart.rpt_kpis_daily__next`);

  ASSERT new_rows > 0
    AS 'rpt_kpis_daily refresh: mart_daily_kpis returned 0 rows, live table kept';
  ASSERT prev_rows IS NULL OR new_rows >= 0.9 * prev_rows
    AS 'rpt_kpis_daily refresh: new row count is below 90 % of the live table, live table kept';
  ASSERT dup_rows = 0
    AS 'rpt_kpis_daily refresh: duplicate client_id and date rows, live table kept';
  ASSERT max_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)
    AS 'rpt_kpis_daily refresh: latest date is older than 2 days, live table kept';

  -- 3. Swap. One statement: readers see the old table or the new one, never a mix.
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.rpt_kpis_daily`
  COPY `oneeighty-warehouse.mart.rpt_kpis_daily__next`
  OPTIONS (description = 'Materialised mart.mart_daily_kpis for Reports (same 34 columns + refreshed_at). Rebuilt hourly by mart.sp_refresh_rpt_kpis (n8n "BQ: refresh rpt_kpis_daily"). Lags the view by up to 1 hour. Migration 253.');

  DROP TABLE IF EXISTS `oneeighty-warehouse.mart.rpt_kpis_daily__next`;
END;

-- 2. First build (creates mart.rpt_kpis_daily). About 13 s, about 450 MB.
CALL `oneeighty-warehouse.mart.sp_refresh_rpt_kpis`();

-- -----------------------------------------------------------------------------
-- Fallback scheduler (only if n8n is not used): BigQuery console, Scheduled queries,
-- "Create scheduled query", location EU, schedule "every 1 hours" starting at :10,
-- no destination table, query text:
--   CALL `oneeighty-warehouse.mart.sp_refresh_rpt_kpis`();
-- -----------------------------------------------------------------------------
