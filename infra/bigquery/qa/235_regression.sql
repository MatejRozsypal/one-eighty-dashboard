-- =============================================================================
-- qa/235_regression.sql
-- Regression for 235_ad_spend_zero_days.sql, protocol 5.R.
-- Run 2026-10-04. Results are recorded under each check. Read-only except C0, C1.
--
-- Candidates (mart_qa, prefix fx1_):
--   fx1_ad_spend_zero_days   TABLE  copy of the 235 registry with the 235 seed
--   fx1s_ad_spend_zero_days  TABLE  synthetic registry for the edge tests (R6)
--   fx1_mart_daily_kpis      VIEW   live text + the five edits of 235 (C1), registry = fx1_
--   fx1s_mart_daily_kpis     VIEW   same, registry = fx1s_
--   fx1_mart_monthly_kpis    VIEW   live monthly text, daily ref mapped to fx1_mart_daily_kpis
--   fx1_base_daily_kpis, fx1_base_monthly_kpis  TABLE  pre-deploy snapshots of prod
--
-- After the prod deploy (done 2026-10-04): the same checks were re-run with the
-- candidate replaced by prod (mart.mart_daily_kpis, mart.mart_monthly_kpis) and
-- prod replaced by the snapshots (fx1_base_*). Results under "PROD RERUN".
-- All whole-row compares round the three FLOAT64 columns (google_spend,
-- google_revenue, google_purchases) to 6 decimals: summation order makes the last
-- digits differ between two runs of the same view (known, RawBark).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- C0. Registry candidates (writes to mart_qa only)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TABLE `oneeighty-warehouse.mart_qa.fx1_ad_spend_zero_days` (
  client_id STRING NOT NULL, platform STRING NOT NULL, date_from DATE NOT NULL, date_to DATE NOT NULL,
  note STRING, updated_by STRING NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP() NOT NULL);
INSERT INTO `oneeighty-warehouse.mart_qa.fx1_ad_spend_zero_days` (client_id, platform, date_from, date_to, note, updated_by) VALUES
 ('venev','meta',DATE '2022-07-25',DATE '2025-12-03','No Meta ads before the first Meta spend (2025-12-04). Owner decision 2026-10-04.','matej@oneeighty.cz'),
 ('venev','meta',DATE '2026-08-10',DATE '2026-08-10','Owner confirmed no Meta ads on this day (2026-10-04).','matej@oneeighty.cz');
CREATE OR REPLACE TABLE `oneeighty-warehouse.mart_qa.fx1s_ad_spend_zero_days` (
  client_id STRING NOT NULL, platform STRING NOT NULL, date_from DATE NOT NULL, date_to DATE NOT NULL,
  note STRING, updated_by STRING NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP() NOT NULL);
INSERT INTO `oneeighty-warehouse.mart_qa.fx1s_ad_spend_zero_days` (client_id, platform, date_from, date_to, note, updated_by) VALUES
 ('venev','meta',DATE '2022-07-25',DATE '2025-12-03','seed','t'),
 ('venev','meta',DATE '2022-07-25',DATE '2022-12-31','overlap, must not fan out','t'),
 ('venev','meta',DATE '2025-12-01',DATE '2025-12-31','covers real spend days, must not override','t'),
 ('dobias','meta',DATE '2026-03-01',DATE '2026-03-05','dobias meta hole, synthetic','t'),
 ('rawbark','google',DATE '2026-09-17',DATE '2026-09-17','synthetic','t'),
 ('manami','google',DATE '2026-09-01',DATE '2026-09-30','covers real google spend, must not override','t'),
 ('ethia','meta',DATE '2030-01-01',DATE '2030-01-05','future day, no row, must not create a row','t'),
 ('venev','meta',DATE '2026-02-01',DATE '2026-01-01','inverted range, expands to nothing','t');
CREATE OR REPLACE TABLE `oneeighty-warehouse.mart_qa.fx1_base_daily_kpis` AS SELECT * FROM `oneeighty-warehouse.mart.mart_daily_kpis`;
CREATE OR REPLACE TABLE `oneeighty-warehouse.mart_qa.fx1_base_monthly_kpis` AS SELECT * FROM `oneeighty-warehouse.mart.mart_monthly_kpis`;
-- (the snapshots are taken BEFORE the prod deploy)

