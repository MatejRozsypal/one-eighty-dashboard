-- =============================================================================
-- qa/234_regression.sql
-- Regression for 234_cm3_zero_order_days.sql, protocol 5.R.
-- Run 2026-10-04 against candidates in mart_qa (prefix m234_). Results are
-- recorded under each check. Every query is read-only except section C.
--
-- Candidates (mart_qa):
--   m234_mart_daily_kpis    VIEW  live text + the two edits of 234 (see C1)
--   m234_mart_monthly_kpis  VIEW  live text unchanged, daily ref mapped to the candidate
--
-- After the prod deploy: replace `mart_qa.m234_mart_daily_kpis` with
-- `mart.mart_daily_kpis` and `mart.mart_daily_kpis` with the pre-deploy snapshot
-- `mart_qa.base_mart_daily_kpis_20261005` (take it BEFORE deploying), same for
-- the monthly view, then re-run R0 to R6 (R0 then compares prod with the file body).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- C1. Build candidates (writes to mart_qa only). The edit strings below are the
-- exact strings used to produce the 234 file body from the live text; each must
-- match exactly once (ASSERT). Run as one script.
-- -----------------------------------------------------------------------------
DECLARE def STRING DEFAULT (
  SELECT view_definition FROM `oneeighty-warehouse.mart`.INFORMATION_SCHEMA.VIEWS
  WHERE table_name = 'mart_daily_kpis');
DECLARE e1_old STRING DEFAULT """
)
SELECT
  COALESCE(s.client_id, p.client_id) AS client_id,""";
DECLARE e1_new STRING DEFAULT """
),
-- Clients that have cost data: at least one shop day with a non-NULL cogs.
-- Shopify and Shoptet always have one (cogs is coalesced to 0 or computed);
-- a Woo client has one only when some line is costed (migration 228), so
-- RawBark is absent here until its cost list is loaded.
client_cost_data AS (
  SELECT DISTINCT client_id
  FROM shop_daily
  WHERE cogs IS NOT NULL
)
SELECT
  COALESCE(s.client_id, p.client_id) AS client_id,""";
DECLARE e2_old STRING DEFAULT """  s.revenue - s.cogs - 0                                          AS cm1,
  s.revenue - s.cogs - 0 - COALESCE(s.fulfillment_cost, 0)        AS cm2,
  s.revenue - s.cogs - 0 - COALESCE(s.fulfillment_cost, 0) - COALESCE(p.paid_spend, 0) AS cm3
FROM shop_daily s
FULL OUTER JOIN paid_daily p
  ON s.client_id = p.client_id AND s.date = p.date AND s.currency = p.currency""";
DECLARE e2_new STRING DEFAULT """  -- Day with paid spend and no shop row at all (s.client_id IS NULL) for a client
  -- with cost data: no orders means revenue 0, COGS 0, fulfilment 0, so the day
  -- costs exactly its paid spend. Without a cost-data client (RawBark) it stays NULL.
  IF(s.client_id IS NULL AND k.client_id IS NOT NULL,
     CAST(0 AS NUMERIC),
     s.revenue - s.cogs - 0)                                      AS cm1,
  IF(s.client_id IS NULL AND k.client_id IS NOT NULL,
     CAST(0 AS NUMERIC) - COALESCE(s.fulfillment_cost, 0),
     s.revenue - s.cogs - 0 - COALESCE(s.fulfillment_cost, 0))    AS cm2,
  IF(s.client_id IS NULL AND k.client_id IS NOT NULL,
     CAST(0 AS NUMERIC) - COALESCE(s.fulfillment_cost, 0) - COALESCE(p.paid_spend, 0),
     s.revenue - s.cogs - 0 - COALESCE(s.fulfillment_cost, 0) - COALESCE(p.paid_spend, 0)) AS cm3
FROM shop_daily s
FULL OUTER JOIN paid_daily p
  ON s.client_id = p.client_id AND s.date = p.date AND s.currency = p.currency
LEFT JOIN client_cost_data k
  ON k.client_id = COALESCE(s.client_id, p.client_id)""";
ASSERT (LENGTH(def) - LENGTH(REPLACE(def, e1_old, ''))) = LENGTH(e1_old) AS 'e1 must match exactly once';
ASSERT (LENGTH(def) - LENGTH(REPLACE(def, e2_old, ''))) = LENGTH(e2_old) AS 'e2 must match exactly once';
EXECUTE IMMEDIATE CONCAT(
  "CREATE OR REPLACE VIEW `oneeighty-warehouse.mart_qa.m234_mart_daily_kpis` AS\n",
  REPLACE(REPLACE(def, e1_old, e1_new), e2_old, e2_new));
