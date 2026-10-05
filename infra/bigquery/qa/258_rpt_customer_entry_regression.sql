-- =============================================================================
-- qa/258_rpt_customer_entry_regression.sql
-- Regression and acceptance for 257_ref_retention.sql and 258_rpt_customer_entry.sql
-- (WR1, retention warehouse core; design retention/03_design.md 2.5 and 6).
-- Run 2026-10-05, first in mart_qa, then against prod. Results are under each check.
--
-- Candidates (mart_qa, prefix wr1_):
--   wr1_retention_settings, wr1_product_classes      TABLE      257 with names mapped
--   wr1_retention_settings_parity                    TABLE      same row, guard 0, lag 0
--   wr1_sp_refresh_rpt_customer_entry                PROCEDURE  258 procedure, names mapped
--   wr1_sp_refresh_rpt_customer_entry_parity         PROCEDURE  same, parity mode (below)
--   wr1_rpt_customer_entry, wr1_rpt_customer_entry_parity   TABLE  built by them
--   wr1_mart_retention_cohorts, wr1_v_unclassified_products VIEW   258 views, names mapped
-- Name mapping (production candidate), applied to live/mart.sp_refresh_rpt_customer_entry.sql:
--   mart.sp_refresh_rpt_customer_entry -> mart_qa.wr1_sp_refresh_rpt_customer_entry
--   mart.rpt_customer_entry(__next)    -> mart_qa.wr1_rpt_customer_entry(__next)
--   `mart`.__TABLES__ / 'rpt_customer_entry' -> `mart_qa`.__TABLES__ / 'wr1_rpt_customer_entry'
--   ref.product_classes -> mart_qa.wr1_product_classes
--   ref.retention_settings -> mart_qa.wr1_retention_settings
-- Mapping the candidate back gives the live file byte for byte (checked with diff).
-- Parity variant: the same, with suffix _parity on procedure, table and settings, and the
-- three validity predicates of the orders CTE removed (revenue, Reklamace, Shopify refund).
-- With lag 0 on 2026-10-05 the cut-off is 2026-10-04, the audit's cut-off.
-- The sources stay the prod stg views and ref.clients, read only.
-- For the prod run replace mart_qa.wr1_rpt_customer_entry by mart.rpt_customer_entry and
-- mart_qa.wr1_retention_settings by ref.retention_settings.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Build, timing, bytes (per CALL, from INFORMATION_SCHEMA.JOBS_BY_PROJECT)
-- -----------------------------------------------------------------------------
SELECT IFNULL(parent_job_id, job_id) AS call_job, statement_type,
       TIMESTAMP_DIFF(end_time, start_time, MILLISECOND) / 1000 AS secs,
       total_bytes_processed, total_bytes_billed, error_result.message AS err
FROM `oneeighty-warehouse`.`region-eu`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
WHERE creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)
  AND (job_id = @call_job OR parent_job_id = @call_job)
ORDER BY start_time;
-- Results (CALL only, script total; CTAS; checks):
--   mart_qa run 1   22.7 s  486,483,494 B processed  546-547 MB billed  (CTAS 11.3 s, 441 MB)
--   mart_qa run 2   22.5 s  same
--   prod first CALL 30.1 s  (script incl. CREATE PROCEDURE; CTAS 15.6 s) 486 MB / 547 MB billed
--   prod replace    24.1 s  486,483,494 B processed  547,356,672 B billed  (CTAS 12.4 s)
--   Split of the billed bytes: CTAS 441 MB, row checks on __next 12 MB, client check on
--   stg_customer_orders 94 MB billed (35 MB processed). Child jobs carry
--   feature=rpt-customer-entry-refresh. Prod table: 43,486 rows, 17,599,465 bytes.

-- -----------------------------------------------------------------------------
-- 2. Audit parity (mart_qa.ret_manami_orders expires 2026-10-12). Per customer, both
--    directions. Audit classes mapped to entry classes.
-- -----------------------------------------------------------------------------
WITH a AS (
  SELECT TO_HEX(SHA256(CONCAT('manami', '|', customer_key))) AS customer_id, MIN(first_date) AS f,
    CASE ANY_VALUE(IF(seq = 1, order_class, NULL))
      WHEN 'set_no_full' THEN 'discovery' WHEN 'full_no_set' THEN 'full'
      WHEN 'set_plus_full' THEN 'mixed' WHEN 'single_sample_only' THEN 'sample'
      WHEN 'gift_set_voucher' THEN 'gift' WHEN 'other_only' THEN 'other' ELSE 'unknown' END AS fc,
    MIN(IF(seq = 2, order_date, NULL)) AS d2, MIN(IF(seq = 3, order_date, NULL)) AS d3,
    MIN(IF(seq >= 2 AND (has_full OR has_bundle), order_date, NULL)) AS dfull
  FROM `oneeighty-warehouse.mart_qa.ret_manami_orders` GROUP BY customer_key),
