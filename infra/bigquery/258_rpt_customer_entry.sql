-- =============================================================================
-- 258_rpt_customer_entry.sql
-- One row per client and customer for cohort repeat and upgrade rates, plus the cohort view
-- and the unclassified product monitor. Package WR1 of retention/03_design.md, sections 1
-- and 2.2 (design number 256, renumbered to 258).
--
-- Change (additive, nothing existing is modified)
--   NEW PROCEDURE mart.sp_refresh_rpt_customer_entry(): the 253 pattern. Builds
--                 mart.rpt_customer_entry__next, checks it, swaps it in with
--                 CREATE OR REPLACE TABLE ... COPY and drops __next. ASSERTs:
--                   * rows > 0
--                   * rows >= 90 % of the live table (skipped on the first run)
--                   * no duplicate (client_id, customer_id)
--                   * every client of stg.stg_customer_orders is present
--                   * flag order: u <= r <= m per horizon, m nested by horizon,
--                     r23_180 <= m23_180, du <= dm
--                 Child jobs carry the label feature=rpt-customer-entry-refresh.
--   NEW TABLE     mart.rpt_customer_entry, 54 columns, CLUSTER BY client_id, cohort_month.
--                 43,486 rows, 17.6 MB on 2026-10-05 (dobias 21,655, rawbark 14,484,
--                 venev 3,155, manami 2,936, ethia 1,256). customer_id = SHA256 of
--                 client_id|customer_key; no email leaves stg. Flag columns are INT64 0/1.
--   NEW VIEW      mart.mart_retention_cohorts: the table grouped by client_id, cohort_month,
--                 entry_class, is_early. Sums keep the table column names (n_customer, m*,
--                 r*, u*, m23_180, r23_180), plus classes_configured, cutoff_date,
--                 data_start_date, history_guard_days, n_unmatched, refreshed_at.
--   NEW VIEW      ops.v_unclassified_products: per client with classes, product codes whose
--                 lines matched no rule ('no rule'), or only the default rule and were first
--                 seen after that rule was last updated ('default'). 0 rows today. Scans the
--                 three stg item views (about 240 MB), read it on demand only.
--
-- Definitions (design 1.1 to 1.7, owner decisions 2026-10-05)
--   Valid order: row of stg.stg_customer_orders, customer_key NOT NULL, revenue > 0 or NULL,
--   not a Shoptet "Reklamace*" order, not a Shopify REFUNDED or VOIDED order. "Slevovy kod -
--   testery" orders count as normal paid orders.
--   Same-day orders merge into the first order (entry basket); 2nd and 3rd order = next
--   order days. Parity columns (*_any_date, entry_class_first_order) keep the audit rule.
--   as_of_date = yesterday in ref.clients.timezone, cutoff_date = as_of_date - sync_lag_days.
--   mH = first_order_date + H <= cutoff_date; rH = mH and 2nd order within H days;
--   uH = mH and first later full-size order within H days.
--   is_early = first_order_date < data_start_date + history_guard_days (Manami 180).
--
-- Deviation from the design sketch
--   * revenue NULL counts as valid. Dobias has 34,325 orders before mid 2022 (migrated
--     store) with NULL revenue. With "revenue > 0" they all drop out, Dobias falls from
--     21,866 to 13,409 customers and migrated customers' later orders become false first
--     orders. Zero-revenue orders (free or replacement shipments) stay excluded.
--   * Extra columns: first_day_orders, order_days_total, history_guard_days.
--   * has_unmatched_line is NULL for clients without classes, and only looks at lines
--     that exist (an order without item rows is not "unmatched").
--
-- Based on the live views stg.stg_customer_orders, stg.stg_shoptet_orders,
-- stg.stg_shopify_orders, stg.stg_shoptet_order_items, stg.stg_shopify_order_items,
-- stg.stg_woo_order_items and ref.clients (live/ files, 2026-10-05). None of them changes.
--
-- Affected clients: none of the existing objects change.
--
-- Regression (qa/258_rpt_customer_entry_regression.sql, mart_qa prefix wr1_, then prod)
--   Audit parity (Manami, cut-off 2026-10-04, lag 0, guard 0, no validity filter): per
--   customer EXCEPT DISTINCT against mart_qa.ret_manami_orders 0 and 0 (2,940 customers);
--   every acceptance number of design 6 reproduced exactly.
--   Production mode (Manami): discovery R_90 Jan to Jun 2026 12.1 % (59 of 488), U_90
--   11.5 %; R_180 Oct 2025 to Mar 2026 9.6 % (37 of 387), U_180 8.5 %; all-customer R_365
--   non-early 15.7 % (111 of 709).
--   Generic, all 5 clients: independent recompute from stg_customer_orders 0 and 0 per
--   customer; order totals and customer counts equal; no duplicates; entry classes and
--   discovery flags NULL or 0 for the 4 clients without classes; flag order holds.
--   Prod table equals the mart_qa candidate (EXCEPT DISTINCT without refreshed_at: 0 and 0).
--
-- Cost: 486 MB processed, 547 MB billed per CALL (CTAS 441 MB, client check 94 MB billed,
-- row checks 12 MB), 22 to 25 s. Hourly: about 390 GB a month, roughly USD 2.5 at EU
-- on-demand prices. App reads: under 20 MB processed, 10 MB billed minimum per table.
--
-- IAM: the scheduled query runs as its owner (user with dataOwner on mart). The dashboard
-- service account sa-frontend-reader has roles/bigquery.dataViewer on dataset mart
-- (dataset level), so it reads the new table and view without a further grant.
-- ops.v_unclassified_products is internal (no app reader yet).
--
-- Deploy order (owner approved 2026-10-05, after the mart_qa regression passed; done
-- 2026-10-05)
--   1. 257_ref_retention.sql.
--   2. Statement 1 (procedure) and statement 2 (first CALL, about 25 s, creates the table).
--   3. Statements 3 and 4 (views).
--   4. Checks in qa/258_rpt_customer_entry_regression.sql against prod names.
--   5. Owner: add the CALL to the scheduled query rpt_refresh_hourly (text at the end).
-- Rollback: DROP VIEW ops.v_unclassified_products, DROP VIEW mart.mart_retention_cohorts,
-- DROP TABLE mart.rpt_customer_entry, DROP TABLE IF EXISTS mart.rpt_customer_entry__next,
-- DROP PROCEDURE mart.sp_refresh_rpt_customer_entry; remove the CALL line from the
-- scheduled query.
-- =============================================================================