EXECUTE IMMEDIATE CONCAT(
  "CREATE OR REPLACE VIEW `oneeighty-warehouse.mart_qa.m234_mart_monthly_kpis` AS\n",
  REPLACE(
    (SELECT view_definition FROM `oneeighty-warehouse.mart`.INFORMATION_SCHEMA.VIEWS WHERE table_name = 'mart_monthly_kpis'),
    '`oneeighty-warehouse.mart.mart_daily_kpis`', '`oneeighty-warehouse.mart_qa.m234_mart_daily_kpis`'));


-- -----------------------------------------------------------------------------
-- R0. Text identity. The 234 body (between "AS\n" and ";") equals the live text
-- plus exactly the two edits. md5 of the body in the migration file is computed
-- locally (python hashlib, text from "WITH client_ccy AS (" to the last
-- "COALESCE(s.client_id, p.client_id)"); compare with the candidate stored text.
-- Live md5 563f7c75de0a3ccd77a1bca45a52a4f5 equals the 228 step 4 body, so 228 is
-- deployed and the only base text for 234.
-- Result 2026-10-04: see the md5 pair recorded in the 234 header.
-- -----------------------------------------------------------------------------
SELECT table_name, TO_HEX(MD5(view_definition)) AS md5, LENGTH(view_definition) AS len
FROM `oneeighty-warehouse.mart`.INFORMATION_SCHEMA.VIEWS
WHERE table_name IN ('mart_daily_kpis', 'mart_monthly_kpis', 'mart_cm3_monthly')
UNION ALL
SELECT table_name, TO_HEX(MD5(view_definition)), LENGTH(view_definition)
FROM `oneeighty-warehouse.mart_qa`.INFORMATION_SCHEMA.VIEWS
WHERE table_name = 'm234_mart_daily_kpis';


-- -----------------------------------------------------------------------------
-- R1. Whole-row diff, both directions (EXCEPT DISTINCT semantics via NOT IN on
-- TO_JSON_STRING), per client, date < CURRENT_DATE(), full 60 months.
-- Result 2026-10-04 (rows 5364 prod and candidate, no fan-out):
--   dobias  0 | rawbark 0 | ethia 55 each side (2025-02-20..2026-10-03)
--   manami  17 each side (2025-05-16..2026-01-22, none in the last 90 days)
--   venev   84 each side (2025-12-05..2026-10-03)
-- Every differing row is explained exactly in R2.
-- -----------------------------------------------------------------------------
WITH p AS (SELECT TO_JSON_STRING(t) AS j, client_id, date
           FROM `oneeighty-warehouse.mart.mart_daily_kpis` t WHERE date < CURRENT_DATE()),
c AS (SELECT TO_JSON_STRING(t) AS j, client_id, date
      FROM `oneeighty-warehouse.mart_qa.m234_mart_daily_kpis` t WHERE date < CURRENT_DATE()),
prod_only AS (SELECT client_id, date FROM p WHERE j NOT IN (SELECT j FROM c)),
cand_only AS (SELECT client_id, date FROM c WHERE j NOT IN (SELECT j FROM p))
SELECT client_id, 'prod_not_in_cand' AS side, COUNT(*) AS n, MIN(date) AS mn, MAX(date) AS mx FROM prod_only GROUP BY 1
UNION ALL SELECT client_id, 'cand_not_in_prod', COUNT(*), MIN(date), MAX(date) FROM cand_only GROUP BY 1
UNION ALL SELECT 'ALL_ROWS', 'prod_rows', COUNT(*), NULL, NULL FROM p
UNION ALL SELECT 'ALL_ROWS', 'cand_rows', COUNT(*), NULL, NULL FROM c
ORDER BY 1, 2;