b AS (
  SELECT customer_id, first_order_date AS f, entry_class_first_order AS fc,
    second_order_any_date AS d2, third_order_any_date AS d3, first_full_any_date AS dfull
  FROM `oneeighty-warehouse.mart_qa.wr1_rpt_customer_entry_parity` WHERE client_id = 'manami')
SELECT (SELECT COUNT(*) FROM (SELECT * FROM a EXCEPT DISTINCT SELECT * FROM b)) AS audit_not_table,
       (SELECT COUNT(*) FROM (SELECT * FROM b EXCEPT DISTINCT SELECT * FROM a)) AS table_not_audit;
-- Result: 0 and 0. 2,940 customers on both sides. No row needed explaining.

-- 2b. Parity numbers (parity table, *_any_date columns, customer-level maturity).
WITH t AS (SELECT * FROM `oneeighty-warehouse.mart_qa.wr1_rpt_customer_entry_parity` WHERE client_id = 'manami'),
g AS (
  SELECT 'all' AS grp, * FROM t UNION ALL
  SELECT 'discovery', * FROM t WHERE entry_class_first_order = 'discovery' UNION ALL
  SELECT 'full', * FROM t WHERE entry_class_first_order = 'full'),
hs AS (SELECT hz FROM UNNEST([30, 60, 90, 180, 365]) AS hz)
SELECT grp, hz,
  COUNTIF(DATE_ADD(first_order_date, INTERVAL hz DAY) <= cutoff_date) AS n,
  COUNTIF(DATE_ADD(first_order_date, INTERVAL hz DAY) <= cutoff_date
          AND DATE_DIFF(second_order_any_date, first_order_date, DAY) <= hz) AS k,
  COUNTIF(DATE_ADD(first_order_date, INTERVAL hz DAY) <= cutoff_date
          AND DATE_DIFF(first_full_any_date, first_order_date, DAY) <= hz) AS k_full
FROM g CROSS JOIN hs GROUP BY 1, 2 ORDER BY 1, 2;
-- Results (k/n, Wilson 95 %), against design 6 part 1 (tolerance 0.1 pp, n +-2):
--   all        r30 6.6 % (181/2,735)  r90 10.4 % (241/2,312)  r180 13.0 % (229/1,758)
--              r365 18.8 % (204/1,084)                                       all exact
--   discovery  r30 7.7 % (124/1,602)  r60 10.2 %  r90 11.8 % (156/1,322, 10.2 to 13.7)
--              r180 13.0 % (130/1,000)  r365 17.2 % (103/600, 14.4 to 20.4)
--              u180 11.6 % (116/1,000)  u365 15.2 % (91/600, 12.5 to 18.3)   all exact
--   full       r90 6.4 % (31/488)  r365 20.2 % (54/267)                       exact
-- Entrants (entry_class_first_order; day-merged entry_class identical in parity mode):
--   discovery 1,740 (59.2 %), full 592, sample 318, other 171, mixed 76, gift 43,
--   unknown 0. Total 2,940.                                                  exact
-- Discovery 2nd to 3rd within 180 days: 19 of 135 = 14.1 %                   exact
-- Discovery months: 2024-05 n 44 r365 25.0 %; 2025-08 n 58 r365 20.7 %;
--   2026-04 n 89 r90 16.9 %                                                  exact
-- Pooled discovery R_90: Jan to Jun 2025 9.9 % (20/202); Jan to Jun 2026 12.3 % (60/488);
--   pre flow (2025-10-01 to 2026-02-28) 9.2 % (28/305); post flow (2026-03-01 to
--   2026-06-30) 11.8 % (45/382)                                              exact

