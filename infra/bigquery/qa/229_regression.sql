-- =============================================================================
-- qa/229_regression.sql: regression and reconciliation for 229_customer_marts_woo
-- =============================================================================
-- Read-only checks, except section 0 which (re)creates the mart_qa candidates.
-- Run them in order. Results of the 2026-10-04 run are in the RESULTS block at
-- the end. Unaffected clients: manami, dobias, venev. Affected: ethia, rawbark.
--
-- Candidate naming
--   mart_qa.wp4_<view>     229 on top of the CURRENT prod stg_woo_* views
--   mart_qa.wp4_w3_<view>  229 on top of the WP3 candidates mart_qa.wp3_stg_woo_*
--                          (proves the 228 + 229 combination)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Build the candidates from the migration file (shell, not SQL)
-- -----------------------------------------------------------------------------
-- wp4_ set: rewrite the 9 object names, keep everything else byte for byte.
--   sed -E \
--     -e 's/oneeighty-warehouse\.stg\.stg_customer_order(s|_items)/oneeighty-warehouse.mart_qa.wp4_stg_customer_order\1/g' \
--     -e 's/oneeighty-warehouse\.mart\.(mart_customer_lifetime|mart_customer_cohort_grid|mart_customer_payback|mart_customer_product_steps|mart_customer_daily|mart_customer_market_daily|mart_order_gaps)`/oneeighty-warehouse.mart_qa.wp4_\1`/g' \
--     infra/bigquery/229_customer_marts_woo.sql
-- wp4_w3_ set: same with prefix wp4_w3_, plus
--     -e 's/oneeighty-warehouse\.stg\.stg_woo_order(s|_items)/oneeighty-warehouse.mart_qa.wp3_stg_woo_order\1/g'
-- Unchanged dependants need a copy that reads the candidates:
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart_qa.wp4_mart_customer_cohorts` AS
SELECT
  client_id,
  DATE_TRUNC(first_order_date, MONTH) AS cohort_month,
  currency,
  COUNT(*)                              AS customer_count,
  COUNTIF(is_y1_complete)               AS y1_complete_customers,
  SUM(lifetime_revenue)                 AS cohort_total_revenue,
  SUM(lifetime_gross_profit)            AS cohort_total_gross_profit,
  SUM(total_orders)                     AS cohort_total_orders,
  ROUND(AVG(lifetime_revenue), 2)       AS ltv,
  ROUND(AVG(lifetime_gross_profit), 2)  AS ltgp,
  ROUND(AVG(total_orders), 2)           AS avg_orders_per_customer,
  ROUND(AVG(IF(is_y1_complete, y1_revenue, NULL)), 2)        AS y1_ltv,
  ROUND(AVG(IF(is_y1_complete, y1_gross_profit, NULL)), 2)   AS y1_ltgp,
  ROUND(AVG(IF(is_y1_complete, y1_orders, NULL)), 2)         AS y1_orders_per_customer,
  COUNTIF(is_returning)                                      AS returning_customers,
  SAFE_DIVIDE(COUNTIF(is_returning), COUNT(*)) * 100         AS cohort_repeat_rate_pct
FROM `oneeighty-warehouse.mart_qa.wp4_mart_customer_lifetime`
GROUP BY client_id, cohort_month, currency;

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart_qa.wp4_mart_first_product_repeat` AS
WITH first_orders AS (
  SELECT client_id, customer_key, product AS first_product, lifetime_orders, first_order_date
  FROM `oneeighty-warehouse.mart_qa.wp4_mart_customer_product_steps`
  WHERE step = 1
)
SELECT client_id, first_product,
       COUNT(*) AS customers,
       COUNTIF(lifetime_orders >= 2) AS repeaters,
       AVG(lifetime_orders) AS avg_lifetime_orders,
       MIN(first_order_date) AS earliest_first_order,
       MAX(first_order_date) AS latest_first_order