-- -----------------------------------------------------------------------------
-- R2. Exact explanation, per client, full history and last 90 days.
-- A row "as designed" has in prod: orders NULL (no shop row), revenue, cm1, cm2,
-- cm3 NULL; in the candidate: cm1 = 0, cm2 = 0, cm3 = -paid_spend. Everything
-- else (every other column) must be identical.
-- Result 2026-10-04:
--   client  window       rows  non_cm_diffs changed not_as_designed dropped_spend  sum_cm3_delta
--   dobias  all_history  1825  0            0       0               0              0
--   dobias  last_90d       90  0            0       0               0              0
--   ethia   all_history   516  0            55      0               29572.13       -29572.13
--   ethia   last_90d       90  0             5      0                4734.43       -4734.43
--   manami  all_history   833  0            17      0                6686.7553     -6686.7553
--   manami  last_90d       90  0             0      0               0              0
--   rawbark all_history  1463  0            0       0               0              0   (NULL stays NULL)
--   rawbark last_90d       90  0            0       0               0              0
--   venev   all_history   727  0            84      0                4446.5496     -4446.5496
--   venev   last_90d       48  0            38      0                2674.3257     -2674.3257
-- (sum_cm3_delta is candidate minus prod, so it is the added cost; the sign is
-- the sign of the dropped spend, which prod ignored.) paid_only_rows_unchanged
-- is 0 everywhere: no paid-only row of a cost-data client keeps a NULL cm3.
-- manami: 17 paid-only days (6,686.76 CZK), all before the last 90 days, so the
-- 90-day diff is 0 but the full-history diff is not.
-- -----------------------------------------------------------------------------
WITH j AS (
  SELECT p.client_id, p.date, p.currency, p AS pr, c AS cr
  FROM `oneeighty-warehouse.mart.mart_daily_kpis` p
  JOIN `oneeighty-warehouse.mart_qa.m234_mart_daily_kpis` c USING (client_id, date, currency)
  WHERE p.date < CURRENT_DATE()
), x AS (
  SELECT client_id, date,
    TO_JSON_STRING((SELECT AS STRUCT pr.* EXCEPT (cm1, cm2, cm3)))
      != TO_JSON_STRING((SELECT AS STRUCT cr.* EXCEPT (cm1, cm2, cm3))) AS non_cm_diff,
    (pr.cm1 IS DISTINCT FROM cr.cm1 OR pr.cm2 IS DISTINCT FROM cr.cm2
       OR pr.cm3 IS DISTINCT FROM cr.cm3) AS cm_changed,
    (pr.orders IS NULL AND pr.revenue IS NULL AND pr.cm1 IS NULL AND pr.cm2 IS NULL AND pr.cm3 IS NULL
       AND cr.cm1 = 0 AND cr.cm2 = 0 AND cr.cm3 = -pr.paid_spend) AS as_designed,
    pr.paid_spend AS prod_paid, pr.cm3 AS p_cm3, cr.cm3 AS c_cm3, pr.orders AS p_orders
  FROM j
)
SELECT client_id, w AS window_,
  COUNT(*) AS rows_joined,
  COUNTIF(non_cm_diff) AS non_cm_column_diffs,
  COUNTIF(cm_changed) AS rows_changed,
  COUNTIF(cm_changed AND NOT as_designed) AS changed_not_as_designed,
  COUNTIF(p_orders IS NULL AND NOT cm_changed) AS paid_only_rows_unchanged,
  ROUND(SUM(IF(cm_changed, prod_paid, 0)), 4) AS dropped_spend_on_changed_rows,
  ROUND(COALESCE(SUM(c_cm3), 0) - COALESCE(SUM(p_cm3), 0), 4) AS sum_cm3_delta
FROM x, UNNEST(['all_history', 'last_90d']) AS w
WHERE w = 'all_history' OR date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
GROUP BY 1, 2 ORDER BY 1, 2;
-- Note on rawbark paid_only_rows_unchanged = 0: RawBark has no paid-only day today
-- (0 rows with orders NULL), so its NULL rule is proven by R5 (not in the cost-data
-- list) and R6 (synthetic row), not by live rows.