-- -----------------------------------------------------------------------------
-- 3. Production mode acceptance (defaults, Manami guard 180, lag 3, cut-off 2026-10-01).
--    Pooled over the table flags, non-early, cohort months fully mature for H.
-- -----------------------------------------------------------------------------
WITH t AS (SELECT * FROM `oneeighty-warehouse.mart_qa.wr1_rpt_customer_entry` WHERE client_id = 'manami')
SELECT 'disc R_90/U_90 Jan-Jun 2026' AS m, SUM(m90) AS n, SUM(r90) AS k, SUM(u90) AS k_full
FROM t WHERE entry_class = 'discovery' AND NOT is_early AND cohort_month BETWEEN '2026-01-01' AND '2026-06-01'
UNION ALL
SELECT 'disc R_90/U_90 Jan-Jun 2025', SUM(m90), SUM(r90), SUM(u90)
FROM t WHERE entry_class = 'discovery' AND NOT is_early AND cohort_month BETWEEN '2025-01-01' AND '2025-06-01'
UNION ALL
SELECT 'disc R_180/U_180 Oct 2025-Mar 2026', SUM(m180), SUM(r180), SUM(u180)
FROM t WHERE entry_class = 'discovery' AND NOT is_early AND cohort_month BETWEEN '2025-10-01' AND '2026-03-01'
UNION ALL
SELECT 'all R_365 non-early', SUM(m365), SUM(r365), SUM(u365) FROM t WHERE NOT is_early
UNION ALL
SELECT 'disc 2nd to 3rd 180 non-early', SUM(m23_180), SUM(r23_180), NULL
FROM t WHERE entry_class = 'discovery' AND NOT is_early;
-- Results (mart_qa and prod identical), estimate from design 6 part 2 in brackets:
--   discovery R_90 Jan to Jun 2026   12.1 % (59/488)   U_90 11.5 % (56/488)  [12.1 / 11.5]
--   discovery R_180 Oct 25 to Mar 26  9.6 % (37/387)   U_180 8.5 % (33/387)  [9.8 / 8.8]
--   all-customer R_365 non-early     15.7 % (111/709)  U_365 12.3 % (87/709) [15.7]
--   all within 0.5 pp. Also: discovery R_90 Jan to Jun 2025 9.4 % (19/202), U_90 8.9 %;
--   discovery 2nd to 3rd 13.1 % (11/84); all customers incl. early R_365 18.5 % (199/1,078).
--   Manami: 2,936 customers, 369 early. Entry classes: discovery 1,738, full 591,
--   sample 318, other 171, mixed 75, gift 43 (differences to parity mode: zero-revenue
--   and Reklamace orders dropped, same-day merge). 846 customers have an entry basket
--   line that matched only the default rule (oils, flower waters, vouchers, ...).
--   The cohort view gives the same sums (488/59/56 and 387/37/33).

-- -----------------------------------------------------------------------------
-- 4. Generic: independent recompute from stg_customer_orders without the item join,
--    per customer, both directions; order totals; identity; pooled R_30 to R_365.
-- -----------------------------------------------------------------------------
WITH v AS (
  SELECT o.client_id, o.order_id, o.order_date, o.customer_key
  FROM `oneeighty-warehouse.stg.stg_customer_orders` o
  LEFT JOIN `oneeighty-warehouse.stg.stg_shoptet_orders` s
    ON o.platform = 'shoptet' AND s.client_id = o.client_id AND s.order_code = o.order_id
  LEFT JOIN `oneeighty-warehouse.stg.stg_shopify_orders` f
    ON o.platform = 'shopify' AND f.client_id = o.client_id AND f.order_id = o.order_id
  WHERE o.customer_key IS NOT NULL AND (o.revenue IS NULL OR o.revenue > 0)
    AND NOT IFNULL(STARTS_WITH(LOWER(s.status), 'reklamace'), FALSE)
    AND NOT IFNULL(f.financial_status IN ('REFUNDED', 'VOIDED'), FALSE)),
days AS (
  SELECT client_id, customer_key, order_date,
    DENSE_RANK() OVER (PARTITION BY client_id, customer_key ORDER BY order_date) AS dn
  FROM (SELECT DISTINCT client_id, customer_key, order_date FROM v)),
c AS (
  SELECT client_id, customer_key, MIN(IF(dn = 1, order_date, NULL)) AS f,
    MIN(IF(dn = 2, order_date, NULL)) AS d2, MIN(IF(dn = 3, order_date, NULL)) AS d3
  FROM days GROUP BY 1, 2),