FROM first_orders
WHERE first_order_date < DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
GROUP BY 1,2;

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart_qa.wp4_mart_product_journey` AS
WITH stepped AS (
  SELECT client_id, customer_key, step, product,
         LEAD(product) OVER (PARTITION BY client_id, customer_key ORDER BY step) AS next_product
  FROM `oneeighty-warehouse.mart_qa.wp4_mart_customer_product_steps`
)
SELECT client_id, step AS from_step, product AS from_product,
       next_product AS to_product, COUNT(*) AS customers
FROM stepped
WHERE next_product IS NOT NULL
GROUP BY 1,2,3,4;

-- 0b. The deployed candidates equal the migration file (whitespace and
--     comments stripped). Compare with md5 of the same normalisation of the
--     sed output, computed locally.
SELECT table_name,
       TO_HEX(MD5(REGEXP_REPLACE(REGEXP_REPLACE(view_definition, r'--[^\n]*', ''), r'\s+', ''))) AS h
FROM `oneeighty-warehouse`.mart_qa.INFORMATION_SCHEMA.VIEWS
WHERE table_name LIKE 'wp4\\_%' AND table_name NOT LIKE 'wp4\\_w3%'
ORDER BY 1;


-- -----------------------------------------------------------------------------
-- 1. Zero diff for unaffected clients (TO_JSON_STRING, both directions)
-- -----------------------------------------------------------------------------
-- Template, run once per view V (date column D where the view has one:
-- payback.cohort_date, product_steps.order_date, daily.date,
-- market_daily.date, order_gaps.gap_end_date):
WITH p AS (SELECT TO_JSON_STRING(t) j, COUNT(*) n FROM `oneeighty-warehouse.mart.mart_customer_lifetime` t
           WHERE client_id NOT IN ('ethia','rawbark') GROUP BY 1),
     c AS (SELECT TO_JSON_STRING(t) j, COUNT(*) n FROM `oneeighty-warehouse.mart_qa.wp4_mart_customer_lifetime` t
           WHERE client_id NOT IN ('ethia','rawbark') GROUP BY 1)
SELECT (SELECT SUM(n) FROM p) AS prod_rows, (SELECT SUM(n) FROM c) AS cand_rows,
       (SELECT COUNT(*) FROM (SELECT * FROM p EXCEPT DISTINCT SELECT * FROM c)) AS prod_minus_cand,
       (SELECT COUNT(*) FROM (SELECT * FROM c EXCEPT DISTINCT SELECT * FROM p)) AS cand_minus_prod;
-- (grouping by the JSON string with COUNT(*) makes it a multiset compare, so
--  duplicate rows, e.g. equal gaps in mart_order_gaps, are checked too)

-- 1b. mart_customer_cohorts: all non-float columns exact, plus the size of the
--     float noise in the two AVG(INT64) columns.
WITH p AS (SELECT TO_JSON_STRING((SELECT AS STRUCT t.* EXCEPT (avg_orders_per_customer, y1_orders_per_customer))) j,
                  client_id, cohort_month, avg_orders_per_customer a1, y1_orders_per_customer a2
           FROM `oneeighty-warehouse.mart.mart_customer_cohorts` t WHERE client_id NOT IN ('ethia','rawbark')),
     c AS (SELECT TO_JSON_STRING((SELECT AS STRUCT t.* EXCEPT (avg_orders_per_customer, y1_orders_per_customer))) j,
                  client_id, cohort_month, avg_orders_per_customer a1, y1_orders_per_customer a2
           FROM `oneeighty-warehouse.mart_qa.wp4_mart_customer_cohorts` t WHERE client_id NOT IN ('ethia','rawbark'))
SELECT (SELECT COUNT(*) FROM (SELECT j FROM p EXCEPT DISTINCT SELECT j FROM c)) p_c,
       (SELECT COUNT(*) FROM (SELECT j FROM c EXCEPT DISTINCT SELECT j FROM p)) c_p,
       (SELECT MAX(GREATEST(ABS(p.a1 - c.a1), IFNULL(ABS(p.a2 - c.a2), 0))) FROM p JOIN c USING (client_id, cohort_month)) max_float_delta;

-- 1c. Product steps: materialise prod and candidate separately, then compare.
--     (Comparing the two views inside one big query can show diffs that come
--     from the upstream ANY_VALUE(title) in stg_shopify_order_items, see 1d.)
CREATE OR REPLACE TABLE `oneeighty-warehouse.mart_qa.wp4_snap_prod_product_steps`
OPTIONS (expiration_timestamp = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)) AS
SELECT * FROM `oneeighty-warehouse.mart.mart_customer_product_steps` WHERE client_id NOT IN ('ethia','rawbark');
CREATE OR REPLACE TABLE `oneeighty-warehouse.mart_qa.wp4_snap_cand_product_steps`
OPTIONS (expiration_timestamp = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)) AS
SELECT * FROM `oneeighty-warehouse.mart_qa.wp4_mart_customer_product_steps` WHERE client_id NOT IN ('ethia','rawbark');
WITH p AS (SELECT TO_JSON_STRING(t) j FROM `oneeighty-warehouse.mart_qa.wp4_snap_prod_product_steps` t WHERE order_date < CURRENT_DATE()),
     c AS (SELECT TO_JSON_STRING(t) j FROM `oneeighty-warehouse.mart_qa.wp4_snap_cand_product_steps` t WHERE order_date < CURRENT_DATE())
SELECT (SELECT COUNT(*) FROM (SELECT j FROM p EXCEPT DISTINCT SELECT j FROM c)) p_c,
       (SELECT COUNT(*) FROM (SELECT j FROM c EXCEPT DISTINCT SELECT j FROM p)) c_p;

-- 1d. Upstream nondeterminism (not caused by 229): dobias normalised SKUs that
--     map to more than one product title. ANY_VALUE(title) picks one per run;
--     when an order's lines all have NULL revenue the anchor falls back to the
--     alphabetically first item_name, so the "product" of the order flips.
SELECT client_id, COUNT(*) AS skus, COUNTIF(titles > 1) AS multi_title
FROM (
  SELECT client_id,
    CASE WHEN client_id = 'venev' THEN REGEXP_REPLACE(TRIM(UPPER(sku)), r'A$', '')
         ELSE TRIM(UPPER(REGEXP_REPLACE(sku, r'^DD-', ''))) END AS norm_sku,
    COUNT(DISTINCT title) AS titles
  FROM `oneeighty-warehouse.stg.stg_shopify_products`
  WHERE sku IS NOT NULL AND sku != ''
  GROUP BY 1, 2)
GROUP BY 1;


-- -----------------------------------------------------------------------------
-- 2. Woo reconciliation (W3), both candidate sets
-- -----------------------------------------------------------------------------
WITH
s0 AS (SELECT 'wp4' v, * FROM `oneeighty-warehouse.stg.stg_woo_orders`
       UNION ALL SELECT 'wp4_w3', * EXCEPT (fee_discounts, other_charges) FROM `oneeighty-warehouse.mart_qa.wp3_stg_woo_orders`),
s AS (SELECT v, client_id,
        COUNTIF(NULLIF(TRIM(customer_email), '') IS NOT NULL) AS orders_email,
        COUNT(DISTINCT LOWER(TRIM(customer_email)))           AS customers,
        MIN(order_date)                                       AS first_order,
        SUM(IF(NULLIF(TRIM(customer_email), '') IS NOT NULL, net_revenue, NULL)) AS rev_email,
        SAFE_DIVIDE(COUNTIF(order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY) AND order_date < CURRENT_DATE() AND is_returning_customer),
                    COUNTIF(order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY) AND order_date < CURRENT_DATE())) AS ret90
      FROM s0 WHERE client_id IN ('ethia','rawbark') GROUP BY 1, 2),
l AS (SELECT 'wp4' v, * FROM `oneeighty-warehouse.mart_qa.wp4_mart_customer_lifetime`
      UNION ALL SELECT 'wp4_w3', * FROM `oneeighty-warehouse.mart_qa.wp4_w3_mart_customer_lifetime`),
la AS (SELECT v, client_id, SUM(total_orders) orders, COUNT(*) customers, MIN(first_order_date) first_order,
         SUM(lifetime_revenue) rev, AVG(lifetime_revenue) ltv, AVG(total_orders) opc,
         SAFE_DIVIDE(SUM(lifetime_revenue), SUM(total_orders)) aov,
         COUNTIF(lifetime_gross_profit IS NOT NULL) cust_with_gp, AVG(lifetime_gross_profit) ltgp,
         SAFE_DIVIDE(COUNTIF(is_returning), COUNT(*)) repeat_rate
       FROM l WHERE client_id IN ('ethia','rawbark') GROUP BY 1, 2),
g AS (SELECT 'wp4' v, * FROM `oneeighty-warehouse.mart_qa.wp4_mart_customer_cohort_grid`
      UNION ALL SELECT 'wp4_w3', * FROM `oneeighty-warehouse.mart_qa.wp4_w3_mart_customer_cohort_grid`),
ga AS (SELECT v, client_id,
         COUNTIF(month_offset = 0 AND active_customers != cohort_customers) m0_mismatch,
         SUM(IF(month_offset = 0, cohort_customers, 0)) grid_customers, SUM(orders) grid_orders, SUM(revenue) grid_rev
       FROM g WHERE client_id IN ('ethia','rawbark') GROUP BY 1, 2),
p AS (SELECT 'wp4' v, * FROM `oneeighty-warehouse.mart_qa.wp4_mart_customer_payback`
      UNION ALL SELECT 'wp4_w3', * FROM `oneeighty-warehouse.mart_qa.wp4_w3_mart_customer_payback`),
pa AS (SELECT v, client_id, SUM(customers_90d_complete) c90,
         SAFE_DIVIDE(SUM(gross_profit_30d_of_90d_cohort), SUM(customers_90d_complete)) gp30,
         SAFE_DIVIDE(SUM(gross_profit_90d), SUM(customers_90d_complete)) gp90
       FROM p WHERE client_id IN ('ethia','rawbark') AND cohort_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH) GROUP BY 1, 2),
d AS (SELECT 'wp4' v, * FROM `oneeighty-warehouse.mart_qa.wp4_mart_customer_daily`
      UNION ALL SELECT 'wp4_w3', * FROM `oneeighty-warehouse.mart_qa.wp4_w3_mart_customer_daily`),
da AS (SELECT v, client_id, SAFE_DIVIDE(SUM(returning_customer_orders), SUM(orders)) ret90
       FROM d WHERE client_id IN ('ethia','rawbark') AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY) AND date < CURRENT_DATE()
       GROUP BY 1, 2)
SELECT s.v, s.client_id,
  s.orders_email, la.orders AS lt_orders, ga.grid_orders,
  s.customers, la.customers AS lt_cust, ga.grid_customers,
  s.first_order, la.first_order AS lt_first, ga.m0_mismatch,
  ROUND(s.rev_email, 0) stg_rev, ROUND(la.rev, 0) lt_rev, ROUND(ga.grid_rev, 0) grid_rev,
  ROUND(s.ret90, 4) stg_ret90, ROUND(da.ret90, 4) mart_ret90,
  ROUND(la.ltv, 0) ltv, ROUND(la.opc, 3) opc, ROUND(la.aov, 0) aov, la.cust_with_gp, ROUND(la.ltgp, 0) ltgp,
  ROUND(la.repeat_rate, 4) repeat_rate, pa.c90, ROUND(pa.gp30, 0) gp30_12m, ROUND(pa.gp90, 0) gp90_12m
FROM s JOIN la USING (v, client_id) JOIN ga USING (v, client_id) JOIN pa USING (v, client_id) JOIN da USING (v, client_id)
ORDER BY 1, 2;

-- 2b. Customers matches Snapshot: mart_customer_daily vs mart_daily_kpis per
--     day (prod pair, and the 228 pair wp4_w3 vs wp3_mart_daily_kpis).
WITH a AS (
  SELECT 'wp4' v, d.client_id, d.date, d.orders, d.revenue, d.net_sales, d.new_customer_orders, d.returning_customer_orders,
         k.orders k_orders, k.revenue k_rev, k.net_sales k_ns, k.new_customer_orders k_new, k.returning_customer_orders k_ret
  FROM `oneeighty-warehouse.mart_qa.wp4_mart_customer_daily` d
  FULL JOIN (SELECT * FROM `oneeighty-warehouse.mart.mart_daily_kpis` WHERE client_id IN ('ethia','rawbark') AND orders IS NOT NULL) k
    USING (client_id, date)
  WHERE client_id IN ('ethia','rawbark') AND date < CURRENT_DATE()
  UNION ALL
  SELECT 'wp4_w3', d.client_id, d.date, d.orders, d.revenue, d.net_sales, d.new_customer_orders, d.returning_customer_orders,
         k.orders, k.revenue, k.net_sales, k.new_customer_orders, k.returning_customer_orders
  FROM `oneeighty-warehouse.mart_qa.wp4_w3_mart_customer_daily` d
  FULL JOIN (SELECT * FROM `oneeighty-warehouse.mart_qa.wp3_mart_daily_kpis` WHERE client_id IN ('ethia','rawbark') AND orders IS NOT NULL) k
    USING (client_id, date)
  WHERE client_id IN ('ethia','rawbark') AND date < CURRENT_DATE())
SELECT v, client_id, COUNT(*) days,
  COUNTIF(orders IS DISTINCT FROM k_orders) d_orders,
  COUNTIF(revenue IS DISTINCT FROM k_rev) d_rev,
  COUNTIF(net_sales IS DISTINCT FROM k_ns) d_net_sales,
  COUNTIF(new_customer_orders IS DISTINCT FROM k_new OR returning_customer_orders IS DISTINCT FROM k_ret) d_new_ret
FROM a GROUP BY 1, 2 ORDER BY 1, 2;


-- -----------------------------------------------------------------------------
-- 3. Determinism (run 5 times; RAND() >= 0 keeps the result out of the cache)
-- -----------------------------------------------------------------------------
-- Template, one line per candidate view V:
SELECT 'mart_customer_lifetime' v,
       FARM_FINGERPRINT(STRING_AGG(TO_JSON_STRING(t), '\n' ORDER BY TO_JSON_STRING(t))) fp, COUNT(*) n
FROM `oneeighty-warehouse.mart_qa.wp4_mart_customer_lifetime` t
WHERE client_id IN ('ethia','rawbark') AND RAND() >= 0;
-- mart_first_product_repeat carries AVG(INT64) as FLOAT64 (unchanged live
-- definition); fingerprint it with ROUND(avg_lifetime_orders, 9).


-- =============================================================================
-- RESULTS (2026-10-04)
-- =============================================================================
-- 0b  all 9 changed candidates hash-equal to the migration file.
-- 1   unaffected clients (manami, dobias, venev), prod rows = cand rows, 0/0:
--       mart_customer_lifetime       20,188   0 / 0
--       mart_customer_cohort_grid     3,472   0 / 0
--       mart_customer_payback         3,018   0 / 0 (multiset)
--       mart_customer_daily           2,468   0 / 0
--       mart_customer_market_daily    4,210   0 / 0
--       mart_order_gaps              21,368   0 / 0 (multiset)
-- 1b  mart_customer_cohorts (139 rows): 0 / 0 on every non-float column. The
--     two ROUND(AVG(INT64), 2) columns differ by 0.01 on 1 to 2 rows per run,
--     always at exact half values (dobias 2026-05 354/240 = 1.475, venev
--     2022-09 324/288 = 1.125). Prod itself returned 1.12 in one query and
--     1.13 in the next for the same row: FLOAT64 summation order, same class
--     as the RB17 google_spend exception. View definition is unchanged.
-- 1c  product_steps snapshots (87,460 rows): 0 / 0.
--     Direct view-vs-view compares in large multi-CTE queries showed
--     1,255 to 1,434 dobias rows. All 1,299 diff orders in one captured run
--     contain a line whose normalised SKU maps to several titles (1d: dobias
--     4 of 141 SKUs). The prod view also differed from its own snapshot (12
--     rows) in the same query shape, and prod mart_first_product_repeat
--     differed from itself by 80 rows (FLOAT AVG) between two runs. Not
--     caused by 229.
-- 2   (wp4 = current stg; wp4_w3 = on WP3 candidates)
--       client   ver     orders  cust   first       m0  stg_rev=lt_rev=grid_rev  ret90 stg=mart  LTV   opc    AOV   LTGP  gp30/gp90 (12m)
--       ethia    wp4     1,805   1,256  2025-03-02  0   1,881,068 (all three)    0.5018=0.5018   1,498 1.437  1,042 1,042 768 / 882
--       rawbark  wp4     50,008  14,485 2022-10-01  0   89,245,759 (all three)   0.8699=0.8699   6,162 3.452  1,785 NULL  NULL / NULL
--       ethia    wp4_w3  1,805   1,256  2025-03-02  0   1,871,143 (all three)    0.5018=0.5018   1,490 1.437  1,037 1,034 766 / 878
--       rawbark  wp4_w3  50,008  14,485 2022-10-01  0   87,032,746 (all three)   0.8699=0.8699   6,009 3.452  1,740 NULL  NULL / NULL
--     LTV = opc x AOV to the unit for both clients. Ethia LTGP is about 70% of
--     LTV (ex-shipping margin with a 24.6% COGS ratio); 30-day gross profit
--     per new customer (768) is below one AOV (1,042), so no per-day
--     inflation (2026-07-31 bug class).
-- 2b  Customers vs Snapshot, every day, both pairs: 0 diffs in orders,
--     revenue, net_sales, new/returning orders (ethia 461 days, rawbark 1,463).
-- 3   5 runs: identical fingerprints for all 12 candidate views (first product
--     repeat with avg rounded to 9 dp).
-- =============================================================================
