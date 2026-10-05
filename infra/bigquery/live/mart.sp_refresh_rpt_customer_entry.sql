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