-- -----------------------------------------------------------------------------
-- C1. Build candidates. The edit strings are the exact strings that turn the live
-- text (md5 9dc5...) into the 235 file body (md5 9a54...); each must match once
-- (ASSERT). Run as one script.
-- RESULT: all asserts passed; candidate md5 9a5405191e68a9be6d52f8f6b5e8cfdc, 11228 chars.
-- -----------------------------------------------------------------------------
DECLARE mdef STRING DEFAULT (SELECT view_definition FROM `oneeighty-warehouse.mart`.INFORMATION_SCHEMA.VIEWS WHERE table_name = 'mart_monthly_kpis');
DECLARE def STRING DEFAULT (
  SELECT view_definition FROM `oneeighty-warehouse.mart`.INFORMATION_SCHEMA.VIEWS
  WHERE table_name = 'mart_daily_kpis');
DECLARE e1_old STRING DEFAULT """  WHERE cogs IS NOT NULL
)
SELECT
""";
DECLARE e1_new STRING DEFAULT """  WHERE cogs IS NOT NULL
),
-- Registry of days on which a platform ran no ads (ref.ad_spend_zero_days, 235).
-- One row per client and day, expanded from the date ranges. Used only to fill a
-- NULL spend with 0 on a row that already exists; it never creates a row and
-- never replaces a spend that has a value.
meta_zero_days AS (
  SELECT DISTINCT z.client_id, d AS date
  FROM `oneeighty-warehouse.ref.ad_spend_zero_days` AS z, UNNEST(GENERATE_DATE_ARRAY(z.date_from, z.date_to)) AS d
  WHERE z.platform = 'meta'
),
google_zero_days AS (
  SELECT DISTINCT z.client_id, d AS date
  FROM `oneeighty-warehouse.ref.ad_spend_zero_days` AS z, UNNEST(GENERATE_DATE_ARRAY(z.date_from, z.date_to)) AS d
  WHERE z.platform = 'google'
)
SELECT
""";
DECLARE e2_old STRING DEFAULT """  p.meta_spend, p.meta_revenue,""";
DECLARE e2_new STRING DEFAULT """  COALESCE(p.meta_spend, IF(mz.client_id IS NOT NULL, CAST(0 AS NUMERIC))) AS meta_spend,
  p.meta_revenue,""";
DECLARE e3_old STRING DEFAULT """  p.google_spend, p.google_revenue,""";
DECLARE e3_new STRING DEFAULT """  COALESCE(p.google_spend, IF(gz.client_id IS NOT NULL, CAST(0 AS FLOAT64))) AS google_spend,
  p.google_revenue,""";
DECLARE e4_old STRING DEFAULT """  p.paid_spend,
  CAST(0 AS NUMERIC) AS cm1_other_costs,""";
DECLARE e4_new STRING DEFAULT """  COALESCE(p.paid_spend, IF(mz.client_id IS NOT NULL OR gz.client_id IS NOT NULL, CAST(0 AS NUMERIC))) AS paid_spend,
  CAST(0 AS NUMERIC) AS cm1_other_costs,""";
DECLARE e5_old STRING DEFAULT """LEFT JOIN client_cost_data k
  ON k.client_id = COALESCE(s.client_id, p.client_id)""";
DECLARE e5_new STRING DEFAULT """LEFT JOIN client_cost_data k
  ON k.client_id = COALESCE(s.client_id, p.client_id)
LEFT JOIN meta_zero_days mz
  ON mz.client_id = COALESCE(s.client_id, p.client_id) AND mz.date = COALESCE(s.date, p.date)
LEFT JOIN google_zero_days gz
  ON gz.client_id = COALESCE(s.client_id, p.client_id) AND gz.date = COALESCE(s.date, p.date)""";
DECLARE cand STRING DEFAULT def;
ASSERT TO_HEX(MD5(def)) = '9dc5140218469a887bed32050d1bbf0e' AS 'live mart_daily_kpis is not the 234 text';
ASSERT (LENGTH(cand) - LENGTH(REPLACE(cand, e1_old, ''))) / LENGTH(e1_old) = 1 AS 'edit 1 must match once';
SET cand = REPLACE(cand, e1_old, e1_new);
ASSERT (LENGTH(cand) - LENGTH(REPLACE(cand, e2_old, ''))) / LENGTH(e2_old) = 1 AS 'edit 2 must match once';
SET cand = REPLACE(cand, e2_old, e2_new);
ASSERT (LENGTH(cand) - LENGTH(REPLACE(cand, e3_old, ''))) / LENGTH(e3_old) = 1 AS 'edit 3 must match once';
SET cand = REPLACE(cand, e3_old, e3_new);
ASSERT (LENGTH(cand) - LENGTH(REPLACE(cand, e4_old, ''))) / LENGTH(e4_old) = 1 AS 'edit 4 must match once';
SET cand = REPLACE(cand, e4_old, e4_new);
ASSERT (LENGTH(cand) - LENGTH(REPLACE(cand, e5_old, ''))) / LENGTH(e5_old) = 1 AS 'edit 5 must match once';
SET cand = REPLACE(cand, e5_old, e5_new);
ASSERT TO_HEX(MD5(cand)) = '9a5405191e68a9be6d52f8f6b5e8cfdc' AS 'candidate text is not the 235 file body';
EXECUTE IMMEDIATE 'CREATE OR REPLACE VIEW `oneeighty-warehouse.mart_qa.fx1_mart_daily_kpis` AS ' || REPLACE(cand, '`oneeighty-warehouse.ref.ad_spend_zero_days`', '`oneeighty-warehouse.mart_qa.fx1_ad_spend_zero_days`');
EXECUTE IMMEDIATE 'CREATE OR REPLACE VIEW `oneeighty-warehouse.mart_qa.fx1s_mart_daily_kpis` AS ' || REPLACE(cand, '`oneeighty-warehouse.ref.ad_spend_zero_days`', '`oneeighty-warehouse.mart_qa.fx1s_ad_spend_zero_days`');
EXECUTE IMMEDIATE 'CREATE OR REPLACE VIEW `oneeighty-warehouse.mart_qa.fx1_mart_monthly_kpis` AS ' || REPLACE(mdef, '`oneeighty-warehouse.mart.mart_daily_kpis`', '`oneeighty-warehouse.mart_qa.fx1_mart_daily_kpis`');