cnt AS (SELECT client_id, customer_key, COUNT(*) AS n_orders FROM v GROUP BY 1, 2),
cut AS (
  SELECT client_id, DATE_SUB(CURRENT_DATE(timezone), INTERVAL 1 + IFNULL(s.sync_lag_days, 3) DAY) AS cutoff
  FROM `oneeighty-warehouse.ref.clients`
  LEFT JOIN `oneeighty-warehouse.mart_qa.wr1_retention_settings` s USING (client_id)),
rec AS (
  SELECT c.client_id, TO_HEX(SHA256(CONCAT(c.client_id, '|', c.customer_key))) AS customer_id,
    c.f, c.d2, c.d3, cnt.n_orders,
    ARRAY(SELECT IF(DATE_ADD(c.f, INTERVAL h DAY) <= cutoff, 1, 0)
          FROM UNNEST([30, 60, 90, 180, 365]) h WITH OFFSET o ORDER BY o) AS m,
    ARRAY(SELECT IF(DATE_ADD(c.f, INTERVAL h DAY) <= cutoff AND DATE_DIFF(c.d2, c.f, DAY) <= h, 1, 0)
          FROM UNNEST([30, 60, 90, 180, 365]) h WITH OFFSET o ORDER BY o) AS r
  FROM c JOIN cnt USING (client_id, customer_key) JOIN cut USING (client_id)),
tbl AS (
  SELECT client_id, customer_id, first_order_date AS f, second_order_date AS d2,
    third_order_date AS d3, orders_total AS n_orders,
    [m30, m60, m90, m180, m365] AS m, [r30, r60, r90, r180, r365] AS r
  FROM `oneeighty-warehouse.mart_qa.wr1_rpt_customer_entry`),
ab AS (SELECT client_id, COUNT(*) AS n FROM (
  SELECT client_id, TO_JSON_STRING(t) FROM rec t EXCEPT DISTINCT
  SELECT client_id, TO_JSON_STRING(t) FROM tbl t) GROUP BY 1),
ba AS (SELECT client_id, COUNT(*) AS n FROM (
  SELECT client_id, TO_JSON_STRING(t) FROM tbl t EXCEPT DISTINCT
  SELECT client_id, TO_JSON_STRING(t) FROM rec t) GROUP BY 1),
tp AS (
  SELECT client_id, SUM(orders_total) AS tbl_orders, COUNT(*) AS tbl_customers,
    COUNT(*) - COUNT(DISTINCT customer_id) AS dups,
    COUNTIF(entry_class IS NOT NULL) AS entry_class_not_null,
    SUM(is_discovery + dm90 + du90 + dm180 + du180 + dm365 + du365) AS discovery_flags,
    COUNTIF(u365 > r365 OR r365 > m365 OR r23_180 > m23_180 OR u90 > r90 OR r90 > m90) AS bad_flags
  FROM `oneeighty-warehouse.mart_qa.wr1_rpt_customer_entry` GROUP BY 1),
vo AS (SELECT client_id, COUNT(*) AS orders, COUNT(DISTINCT customer_key) AS customers FROM v GROUP BY 1)
SELECT vo.client_id, IFNULL(ab.n, 0) AS recompute_not_table, IFNULL(ba.n, 0) AS table_not_recompute,
  vo.orders, tp.tbl_orders, vo.customers, tp.tbl_customers, tp.dups,
  tp.entry_class_not_null, tp.discovery_flags, tp.bad_flags
FROM vo LEFT JOIN ab USING (client_id) LEFT JOIN ba USING (client_id) LEFT JOIN tp USING (client_id)
ORDER BY 1;
-- Results (mart_qa and prod identical):
--   client   rec/tbl  orders  = table   customers = table  dups  entry_class  disc flags
--   dobias   0 / 0    78,941    78,941  21,655      21,655    0     0            0
--   ethia    0 / 0     1,803     1,803   1,256       1,256    0     0            0
--   manami   0 / 0     3,493     3,493   2,936       2,936    0     2,936        4,970
--   rawbark  0 / 0    49,987    49,987  14,484      14,484    0     0            0
--   venev    0 / 0     3,773     3,773   3,155       3,155    0     0            0
--   bad_flags 0 everywhere. Pooled all-customer R_30 / R_60 / R_90 / R_180 / R_365
--   (recompute = table): dobias 8.21 / 16.97 / 24.02 / 34.53 / 42.95; ethia 5.46 / 10.12
--   / 14.67 / 23.03 / 25.66; manami 6.35 / 8.53 / 10.22 / 12.75 / 18.46; rawbark 16.52 /
--   30.47 / 37.37 / 44.40 / 48.18; venev 3.14 / 4.96 / 6.36 / 8.27 / 10.98.
--   All 5 clients present. Clients without classes: entry_class NULL, has_unmatched_line
--   NULL, discovery flags 0.
-- Excluded orders (valid-order rule), for the record: no email dobias 54, manami 14,
--   venev 1; zero revenue dobias 821, ethia 3, manami 18, rawbark 53; Shopify refunded or
--   voided dobias 437, venev 4; Reklamace manami 11. Dobias NULL revenue 34,325 orders
--   (2013 to 2022, migrated store) are kept, see the 258 header.