-- -----------------------------------------------------------------------------
-- R3. SUM(cm3) equals the component formula, last 90 complete days, per client,
-- prod vs candidate. component = SUM(revenue) - SUM(cogs) - SUM(fulfillment_cost)
-- - SUM(paid_spend) (null sums as 0 for fulfilment and spend, as the registry does).
-- Also the row-level identity with a NULL revenue read as 0 and the CM stack
-- monotonic check (cm1 <= revenue, cm2 <= cm1, cm3 <= cm2).
-- Result 2026-10-04 (days, sum_cm3, component_cm3, diff, row_mismatches, monotonic_violations, cm3_null_rows):
--   dobias  prod 90  449529.89   449529.89   0         0 0 0  | cand identical
--   ethia   prod 90  126151.3526 121416.9226 4734.43   0 0 5  | cand 90 121416.9226 121416.9226 0 0 0 0
--   manami  prod 90  251049.9287 251049.9287 0         0 0 0  | cand identical
--   rawbark prod 90  NULL        NULL        NULL      0 0 90 | cand identical (no cost data, NULL by design)
--   venev   prod 48  -285.8479   -2960.1736  2674.3257 0 0 38 | cand 48 -2960.1736 -2960.1736 0 0 0 0
-- prod rows differ from the component formula by exactly the dropped spend; the
-- candidate has diff 0 and no NULL cm3 row for any client with cost data.
-- RawBark is NULL on both sides: every day lacks COGS ("not measured").
-- -----------------------------------------------------------------------------
WITH u AS (
  SELECT 'prod' AS src, client_id, revenue, cogs, fulfillment_cost, paid_spend, cm1, cm2, cm3, date
  FROM `oneeighty-warehouse.mart.mart_daily_kpis`
  UNION ALL
  SELECT 'cand', client_id, revenue, cogs, fulfillment_cost, paid_spend, cm1, cm2, cm3, date
  FROM `oneeighty-warehouse.mart_qa.m234_mart_daily_kpis`
)
SELECT client_id, src, COUNT(*) AS days,
  ROUND(SUM(cm3), 4) AS sum_cm3,
  ROUND(SUM(revenue) - SUM(cogs) - COALESCE(SUM(fulfillment_cost), 0) - COALESCE(SUM(paid_spend), 0), 4) AS component_cm3,
  ROUND(SUM(cm3) - (SUM(revenue) - SUM(cogs) - COALESCE(SUM(fulfillment_cost), 0) - COALESCE(SUM(paid_spend), 0)), 4) AS diff,
  COUNTIF(cm3 IS DISTINCT FROM (COALESCE(revenue, 0) - cogs - COALESCE(fulfillment_cost, 0) - COALESCE(paid_spend, 0))) AS row_mismatches_null_rev_as_0,
  COUNTIF(cm3 IS NOT NULL AND (cm1 > COALESCE(revenue, 0) OR cm2 > cm1 OR cm3 > cm2)) AS monotonic_violations,
  COUNTIF(cm3 IS NULL) AS cm3_null_rows
FROM u
WHERE date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
GROUP BY 1, 2 ORDER BY 1, 2 DESC;


-- -----------------------------------------------------------------------------
-- R4. mart_monthly_kpis (SUMs the daily view, no edit needed): prod vs the
-- candidate fed by the candidate daily view. Only cm1/cm2/cm3 may differ
-- (google_* FLOAT64 columns excluded from the whole-row comparison, RB17).
-- Result 2026-10-04 (months joined, non_cm_diffs, months_cm3_changed, null_to_value, sum_delta_cm3, sum_delta_cm1):
--   dobias 61 0 0 0 0 0
--   ethia  21 0 15 1 -29572.13 0
--   manami 30 0 7 0 -6686.7553 0
--   rawbark 49 0 0 0 NULL NULL
--   venev  51 0 7 1 -4446.5496 0
-- cm1 never changes in a month that has orders (days with orders are untouched);
-- the one null_to_value month per client is a month with paid spend and no order.
-- -----------------------------------------------------------------------------
WITH j AS (
  SELECT p.client_id, p.month_start, p.currency,
    p.cm1 AS pcm1, p.cm3 AS pcm3, c.cm1 AS ccm1, c.cm3 AS ccm3,
    TO_JSON_STRING((SELECT AS STRUCT p.* EXCEPT (cm1, cm2, cm3, google_spend, google_revenue, google_purchases)))
      != TO_JSON_STRING((SELECT AS STRUCT c.* EXCEPT (cm1, cm2, cm3, google_spend, google_revenue, google_purchases))) AS non_cm_diff
  FROM `oneeighty-warehouse.mart.mart_monthly_kpis` p
  JOIN `oneeighty-warehouse.mart_qa.m234_mart_monthly_kpis` c USING (client_id, month_start, currency)
)
SELECT client_id, COUNT(*) AS months, COUNTIF(non_cm_diff) AS non_cm_diffs,
  COUNTIF(pcm3 IS DISTINCT FROM ccm3) AS months_cm3_changed,
  COUNTIF(pcm3 IS NULL AND ccm3 IS NOT NULL) AS months_null_to_value,
  ROUND(SUM(ccm3) - SUM(pcm3), 4) AS sum_delta_cm3,
  ROUND(SUM(ccm1) - SUM(pcm1), 4) AS sum_delta_cm1
FROM j GROUP BY 1 ORDER BY 1;