-- 1. Procedure (identical to live/mart.sp_refresh_rpt_customer_entry.sql)
CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_rpt_customer_entry`()
OPTIONS (description = 'Rebuilds mart.rpt_customer_entry (one row per client and customer: first order, entry class, 2nd and 3rd order, first full-size order, horizon flags) from stg.stg_customer_orders, the three stg item views, ref.product_classes and ref.retention_settings. Builds mart.rpt_customer_entry__next, checks it (rows > 0, >= 90 % of the current table, unique client and customer, every shop client present, flag order u <= r <= m), then swaps it in with CREATE OR REPLACE TABLE ... COPY. Any failure leaves the current table untouched. Migration 258. Run hourly by the BigQuery scheduled query rpt_refresh_hourly.')
BEGIN
  DECLARE prev_rows INT64;
  DECLARE new_rows INT64;
  DECLARE dup_rows INT64;
  DECLARE n_clients INT64;
  DECLARE shop_clients INT64;
  DECLARE bad_flags INT64;

  SET @@query_label = 'feature:rpt-customer-entry-refresh';

  -- Rows in the table that is live now. NULL on the first run (table absent).
  SET prev_rows = (
    SELECT row_count FROM `oneeighty-warehouse.mart`.__TABLES__
    WHERE table_id = 'rpt_customer_entry');

  -- 1. Build the next version beside the live one.
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.rpt_customer_entry__next`
  CLUSTER BY client_id, cohort_month
  OPTIONS (description = 'Staging copy for mart.sp_refresh_rpt_customer_entry. Not for reading.')
  AS
  WITH cfg AS (
    SELECT c.client_id, c.timezone,
      s.data_start_date,
      IFNULL(s.history_guard_days, 0) AS guard_days,
      IFNULL(s.sync_lag_days, 3) AS lag_days,
      c.client_id IN (SELECT client_id FROM `oneeighty-warehouse.ref.product_classes`) AS classes_configured
    FROM `oneeighty-warehouse.ref.clients` c
    LEFT JOIN `oneeighty-warehouse.ref.retention_settings` s USING (client_id)
  ),
  orders AS (
    -- Valid orders (design 1.1). stg_customer_orders already drops cancelled orders.
    -- Zero revenue = free or replacement shipment, excluded. NULL revenue = amount not
    -- migrated (Dobias orders before mid 2022), kept: dropping them would turn migrated
    -- customers' later orders into false first orders.
    SELECT o.client_id, o.order_id, o.order_date, o.customer_key, o.revenue
    FROM `oneeighty-warehouse.stg.stg_customer_orders` o
    LEFT JOIN (SELECT client_id, order_code, status FROM `oneeighty-warehouse.stg.stg_shoptet_orders`) s
      ON o.platform = 'shoptet' AND s.client_id = o.client_id AND s.order_code = o.order_id
    LEFT JOIN (SELECT client_id, order_id, financial_status FROM `oneeighty-warehouse.stg.stg_shopify_orders`) f
      ON o.platform = 'shopify' AND f.client_id = o.client_id AND f.order_id = o.order_id
    WHERE o.customer_key IS NOT NULL
      AND (o.revenue IS NULL OR o.revenue > 0)
      AND NOT IFNULL(STARTS_WITH(LOWER(s.status), 'reklamace'), FALSE)
      AND NOT IFNULL(f.financial_status IN ('REFUNDED', 'VOIDED'), FALSE)
  ),
  lines AS (
    -- One row per order line with its code, code base and name (design 1.4).
    SELECT client_id, order_code AS order_id, item_key AS line_id,
      NULLIF(TRIM(item_code), '') AS code,
      REGEXP_EXTRACT(NULLIF(TRIM(item_code), ''), r'^[^/]+') AS code_base,
      item_name AS name
    FROM `oneeighty-warehouse.stg.stg_shoptet_order_items`
    UNION ALL
    SELECT client_id, order_id, CAST(NULL AS STRING),
      NULLIF(TRIM(sku), ''), NULLIF(TRIM(sku), ''), item_name
    FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
    UNION ALL
    SELECT client_id, order_id, line_item_id,
      COALESCE(NULLIF(TRIM(sku), ''), NULLIF(NULLIF(variation_id, ''), '0'), NULLIF(product_id, '')),
      COALESCE(NULLIF(TRIM(sku), ''), NULLIF(product_id, '')),
      item_name
    FROM `oneeighty-warehouse.stg.stg_woo_order_items`
  ),
  classed AS (
    -- The matching rule with the lowest priority wins. cls NULL = no rule matched.
    SELECT o.client_id, o.order_id, l.line_id, l.code, l.code_base, l.name,
      ARRAY_AGG(IF(r.client_id IS NULL, NULL,
                   STRUCT(r.line_class, r.counts_as_full, r.match_type))
                IGNORE NULLS ORDER BY r.priority LIMIT 1)[SAFE_OFFSET(0)] AS cls
    FROM orders o
    JOIN lines l ON l.client_id = o.client_id AND l.order_id = o.order_id
    LEFT JOIN `oneeighty-warehouse.ref.product_classes` r
      ON r.client_id = l.client_id
     AND (r.valid_from IS NULL OR o.order_date >= r.valid_from)
     AND (r.valid_to IS NULL OR o.order_date < r.valid_to)
     AND CASE r.match_type
           WHEN 'code'        THEN l.code = r.pattern
           WHEN 'code_base'   THEN l.code_base = r.pattern
           WHEN 'code_prefix' THEN STARTS_WITH(l.code, r.pattern)
           WHEN 'name_prefix' THEN STARTS_WITH(l.name, r.pattern)
           WHEN 'name_regex'  THEN REGEXP_CONTAINS(l.name, r.pattern)
           WHEN 'default'     THEN TRUE
         END
    GROUP BY o.client_id, o.order_id, l.line_id, l.code, l.code_base, l.name
  ),
  ord AS (
    -- Order flags. LEFT JOIN keeps orders without item rows (n_lines = 0).
    SELECT o.client_id, o.customer_key, o.order_id, o.order_date, o.revenue,
      COUNT(c.order_id) AS n_lines,
      IFNULL(LOGICAL_OR(c.cls.line_class = 'discovery'), FALSE) AS has_disc,
      IFNULL(LOGICAL_OR(c.cls.counts_as_full), FALSE)          AS has_full,
      IFNULL(LOGICAL_OR(c.cls.line_class = 'gift_set'), FALSE)  AS has_gift,
      IFNULL(LOGICAL_OR(c.cls.line_class = 'sample'), FALSE)    AS has_sample,
      LOGICAL_OR(IF(c.order_id IS NULL, NULL,
                    c.cls IS NULL OR c.cls.match_type = 'default')) AS has_unmatched
    FROM orders o
    LEFT JOIN classed c ON c.client_id = o.client_id AND c.order_id = o.order_id
    GROUP BY o.client_id, o.customer_key, o.order_id, o.order_date, o.revenue
  ),
  seq AS (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY client_id, customer_key ORDER BY order_date, order_id) AS n,
      DENSE_RANK() OVER (PARTITION BY client_id, customer_key ORDER BY order_date) AS day_n
    FROM ord
  ),
  cust AS (
    -- Entry basket = every valid order on the first order day (design 1.3).
    SELECT client_id, customer_key,
      MIN(order_date) AS first_order_date,
      LOGICAL_OR(IF(day_n = 1, n_lines > 0, NULL))   AS b_items,
      LOGICAL_OR(IF(day_n = 1, has_disc, NULL))      AS b_disc,
      LOGICAL_OR(IF(day_n = 1, has_full, NULL))      AS b_full,
      LOGICAL_OR(IF(day_n = 1, has_gift, NULL))      AS b_gift,
      LOGICAL_OR(IF(day_n = 1, has_sample, NULL))    AS b_sample,
      LOGICAL_OR(IF(day_n = 1, has_unmatched, NULL)) AS b_unmatched,
      SUM(IF(day_n = 1, revenue, 0)) AS first_order_revenue,
      COUNTIF(day_n = 1) AS first_day_orders,
      COUNT(*) AS orders_total,
      MAX(day_n) AS order_days_total,
      MIN(IF(day_n = 2, order_date, NULL)) AS second_order_date,
      MIN(IF(day_n = 3, order_date, NULL)) AS third_order_date,
      MIN(IF(day_n >= 2 AND has_full, order_date, NULL)) AS first_full_date,
      -- Parity columns (audit rule: order sequence, same day included).
      MIN(IF(n = 2, order_date, NULL)) AS second_order_any_date,
      MIN(IF(n = 3, order_date, NULL)) AS third_order_any_date,
      MIN(IF(n >= 2 AND has_full, order_date, NULL)) AS first_full_any_date,
      ARRAY_AGG(STRUCT(n_lines > 0 AS o_items, has_disc AS o_disc, has_full AS o_full,
                       has_gift AS o_gift, has_sample AS o_sample)
                ORDER BY n LIMIT 1)[OFFSET(0)] AS o1
    FROM seq
    GROUP BY client_id, customer_key
  ),
  base AS (
    SELECT k.*, g.classes_configured, g.guard_days, g.lag_days,
      DATE_SUB(CURRENT_DATE(g.timezone), INTERVAL 1 DAY) AS as_of_date,
      DATE_SUB(CURRENT_DATE(g.timezone), INTERVAL 1 + g.lag_days DAY) AS cutoff_date,
      COALESCE(g.data_start_date,
               MIN(k.first_order_date) OVER (PARTITION BY k.client_id)) AS data_start_date
    FROM cust k
    JOIN cfg g USING (client_id)
  ),
  e AS (
    SELECT b.*,
      IF(NOT classes_configured, NULL, CASE
        WHEN NOT b_items        THEN 'unknown'
        WHEN b_disc AND b_full  THEN 'mixed'
        WHEN b_disc             THEN 'discovery'
        WHEN b_gift             THEN 'gift'
        WHEN b_full             THEN 'full'
        WHEN b_sample           THEN 'sample'
        ELSE 'other' END) AS entry_class,
      IF(NOT classes_configured, NULL, CASE
        WHEN NOT o1.o_items         THEN 'unknown'
        WHEN o1.o_disc AND o1.o_full THEN 'mixed'
        WHEN o1.o_disc              THEN 'discovery'
        WHEN o1.o_gift              THEN 'gift'
        WHEN o1.o_full              THEN 'full'
        WHEN o1.o_sample            THEN 'sample'
        ELSE 'other' END) AS entry_class_first_order,
      DATE_ADD(first_order_date, INTERVAL 30 DAY)  <= cutoff_date AS mat30,
      DATE_ADD(first_order_date, INTERVAL 60 DAY)  <= cutoff_date AS mat60,
      DATE_ADD(first_order_date, INTERVAL 90 DAY)  <= cutoff_date AS mat90,
      DATE_ADD(first_order_date, INTERVAL 180 DAY) <= cutoff_date AS mat180,
      DATE_ADD(first_order_date, INTERVAL 365 DAY) <= cutoff_date AS mat365,
      DATE_DIFF(second_order_date, first_order_date, DAY) AS d2,
      DATE_DIFF(first_full_date, first_order_date, DAY) AS dfull,
      second_order_date IS NOT NULL
        AND DATE_ADD(second_order_date, INTERVAL 180 DAY) <= cutoff_date AS mat23
    FROM base b
  )
  SELECT
    client_id,
    TO_HEX(SHA256(CONCAT(client_id, '|', customer_key))) AS customer_id,
    DATE_TRUNC(first_order_date, MONTH) AS cohort_month,
    first_order_date,
    classes_configured,
    entry_class,
    entry_class_first_order,
    IF(classes_configured, IFNULL(b_unmatched, FALSE), NULL) AS has_unmatched_line,
    first_order_revenue,
    first_day_orders,
    orders_total,
    order_days_total,
    second_order_date,
    third_order_date,
    first_full_date,
    second_order_any_date,
    third_order_any_date,
    first_full_any_date,
    data_start_date,
    guard_days AS history_guard_days,
    as_of_date,
    cutoff_date,
    first_order_date < DATE_ADD(data_start_date, INTERVAL guard_days DAY) AS is_early,
    DATE_DIFF(cutoff_date, first_order_date, DAY) AS observed_days,
    d2 AS days_to_2nd,
    DATE_DIFF(third_order_date, second_order_date, DAY) AS days_2nd_to_3rd,
    dfull AS days_to_full,
    1 AS n_customer,
    IF(mat30, 1, 0)  AS m30,
    IF(mat60, 1, 0)  AS m60,
    IF(mat90, 1, 0)  AS m90,
    IF(mat180, 1, 0) AS m180,
    IF(mat365, 1, 0) AS m365,
    IF(mat30  AND d2 <= 30, 1, 0)  AS r30,
    IF(mat60  AND d2 <= 60, 1, 0)  AS r60,
    IF(mat90  AND d2 <= 90, 1, 0)  AS r90,
    IF(mat180 AND d2 <= 180, 1, 0) AS r180,
    IF(mat365 AND d2 <= 365, 1, 0) AS r365,
    IF(mat30  AND dfull <= 30, 1, 0)  AS u30,
    IF(mat60  AND dfull <= 60, 1, 0)  AS u60,
    IF(mat90  AND dfull <= 90, 1, 0)  AS u90,
    IF(mat180 AND dfull <= 180, 1, 0) AS u180,
    IF(mat365 AND dfull <= 365, 1, 0) AS u365,
    IF(entry_class = 'discovery', 1, 0) AS is_discovery,
    IF(second_order_date IS NOT NULL, 1, 0) AS has_second,
    IF(mat23, 1, 0) AS m23_180,
    IF(mat23 AND DATE_DIFF(third_order_date, second_order_date, DAY) <= 180, 1, 0) AS r23_180,
    IF(entry_class = 'discovery' AND mat90, 1, 0)  AS dm90,
    IF(entry_class = 'discovery' AND mat90  AND dfull <= 90, 1, 0)  AS du90,
    IF(entry_class = 'discovery' AND mat180, 1, 0) AS dm180,
    IF(entry_class = 'discovery' AND mat180 AND dfull <= 180, 1, 0) AS du180,
    IF(entry_class = 'discovery' AND mat365, 1, 0) AS dm365,
    IF(entry_class = 'discovery' AND mat365 AND dfull <= 365, 1, 0) AS du365,
    CURRENT_TIMESTAMP() AS refreshed_at
  FROM e;

  -- 2. Checks. A failed ASSERT ends the procedure here: the live table stays as it was.
  SET (new_rows, dup_rows, n_clients, bad_flags) = (
    SELECT AS STRUCT
      COUNT(*),
      COUNT(*) - COUNT(DISTINCT FORMAT('%s|%s', client_id, customer_id)),
      COUNT(DISTINCT client_id),
      COUNTIF(u30 > r30 OR u60 > r60 OR u90 > r90 OR u180 > r180 OR u365 > r365
              OR r30 > m30 OR r60 > m60 OR r90 > m90 OR r180 > m180 OR r365 > m365
              OR m60 > m30 OR m90 > m60 OR m180 > m90 OR m365 > m180
              OR r23_180 > m23_180 OR du90 > dm90 OR du180 > dm180 OR du365 > dm365)
    FROM `oneeighty-warehouse.mart.rpt_customer_entry__next`);
  SET shop_clients = (
    SELECT COUNT(DISTINCT client_id) FROM `oneeighty-warehouse.stg.stg_customer_orders`);

  ASSERT new_rows > 0
    AS 'rpt_customer_entry refresh: 0 customers, live table kept';
  ASSERT prev_rows IS NULL OR new_rows >= 0.9 * prev_rows
    AS 'rpt_customer_entry refresh: new row count is below 90 % of the live table, live table kept';
  ASSERT dup_rows = 0
    AS 'rpt_customer_entry refresh: duplicate client_id and customer_id rows, live table kept';
  ASSERT n_clients >= shop_clients
    AS 'rpt_customer_entry refresh: a client with orders is missing (ref.clients row?), live table kept';
  ASSERT bad_flags = 0
    AS 'rpt_customer_entry refresh: flag order u <= r <= m violated, live table kept';

  -- 3. Swap. One statement: readers see the old table or the new one, never a mix.
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.rpt_customer_entry`
  COPY `oneeighty-warehouse.mart.rpt_customer_entry__next`
  OPTIONS (description = 'One row per client and customer (customer_id = SHA256 of client and email, no email stored): first order date, entry class from ref.product_classes (NULL when the client has no classes), 2nd and 3rd order days, first later full-size order, cut-off and maturity, horizon flags m/r/u for 30, 60, 90, 180, 365 days (INT64 0/1, sum them), 2nd to 3rd ladder, early flag (left censoring). Built by mart.sp_refresh_rpt_customer_entry (hourly). Migration 258.');

  DROP TABLE IF EXISTS `oneeighty-warehouse.mart.rpt_customer_entry__next`;
END;

-- 2. First build (creates mart.rpt_customer_entry). About 25 s, about 550 MB billed.
CALL `oneeighty-warehouse.mart.sp_refresh_rpt_customer_entry`();

-- 3. Cohort view (identical to live/mart.mart_retention_cohorts.sql)
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_retention_cohorts` AS
SELECT
  client_id,
  cohort_month,
  entry_class,
  is_early,
  LOGICAL_OR(classes_configured) AS classes_configured,
  SUM(n_customer) AS n_customer,
  SUM(m30) AS m30, SUM(m60) AS m60, SUM(m90) AS m90, SUM(m180) AS m180, SUM(m365) AS m365,
  SUM(r30) AS r30, SUM(r60) AS r60, SUM(r90) AS r90, SUM(r180) AS r180, SUM(r365) AS r365,
  SUM(u30) AS u30, SUM(u60) AS u60, SUM(u90) AS u90, SUM(u180) AS u180, SUM(u365) AS u365,
  SUM(m23_180) AS m23_180,
  SUM(r23_180) AS r23_180,
  ANY_VALUE(cutoff_date) AS cutoff_date,
  ANY_VALUE(data_start_date) AS data_start_date,
  ANY_VALUE(history_guard_days) AS history_guard_days,
  COUNTIF(has_unmatched_line) AS n_unmatched,
  MAX(refreshed_at) AS refreshed_at