-- -----------------------------------------------------------------------------
-- 5. Prod table equals the mart_qa candidate (refreshed_at excluded), both directions.
-- -----------------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM (
     SELECT TO_JSON_STRING(x) FROM (SELECT * EXCEPT(refreshed_at) FROM `oneeighty-warehouse.mart.rpt_customer_entry`) x
     EXCEPT DISTINCT
     SELECT TO_JSON_STRING(y) FROM (SELECT * EXCEPT(refreshed_at) FROM `oneeighty-warehouse.mart_qa.wr1_rpt_customer_entry`) y)) AS prod_not_qa,
  (SELECT COUNT(*) FROM (
     SELECT TO_JSON_STRING(y) FROM (SELECT * EXCEPT(refreshed_at) FROM `oneeighty-warehouse.mart_qa.wr1_rpt_customer_entry`) y
     EXCEPT DISTINCT
     SELECT TO_JSON_STRING(x) FROM (SELECT * EXCEPT(refreshed_at) FROM `oneeighty-warehouse.mart.rpt_customer_entry`) x)) AS qa_not_prod;
-- Result: 0 and 0.

-- -----------------------------------------------------------------------------
-- 6. Views. Cohort view sums equal the table; monitor returns 0 rows after the seed.
-- -----------------------------------------------------------------------------
SELECT (SELECT SUM(n_customer) FROM `oneeighty-warehouse.mart.mart_retention_cohorts`) AS view_customers,
       (SELECT COUNT(*) FROM `oneeighty-warehouse.mart.rpt_customer_entry`) AS table_customers,
       (SELECT COUNT(*) FROM `oneeighty-warehouse.ops.v_unclassified_products`) AS unclassified;
-- Result: 43,486 = 43,486; unclassified 0. Monitor logic test in mart_qa: with the default
-- rule's updated_at set to 2026-06-01 (then restored) it lists the 7 codes first seen
-- after that day (548/20, 548/30, 545/20, 545/30, 534/5, 521/TEA, 360), status 'default'.
-- Live MD5 checks: view definitions of both views equal live/*.sql; table DDL of
-- ref.retention_settings, ref.product_classes, mart.rpt_customer_entry equals live/*.sql.

-- -----------------------------------------------------------------------------
-- 7. IAM: the dashboard reads mart through sa-frontend-reader
-- -----------------------------------------------------------------------------
SELECT object_name, privilege_type, grantee
FROM `oneeighty-warehouse`.`region-eu`.INFORMATION_SCHEMA.OBJECT_PRIVILEGES
WHERE object_name = 'mart';
-- Result: serviceAccount:sa-frontend-reader@oneeighty-warehouse.iam.gserviceaccount.com has
-- roles/bigquery.dataViewer on dataset mart (dataset level), so mart.rpt_customer_entry and
-- mart.mart_retention_cohorts inherit it. Also projectViewer dataViewer, projectEditor
-- dataEditor, projectOwner and matej@oneeighty.cz dataOwner. The account was not
-- impersonated: its read is inferred from the dataset grant, not exercised.

-- -----------------------------------------------------------------------------
-- 8. After the scheduled query exists (owner): hourly runs, no errors.
-- -----------------------------------------------------------------------------
SELECT TIMESTAMP_TRUNC(creation_time, DAY) AS day, user_email, COUNT(*) AS jobs,
       COUNTIF(error_result IS NOT NULL) AS errors, SUM(total_bytes_billed) AS billed
FROM `oneeighty-warehouse`.`region-eu`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
WHERE creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 3 DAY)
  AND statement_type = 'SCRIPT' AND query LIKE '%sp_refresh_rpt_customer_entry%'
  AND query NOT LIKE '%CREATE OR REPLACE PROCEDURE%'
GROUP BY 1, 2 ORDER BY 1 DESC;