-- -----------------------------------------------------------------------------
-- R5. Column schema identical (names, order, types) and which clients have cost
-- data (the client_cost_data rule).
-- Result 2026-10-04: schema_mismatches 0 of 34 columns; clients with cost data
-- dobias, ethia, manami, venev; without: rawbark.
-- -----------------------------------------------------------------------------
WITH p AS (SELECT column_name, ordinal_position, data_type FROM `oneeighty-warehouse.mart`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'mart_daily_kpis'),
c AS (SELECT column_name, ordinal_position, data_type FROM `oneeighty-warehouse.mart_qa`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'm234_mart_daily_kpis')
SELECT 'schema_mismatches' AS k, CAST(COUNT(*) AS STRING) AS v
FROM p FULL JOIN c USING (column_name)
WHERE p.ordinal_position IS DISTINCT FROM c.ordinal_position OR p.data_type IS DISTINCT FROM c.data_type
UNION ALL SELECT 'columns', CAST(COUNT(*) AS STRING) FROM p
UNION ALL SELECT 'clients_with_cost_data', STRING_AGG(client_id ORDER BY client_id)
  FROM (SELECT DISTINCT client_id FROM `oneeighty-warehouse.mart.mart_daily_kpis` WHERE cogs IS NOT NULL)
UNION ALL SELECT 'clients_without_cost_data', STRING_AGG(client_id ORDER BY client_id)
  FROM (SELECT DISTINCT client_id FROM `oneeighty-warehouse.mart.mart_daily_kpis`
        WHERE client_id NOT IN (SELECT client_id FROM `oneeighty-warehouse.mart.mart_daily_kpis` WHERE cogs IS NOT NULL));


-- -----------------------------------------------------------------------------
-- R6. Synthetic proof of the rule edges (same predicate and expressions as the
-- 234 final SELECT, hand-made rows, no table read).
-- Result 2026-10-04:
--   costed      01-01 shop row           cm1 60,   cm2 60,   cm3 60
--   costed      01-02 paid only (30)     cm1 0,    cm2 0,    cm3 -30   (the fix)
--   dobias_like 01-01 shop row, revenue NULL, paid 7: NULL NULL NULL (shop row exists, unchanged)
--   nodata      01-02 paid only (9), client has no shop rows: NULL (no cost data)
--   rawbark     01-01 shop row, cogs NULL: NULL
--   rawbark     01-02 paid only (30): NULL NULL NULL (stays NULL, not -30)
-- -----------------------------------------------------------------------------
WITH shop_daily AS (
  SELECT 'rawbark' AS client_id, DATE '2026-01-01' AS date, 'CZK' AS currency, CAST(100 AS NUMERIC) AS revenue, CAST(NULL AS NUMERIC) AS cogs, CAST(0 AS NUMERIC) AS fulfillment_cost
  UNION ALL SELECT 'costed', DATE '2026-01-01', 'CZK', 100, 40, 0
  UNION ALL SELECT 'dobias_like', DATE '2026-01-01', 'USD', CAST(NULL AS NUMERIC), 5, 0
), paid_daily AS (
  SELECT 'rawbark' AS client_id, DATE '2026-01-02' AS date, 'CZK' AS currency, CAST(30 AS NUMERIC) AS paid_spend
  UNION ALL SELECT 'costed', DATE '2026-01-02', 'CZK', 30
  UNION ALL SELECT 'dobias_like', DATE '2026-01-01', 'USD', 7
  UNION ALL SELECT 'nodata', DATE '2026-01-02', 'CZK', 9
), client_cost_data AS (SELECT DISTINCT client_id FROM shop_daily WHERE cogs IS NOT NULL)
SELECT COALESCE(s.client_id, p.client_id) AS client_id, COALESCE(s.date, p.date) AS date, s.revenue, p.paid_spend,
  IF(s.client_id IS NULL AND k.client_id IS NOT NULL, CAST(0 AS NUMERIC),
     s.revenue - s.cogs - 0) AS cm1,
  IF(s.client_id IS NULL AND k.client_id IS NOT NULL, CAST(0 AS NUMERIC) - COALESCE(s.fulfillment_cost, 0),
     s.revenue - s.cogs - 0 - COALESCE(s.fulfillment_cost, 0)) AS cm2,
  IF(s.client_id IS NULL AND k.client_id IS NOT NULL, CAST(0 AS NUMERIC) - COALESCE(s.fulfillment_cost, 0) - COALESCE(p.paid_spend, 0),
     s.revenue - s.cogs - 0 - COALESCE(s.fulfillment_cost, 0) - COALESCE(p.paid_spend, 0)) AS cm3
FROM shop_daily s
FULL OUTER JOIN paid_daily p ON s.client_id = p.client_id AND s.date = p.date AND s.currency = p.currency
LEFT JOIN client_cost_data k ON k.client_id = COALESCE(s.client_id, p.client_id)
ORDER BY 1, 2;
