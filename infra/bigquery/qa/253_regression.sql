-- =============================================================================
-- qa/253_regression.sql
-- Regression and acceptance for 253_rpt_kpis_daily.sql (QF3, QA finding C-03).
-- Run 2026-10-05 in mart_qa. Results are recorded under each check.
--
-- Candidates (mart_qa, prefix qf3_):
--   qf3_sp_refresh       PROCEDURE  the 253 procedure with the names mapped (below);
--                                   comments stripped, statements identical
--   qf3_rpt_kpis_daily   TABLE      built by qf3_sp_refresh
-- Name mapping used to build the candidate from live/mart.sp_refresh_rpt_kpis.sql:
--   sed -e 's/oneeighty-warehouse\.mart\.sp_refresh_rpt_kpis/oneeighty-warehouse.mart_qa.qf3_sp_refresh/' \
--       -e 's/oneeighty-warehouse\.mart\.rpt_kpis_daily/oneeighty-warehouse.mart_qa.qf3_rpt_kpis_daily/g' \
--       -e 's/`oneeighty-warehouse\.mart`\.__TABLES__/`oneeighty-warehouse.mart_qa`.__TABLES__/' \
--       -e "s/table_id = 'rpt_kpis_daily'/table_id = 'qf3_rpt_kpis_daily'/"
-- The source view stays the prod view mart.mart_daily_kpis (read only).
-- Section P at the end is the post-deploy check against prod names.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- R1. Build, rebuild, timings (writes to mart_qa only)
-- -----------------------------------------------------------------------------
-- CALL `oneeighty-warehouse.mart_qa.qf3_sp_refresh`();   -- labels qf3=callN
-- Results (INFORMATION_SCHEMA.JOBS, child jobs):
--   daily partitions  (first version of the procedure, PARTITION BY date, CLUSTER BY client_id)
--     call1 first run      SCRIPT 69.5 s   CTAS 23.8 s  COPY 37.7 s
--     call2 replace        SCRIPT 87.6 s   CTAS 26.8 s  COPY 52.0 s
--   monthly partitions (253 as shipped)
--     call4 first run      SCRIPT 13.3 s   CTAS  5.0 s  COPY  1.7 s
--     call5 replace        SCRIPT 12.1 s   CTAS  4.4 s  COPY  1.6 s
--     call7 replace        CTAS 5.7 s, COPY 2.6 s
--   Every run: 449.8 MB processed, 460.3 MB billed (the view scan); checks 10 MB billed.
--   refreshed_at advanced on every successful run (call2 1791155860, call5 1791156088,
--   call7 1791156179, epoch seconds). __next is dropped after a successful run.
--   Child jobs carry the label feature=rpt-kpis-refresh (SET @@query_label works in the procedure).

-- -----------------------------------------------------------------------------
-- R2. Failure keeps the live table
-- -----------------------------------------------------------------------------
-- R2a. Partition spec change (call3): daily table live, procedure switched to monthly.
--   Result: CALL failed at the COPY with "Cannot replace a table with a different
--   partitioning spec"; table unchanged (5,368 rows, refreshed_at 1791155860 as before).
--   Lesson recorded in the 253 header: to change the spec, DROP the table, then CALL.
-- R2b. Row-count check (call6): 1,373 fake rows (client_id 'qf3_fake') inserted into the
--   live candidate, so 90 % of 6,741 = 6,067 > 5,368 new rows.
INSERT INTO `oneeighty-warehouse.mart_qa.qf3_rpt_kpis_daily`
SELECT * REPLACE('qf3_fake' AS client_id)
FROM `oneeighty-warehouse.mart_qa.qf3_rpt_kpis_daily`
WHERE client_id = 'dobias' AND date >= '2023-01-01';
CALL `oneeighty-warehouse.mart_qa.qf3_sp_refresh`();
--   Result: "rpt_kpis_daily refresh: new row count is below 90 % of the live table, live
--   table kept". The following DELETE removed exactly 1,373 rows (dml_statistics), so the
--   failed CALL had not touched the table. After the DELETE the next CALL succeeded
--   (5,368 rows, refreshed_at advanced).
DELETE FROM `oneeighty-warehouse.mart_qa.qf3_rpt_kpis_daily` WHERE client_id = 'qf3_fake';

-- -----------------------------------------------------------------------------
-- R3. Schema. Expect same_cols = true, ncols = 35, 61 partitions.
-- -----------------------------------------------------------------------------
SELECT
  (SELECT STRING_AGG(CONCAT(column_name, ':', data_type), ',' ORDER BY ordinal_position)
   FROM `oneeighty-warehouse.mart`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'mart_daily_kpis')
  = (SELECT STRING_AGG(CONCAT(column_name, ':', data_type), ',' ORDER BY ordinal_position)
     FROM `oneeighty-warehouse.mart_qa`.INFORMATION_SCHEMA.COLUMNS
     WHERE table_name = 'qf3_rpt_kpis_daily' AND column_name <> 'refreshed_at') AS same_cols,
  (SELECT COUNT(*) FROM `oneeighty-warehouse.mart_qa`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'qf3_rpt_kpis_daily') AS ncols,
  (SELECT COUNT(*) FROM `oneeighty-warehouse.mart_qa`.INFORMATION_SCHEMA.PARTITIONS WHERE table_name = 'qf3_rpt_kpis_daily') AS nparts;
-- Result: true, 35, 61. The table DDL with the name mapped back has md5
-- c8c7144fed6bdbb678f02043b0e92e67 = live/mart.rpt_kpis_daily.sql without its trailing newline.