-- -----------------------------------------------------------------------------
-- R0. Text. Prod view md5 (after deploy) must equal the 235 file body.
-- SELECT TO_HEX(MD5(view_definition)) FROM `oneeighty-warehouse.mart`.INFORMATION_SCHEMA.VIEWS WHERE table_name = 'mart_daily_kpis';
-- RESULT before: 9dc5140218469a887bed32050d1bbf0e (= 234 body).
-- PROD RERUN after deploy: 9a5405191e68a9be6d52f8f6b5e8cfdc, 11228 chars = file body. Deploy ran the same five
-- edits against the live text inside one script with ASSERTs on both md5s before CREATE OR REPLACE VIEW.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- R1. Whole-row diff, both directions, date < CURRENT_DATE(), by client.
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE c AS SELECT * REPLACE (ROUND(google_spend, 6) AS google_spend, ROUND(google_revenue, 6) AS google_revenue, ROUND(google_purchases, 6) AS google_purchases)
  FROM `oneeighty-warehouse.mart_qa.fx1_mart_daily_kpis` WHERE date < CURRENT_DATE();
CREATE TEMP TABLE p AS SELECT * REPLACE (ROUND(google_spend, 6) AS google_spend, ROUND(google_revenue, 6) AS google_revenue, ROUND(google_purchases, 6) AS google_purchases)
  FROM `oneeighty-warehouse.mart.mart_daily_kpis` WHERE date < CURRENT_DATE();   -- after deploy: fx1_base_daily_kpis
SELECT 'rows' k, (SELECT COUNT(*) FROM c) cand, (SELECT COUNT(*) FROM p) prod, NULL d
UNION ALL SELECT 'cand_minus_prod', COUNT(*), NULL, client_id FROM (SELECT client_id FROM (SELECT * FROM c EXCEPT DISTINCT SELECT * FROM p)) GROUP BY client_id
UNION ALL SELECT 'prod_minus_cand', COUNT(*), NULL, client_id FROM (SELECT client_id FROM (SELECT * FROM p EXCEPT DISTINCT SELECT * FROM c)) GROUP BY client_id;
-- RESULT (candidate vs prod, 2026-10-04): rows 5364 / 5364. cand_minus_prod venev 606, prod_minus_cand venev 606.
--   dobias, ethia, manami, rawbark: 0 rows in both directions. Row count per client equal on both sides.
-- PROD RERUN (prod vs fx1_base_daily_kpis): rows 5364 / 5364, venev 606 / 606, every other client 0.