FROM `oneeighty-warehouse.mart.rpt_customer_entry`
GROUP BY client_id, cohort_month, entry_class, is_early;

-- 4. Unclassified product monitor (identical to live/ops.v_unclassified_products.sql).
--    status 'no rule': at least one line matched no rule at all. status 'default': every
--    line matched only the default rule and the code was first seen after that rule was
--    last updated (a new product nobody reviewed). Same line code and matching as the
--    procedure.
CREATE OR REPLACE VIEW `oneeighty-warehouse.ops.v_unclassified_products` AS
WITH lines AS (
  SELECT client_id, order_date,
    NULLIF(TRIM(item_code), '') AS code,
    REGEXP_EXTRACT(NULLIF(TRIM(item_code), ''), r'^[^/]+') AS code_base,
    item_name AS name, revenue_czk AS revenue, 'CZK' AS currency
  FROM `oneeighty-warehouse.stg.stg_shoptet_order_items`
  UNION ALL
  SELECT client_id, order_date, NULLIF(TRIM(sku), ''), NULLIF(TRIM(sku), ''),
    item_name, revenue, currency
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
  UNION ALL
  SELECT client_id, order_date,
    COALESCE(NULLIF(TRIM(sku), ''), NULLIF(NULLIF(variation_id, ''), '0'), NULLIF(product_id, '')),
    COALESCE(NULLIF(TRIM(sku), ''), NULLIF(product_id, '')),
    item_name, revenue, currency
  FROM `oneeighty-warehouse.stg.stg_woo_order_items`
),
grouped AS (
  SELECT client_id, order_date, code, code_base, name, currency,
    COUNT(*) AS n_lines, SUM(revenue) AS revenue
  FROM lines
  WHERE client_id IN (SELECT client_id FROM `oneeighty-warehouse.ref.product_classes`)
  GROUP BY client_id, order_date, code, code_base, name, currency
),
matched AS (
  SELECT g.client_id, g.order_date, g.code, g.code_base, g.name, g.currency, g.n_lines, g.revenue,
    ARRAY_AGG(IF(r.client_id IS NULL, NULL, STRUCT(r.match_type, r.updated_at))
              IGNORE NULLS ORDER BY r.priority LIMIT 1)[SAFE_OFFSET(0)] AS rule
  FROM grouped g
  LEFT JOIN `oneeighty-warehouse.ref.product_classes` r
    ON r.client_id = g.client_id
   AND (r.valid_from IS NULL OR g.order_date >= r.valid_from)
   AND (r.valid_to IS NULL OR g.order_date < r.valid_to)
   AND CASE r.match_type
         WHEN 'code'        THEN g.code = r.pattern
         WHEN 'code_base'   THEN g.code_base = r.pattern
         WHEN 'code_prefix' THEN STARTS_WITH(g.code, r.pattern)
         WHEN 'name_prefix' THEN STARTS_WITH(g.name, r.pattern)
         WHEN 'name_regex'  THEN REGEXP_CONTAINS(g.name, r.pattern)
         WHEN 'default'     THEN TRUE
       END
  GROUP BY g.client_id, g.order_date, g.code, g.code_base, g.name, g.currency, g.n_lines, g.revenue
),
per_code AS (
  SELECT client_id, code,
    ANY_VALUE(code_base) AS code_base,
    ARRAY_AGG(name ORDER BY order_date DESC LIMIT 1)[OFFSET(0)] AS latest_name,
    MIN(order_date) AS first_seen,
    MAX(order_date) AS last_seen,
    SUM(n_lines) AS n_lines,
    SUM(revenue) AS revenue,
    ANY_VALUE(currency) AS currency,
    LOGICAL_OR(rule IS NULL) AS any_no_rule,
    LOGICAL_AND(rule.match_type = 'default') AS default_only,
    MAX(rule.updated_at) AS default_rule_updated_at
  FROM matched
  GROUP BY client_id, code
)
SELECT
  client_id, code, code_base, latest_name,
  IF(any_no_rule, 'no rule', 'default') AS status,
  first_seen, last_seen, n_lines, revenue, currency
FROM per_code
WHERE any_no_rule
   OR (default_only AND first_seen > DATE(default_rule_updated_at));

-- -----------------------------------------------------------------------------
-- Scheduler (owner): BigQuery console, Scheduled queries, "Create scheduled query",
-- name rpt_refresh_hourly, location EU, schedule "every 1 hours", no destination table,
-- query text (the customer entry CALL goes last, so a failure in it cannot block the
-- other two refreshes):
--   CALL `oneeighty-warehouse.mart.sp_refresh_rpt_kpis`();
--   CALL `oneeighty-warehouse.mart.sp_refresh_rpt_ad_launch`();
--   CALL `oneeighty-warehouse.mart.sp_refresh_rpt_customer_entry`();
-- -----------------------------------------------------------------------------