-- -----------------------------------------------------------------------------
-- R4. Whole-row regression vs the view, date < CURRENT_DATE(), both directions.
-- -----------------------------------------------------------------------------
WITH v0 AS (
  SELECT * REPLACE(ROUND(google_spend, 6) AS google_spend, ROUND(google_revenue, 6) AS google_revenue,
                   ROUND(google_purchases, 6) AS google_purchases)
  FROM `oneeighty-warehouse.mart.mart_daily_kpis` WHERE date < CURRENT_DATE()),
m0 AS (
  SELECT * EXCEPT (refreshed_at) REPLACE(ROUND(google_spend, 6) AS google_spend, ROUND(google_revenue, 6) AS google_revenue,
                   ROUND(google_purchases, 6) AS google_purchases)
  FROM `oneeighty-warehouse.mart_qa.qf3_rpt_kpis_daily` WHERE date < CURRENT_DATE()),
v AS (SELECT TO_JSON_STRING(t) AS j FROM v0 AS t),
m AS (SELECT TO_JSON_STRING(t) AS j FROM m0 AS t)
SELECT 'view_minus_tbl' AS dir, COUNT(*) AS n FROM (SELECT j FROM v EXCEPT DISTINCT SELECT j FROM m)
UNION ALL
SELECT 'tbl_minus_view', COUNT(*) FROM (SELECT j FROM m EXCEPT DISTINCT SELECT j FROM v);
-- Result: 0 and 0. Rows per client equal in both (dobias 1,825, ethia 516, manami 833,
-- rawbark 1,463, venev 727). Without the rounding: 257 rows each direction on the first
-- compare and 249 on the second, all RawBark: FLOAT64 summation order in the view's
-- Google Ads aggregation, the same noise as in qa/235_regression.sql (two reads of the
-- view itself differ the same way). Every other client and every NUMERIC column: 0.

-- -----------------------------------------------------------------------------
-- R5. Compiled Reports widget, 90 days (2026-07-06 to 2026-10-03), 5 clients, CZK
--     (the rs9 compiler shape: fx CTEs, kpis CTE, GROUP BY client, period, ISO week).
--     Same SQL against the view and the candidate, labels qf3=widget-view / widget-table.
-- -----------------------------------------------------------------------------
--                     processed      billed      duration   slot ms
--   view              419,544,540    420.5 MB    2,975 ms   1,644,251
--   candidate table        34,517     31.5 MB      518 ms       8,022
--   (billed = BigQuery's 10 MB minimum for each of the 3 tables read: rpt, ref.clients,
--   ref.fx_rates; dry run on the candidate 35,966 bytes)
-- Results identical per client (rows, revenue, CM3, paid spend), e.g. dobias 90 rows,
-- revenue 13,028,626.25 CZK, CM3 9,464,598.49, spend 1,002,912.88 in both.
-- Acceptance "below 25 MB processed": met (0.03 MB).

-- -----------------------------------------------------------------------------
-- R6. IAM of the n8n service account (read only)
-- -----------------------------------------------------------------------------
SELECT object_name, privilege_type, grantee
FROM `oneeighty-warehouse`.`region-eu`.INFORMATION_SCHEMA.OBJECT_PRIVILEGES
WHERE object_name = 'mart';
-- Result: no entry for sa-n8n-writer (it has dataEditor on raw, ref, ops only; stg and
-- mart: none). JOBS_BY_PROJECT, 60 days: sa-n8n-writer referenced raw, ref, ops only.
-- Hence statement 0 (GRANT) in 253, or the scheduled-query alternative.

-- =============================================================================
-- P. After the prod deploy (statements 0 to 2 of 253). Run in order.
-- =============================================================================
-- P1. Objects exist; expect 5,3xx rows, refreshed_at within the last hour, no __next left.
SELECT table_id, row_count, size_bytes, TIMESTAMP_MILLIS(last_modified_time) AS modified
FROM `oneeighty-warehouse.mart`.__TABLES__
WHERE table_id LIKE 'rpt_kpis_daily%';
SELECT MIN(refreshed_at) AS r0, MAX(refreshed_at) AS r1, COUNT(*) AS n, MAX(date) AS max_date
FROM `oneeighty-warehouse.mart.rpt_kpis_daily`;

-- P2. Files equal to the deployed objects. Expect md5 c8c7144fed6bdbb678f02043b0e92e67
--     for the table (file without the trailing newline); the routine ddl must equal
--     live/mart.sp_refresh_rpt_kpis.sql (compare the text).
SELECT TO_HEX(MD5(ddl)) FROM `oneeighty-warehouse.mart`.INFORMATION_SCHEMA.TABLES WHERE table_name = 'rpt_kpis_daily';
SELECT ddl FROM `oneeighty-warehouse.mart`.INFORMATION_SCHEMA.ROUTINES WHERE routine_name = 'sp_refresh_rpt_kpis';

-- P3. R4 with mart_qa.qf3_rpt_kpis_daily replaced by mart.rpt_kpis_daily. Expect 0 and 0.

-- P4. After the manual n8n run and again 24 h after activation: one refresh per hour,
--     all successful, run by sa-n8n-writer, about 450 MB each.
SELECT TIMESTAMP_TRUNC(creation_time, HOUR) AS hour, user_email, COUNT(*) AS jobs,
       COUNTIF(error_result IS NOT NULL) AS errors, SUM(total_bytes_billed) AS billed
FROM `oneeighty-warehouse`.`region-eu`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
WHERE creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)
  AND statement_type = 'CREATE_TABLE_AS_SELECT'
  AND EXISTS (SELECT 1 FROM UNNEST(labels) AS l WHERE l.key = 'feature' AND l.value = 'rpt-kpis-refresh')
GROUP BY 1, 2 ORDER BY 1;