-- -----------------------------------------------------------------------------
-- R2. Explanation of the Venev diff, column by column (rows joined on client_id, date, currency).
-- -----------------------------------------------------------------------------
SELECT COUNT(*) joined_rows,
  COUNTIF(c.meta_spend IS DISTINCT FROM p.meta_spend) meta_spend_diff,
  COUNTIF(p.meta_spend IS NULL AND c.meta_spend = 0) meta_null_to_zero,
  COUNTIF(c.paid_spend IS DISTINCT FROM p.paid_spend) paid_spend_diff,
  COUNTIF(p.paid_spend IS NULL AND c.paid_spend = 0) paid_null_to_zero,
  COUNTIF(c.google_spend IS DISTINCT FROM p.google_spend) google_spend_diff,
  COUNTIF(c.cm1 IS DISTINCT FROM p.cm1 OR c.cm2 IS DISTINCT FROM p.cm2 OR c.cm3 IS DISTINCT FROM p.cm3) cm_diff,
  COUNTIF(c.revenue IS DISTINCT FROM p.revenue OR c.cogs IS DISTINCT FROM p.cogs OR c.orders IS DISTINCT FROM p.orders
          OR c.meta_revenue IS DISTINCT FROM p.meta_revenue OR c.meta_purchases IS DISTINCT FROM p.meta_purchases
          OR c.meta_clicks IS DISTINCT FROM p.meta_clicks OR c.meta_impressions IS DISTINCT FROM p.meta_impressions) other_col_diff,
  COUNTIF(c.meta_spend IS DISTINCT FROM p.meta_spend AND c.client_id != 'venev') non_venev_diff,
  MIN(IF(c.meta_spend IS DISTINCT FROM p.meta_spend, c.date, NULL)) first_diff_date,
  MAX(IF(c.meta_spend IS DISTINCT FROM p.meta_spend, c.date, NULL)) last_diff_date,
  COUNTIF(c.meta_spend IS DISTINCT FROM p.meta_spend AND c.date NOT BETWEEN DATE '2022-07-25' AND DATE '2025-12-03' AND c.date != DATE '2026-08-10') diff_outside_registry,
  COUNTIF(c.client_id = 'venev' AND p.meta_spend IS NULL AND c.date > DATE '2025-12-03') venev_after_start_prod_null,
  COUNTIF(c.client_id = 'venev' AND p.meta_spend IS NULL AND c.date > DATE '2025-12-03' AND c.meta_spend IS NULL) venev_after_start_still_null
FROM c JOIN p USING (client_id, date, currency);
-- RESULT: joined 5364; meta_spend_diff 606 = meta_null_to_zero 606; paid_spend_diff 606 = paid_null_to_zero 606;
--   google_spend_diff 0; cm_diff 0; other_col_diff 0; non_venev_diff 0; first_diff_date 2022-07-25,
--   last_diff_date 2025-11-27; diff_outside_registry 0; venev_after_start_prod_null 17, still_null 17.
--   Venev has 623 NULL Meta days in prod, 606 before 2025-12-04 (now 0), 17 after (still NULL).
--   2026-08-10: no mart row for Venev (no order, no ad row), so nothing to fill.
-- PROD RERUN (prod vs fx1_base_daily_kpis): identical numbers, bad_meta 0, bad_paid 0, other_changed 0.

-- -----------------------------------------------------------------------------
-- R3. Monthly mart (fx1_mart_monthly_kpis vs mart.mart_monthly_kpis), whole-row EXCEPT DISTINCT, same rounding.
-- -----------------------------------------------------------------------------
-- RESULT: 212 / 212 rows; differing rows 41, all venev, months 2022-07-01 to 2025-11-01; prod_minus_cand 41;
--   0 rows where a non-NULL meta_spend or paid_spend changed; 0 rows with a revenue, cm3 or orders diff.
--   (the 41 months go from NULL to 0 spend, nothing else.)
-- PROD RERUN: same (prod monthly vs fx1_base_monthly_kpis).

-- -----------------------------------------------------------------------------
-- R4. Schema.
-- -----------------------------------------------------------------------------
-- RESULT: 34 columns both sides, 0 name, order or type mismatches (INFORMATION_SCHEMA.COLUMNS compare).

-- -----------------------------------------------------------------------------
-- R5. Dependants: INFORMATION_SCHEMA.VIEWS LIKE '%mart_daily_kpis%' in mart, stg, ops, ref.
-- -----------------------------------------------------------------------------
-- RESULT: mart.mart_monthly_kpis (R3) and stg.stg_customer_orders (reads revenue and cogs, unchanged). Nothing else.

-- -----------------------------------------------------------------------------
-- R6. Edge cases on the synthetic registry (fx1s_*): fx1s_mart_daily_kpis vs mart.mart_daily_kpis.
-- -----------------------------------------------------------------------------
-- RESULT: total rows 5364 / 5364 (no new row from the 2030 future range, no fan-out from the overlapping
--   Venev ranges); every changed spend is NULL to 0 (meta_changed_not_null_to_zero 0, google 0, paid 0);
--   venev 608 changed = 606 + the 2 NULL days inside the 2025-12-01..31 range, the real Dec 2025 spend days are
--   unchanged (a range over real spend never overrides); dobias 5 (its meta hole 2026-03-01..05); manami 0
--   (real Google spend in Sep 2026 untouched); rawbark google_spend 1 change, 2026-09-17 google 0 and paid 0
--   (prod NULL/NULL); the inverted range changed nothing; cm3 changed on 0 rows.
