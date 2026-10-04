-- =============================================================================
-- qa/228_regression.sql
-- Regression for 228_woo_fee_lines_cogs_null.sql (WP3), protocol 5.R.
-- Run 2026-10-04 against candidates in mart_qa (prefix wp3_). Results are
-- recorded under each check. Every query is read-only except section C.
--
-- Candidates (mart_qa):
--   wp3_product_costs            TABLE  copy of ref.product_costs + product_id, variation_id (STRING, NULL)
--   wp3_stg_woo_orders           VIEW   228 step 2, refs mapped to mart_qa
--   wp3_stg_woo_order_items      VIEW   228 step 3, refs mapped to mart_qa
--   wp3_mart_daily_kpis          VIEW   228 step 4 (built from live text, see C2)
--   wp3_mart_cm3_monthly         VIEW   228 step 5 (built from live text, see C2)
--   wp3_mart_orders, wp3_mart_product_perf, wp3_mart_sku_perf,
--   wp3_mart_unit_economics, wp3_mart_monthly_kpis,
--   wp3_mart_profit_share_monthly VIEWS live text unchanged, refs mapped to wp3_*
--
-- After the prod deploy: replace `mart_qa.wp3_<view>` with `mart.<view>` /
-- `stg.<view>` and `mart.<view>` / `stg.<view>` with the pre-deploy snapshot
-- `mart_qa.base_<view>_20261005`, then re-run R1 to R6.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- C. Build candidates (writes to mart_qa only)
-- -----------------------------------------------------------------------------

-- C1. Cost table copy with the two new columns (mirrors 228 step 1).
CREATE OR REPLACE TABLE `oneeighty-warehouse.mart_qa.wp3_product_costs` AS
SELECT *, CAST(NULL AS STRING) AS product_id, CAST(NULL AS STRING) AS variation_id
FROM `oneeighty-warehouse.ref.product_costs`;

-- C1b. wp3_stg_woo_orders and wp3_stg_woo_order_items: the 228 step 2 and 3
-- statements with these reference swaps (nothing else changes):
--   stg.stg_woo_orders      -> mart_qa.wp3_stg_woo_orders
--   stg.stg_woo_order_items -> mart_qa.wp3_stg_woo_order_items
--   ref.product_costs       -> mart_qa.wp3_product_costs

-- C2. Marts built straight from the live text, so every byte outside the two
-- intended edits is the live definition. Run as one script.
DECLARE defs ARRAY<STRUCT<table_name STRING, view_definition STRING>> DEFAULT (
  SELECT ARRAY_AGG(STRUCT(table_name, view_definition))
  FROM `oneeighty-warehouse.mart`.INFORMATION_SCHEMA.VIEWS
  WHERE table_name IN ('mart_daily_kpis','mart_cm3_monthly','mart_orders','mart_product_perf',
                       'mart_sku_perf','mart_unit_economics','mart_monthly_kpis','mart_profit_share_monthly'));
FOR v IN (SELECT * FROM UNNEST(defs)) DO
  EXECUTE IMMEDIATE FORMAT("CREATE OR REPLACE VIEW `oneeighty-warehouse.mart_qa.wp3_%s` AS %s", v.table_name,
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(v.view_definition,
      'COALESCE(c.cogs, 0) AS cogs,\n    o.fulfillment_cost,', 'c.cogs              AS cogs,\n    o.fulfillment_cost,'),
      'revenue_net - COALESCE(cogs, 0)\n', 'revenue_net - cogs\n'),
      '`oneeighty-warehouse.stg.stg_woo_orders`', '`oneeighty-warehouse.mart_qa.wp3_stg_woo_orders`'),
      '`oneeighty-warehouse.stg.stg_woo_order_items`', '`oneeighty-warehouse.mart_qa.wp3_stg_woo_order_items`'),
      '`oneeighty-warehouse.mart.mart_daily_kpis`', '`oneeighty-warehouse.mart_qa.wp3_mart_daily_kpis`'),
      '`oneeighty-warehouse.mart.mart_cm3_monthly`', '`oneeighty-warehouse.mart_qa.wp3_mart_cm3_monthly`'));
END FOR;


-- -----------------------------------------------------------------------------
-- R0. The migration file text equals the live text plus exactly the intended
-- edit. MD5 of each 228 view body (text between "AS\n" and ";") was computed
-- locally and compared with the live definition after the single REPLACE.
-- Result 2026-10-04 (each REPLACE matched exactly once):
--   mart_daily_kpis   live 834aa24b921e3c5f0afb394e3a9e0e05,
--                     live+edit 563f7c75de0a3ccd77a1bca45a52a4f5 = 228 body
--   mart_cm3_monthly  live fab1d8545e6d8eeda6193b3ab4090786,
--                     live+edit 36016a2c9668c0cb4096f3a6265e8cb7 = 228 body
--   Candidate views mapped back to prod refs: md5 equal to the 228 bodies
--   (stg_woo_orders 0d95257c..., stg_woo_order_items da087f77...), and the six
--   unchanged dependants equal their live text.
-- So the Shopify and Shoptet branches of mart_daily_kpis are byte for byte live.
-- -----------------------------------------------------------------------------
SELECT table_name,
  TO_HEX(MD5(view_definition)) AS live_md5,
  CASE table_name
    WHEN 'mart_daily_kpis'  THEN TO_HEX(MD5(REPLACE(view_definition,
      'COALESCE(c.cogs, 0) AS cogs,\n    o.fulfillment_cost,', 'c.cogs              AS cogs,\n    o.fulfillment_cost,')))
    WHEN 'mart_cm3_monthly' THEN TO_HEX(MD5(REPLACE(view_definition,
      'revenue_net - COALESCE(cogs, 0)\n', 'revenue_net - cogs\n')))
  END AS live_plus_edit_md5
FROM `oneeighty-warehouse.mart`.INFORMATION_SCHEMA.VIEWS
WHERE table_name IN ('mart_daily_kpis', 'mart_cm3_monthly');


-- -----------------------------------------------------------------------------
-- R1. Zero diff for unaffected clients, all columns, both directions.
-- Result 2026-10-04 (diff rows by client):
--   mart_daily_kpis       manami 0, dobias 0, venev 0 | ethia 103, rawbark 1463 (R2)
--   mart_orders           manami 0, dobias 0, venev 0 | ethia 134, rawbark 10938 (R3)
--   mart_product_perf     manami 0, dobias 0, venev 0 | ethia 445, rawbark 7455 (R4)
--   mart_sku_perf         manami 0, dobias 0, venev 0 | ethia 445, rawbark 10960 (R4)
--   mart_unit_economics   manami 0, dobias 0, venev 0 | ethia 119, rawbark 1247 (R4)
--   mart_monthly_kpis     dobias 0, venev 0, manami 10/9 (R1b: FLOAT64 noise only)
--                         | ethia 15, rawbark 48 (follow daily)
--   mart_cm3_monthly, mart_profit_share_monthly: 0 rows on both sides
--   (ref.contracts is empty), 0 diff.
-- -----------------------------------------------------------------------------
WITH p AS (SELECT client_id, TO_JSON_STRING(t) j FROM `oneeighty-warehouse.mart.mart_daily_kpis` t WHERE date < CURRENT_DATE()),
     q AS (SELECT client_id, TO_JSON_STRING(t) j FROM `oneeighty-warehouse.mart_qa.wp3_mart_daily_kpis` t WHERE date < CURRENT_DATE())
SELECT 'prod_not_in_cand' dir, client_id, COUNT(*) n FROM (SELECT * FROM p EXCEPT DISTINCT SELECT * FROM q) GROUP BY client_id
UNION ALL
SELECT 'cand_not_in_prod', client_id, COUNT(*) FROM (SELECT * FROM q EXCEPT DISTINCT SELECT * FROM p) GROUP BY client_id;
-- Same pattern for mart_orders, mart_product_perf, mart_sku_perf,
-- mart_unit_economics (date < CURRENT_DATE()), mart_monthly_kpis
-- (month_start < DATE_TRUNC(CURRENT_DATE(), MONTH)), mart_cm3_monthly and
-- mart_profit_share_monthly (no filter).

-- R1b. manami monthly diff is the RB17 exception: only FLOAT64 google_spend,
-- google_revenue, google_purchases differ, at the 1e-11 level, and which months
-- differ changes between runs (summation order). manami daily is 0 diff.
-- Result: the only differing keys were google_purchases, google_revenue,
-- google_spend (2026-06: 19901.465509999995 vs 19901.465509999998).
WITH p AS (SELECT * FROM `oneeighty-warehouse.mart.mart_monthly_kpis`
           WHERE client_id IN ('manami','dobias','venev') AND month_start < DATE_TRUNC(CURRENT_DATE(), MONTH)),
     q AS (SELECT * FROM `oneeighty-warehouse.mart_qa.wp3_mart_monthly_kpis`
           WHERE client_id IN ('manami','dobias','venev') AND month_start < DATE_TRUNC(CURRENT_DATE(), MONTH))
SELECT p.client_id, COUNT(*) n,
  COUNTIF(TO_JSON_STRING((SELECT AS STRUCT p.* EXCEPT(google_spend, google_revenue, google_purchases)))
       != TO_JSON_STRING((SELECT AS STRUCT q.* EXCEPT(google_spend, google_revenue, google_purchases)))) AS diff_excl_float_cols
FROM p JOIN q USING (client_id, month_start, currency)
GROUP BY 1;
-- Expected: diff_excl_float_cols = 0 for all three.


-- -----------------------------------------------------------------------------
-- R2. Affected clients, mart_daily_kpis: per-day revenue and net_sales delta
-- equals the per-day fee-line discount sum EXACTLY (no tolerance); new and
-- returning splits likewise; cogs 0 -> NULL for rawbark only; every other
-- column equal.
-- Result 2026-10-04:
--   rawbark: 1463 days, 0 days with revenue delta != fee, 0 net_sales, 0 splits;
--            sum delta = sum fee = -2,210,991.23265 CZK (60-month window);
--            cogs 0 -> NULL on all 1463 days, cm1/cm2/cm3 NULL; other cols equal.
--   ethia:   516 days (103 with fees), 0 mismatches; sum delta = sum fee = -9,857 CZK;
--            cogs unchanged on every day; cm1 delta = fee; other cols equal.
-- -----------------------------------------------------------------------------
WITH fee AS (
  SELECT client_id, order_date AS date, currency, SUM(fee_discounts) fee,
    SUM(IF(is_returning_customer IS FALSE, fee_discounts, 0)) fee_new,
    SUM(IF(is_returning_customer IS TRUE,  fee_discounts, 0)) fee_ret
  FROM `oneeighty-warehouse.mart_qa.wp3_stg_woo_orders` GROUP BY 1, 2, 3),
p AS (SELECT * FROM `oneeighty-warehouse.mart.mart_daily_kpis` WHERE date < CURRENT_DATE() AND client_id IN ('ethia','rawbark')),
q AS (SELECT * FROM `oneeighty-warehouse.mart_qa.wp3_mart_daily_kpis` WHERE date < CURRENT_DATE() AND client_id IN ('ethia','rawbark')),
j AS (
  SELECT p.client_id, f.fee, f.fee_new, f.fee_ret,
    p.revenue pr, q.revenue qr, p.net_sales pn, q.net_sales qn, p.cogs pc, q.cogs qc, p.cm1 p1, q.cm1 q1, q.cm3 q3,
    p.new_customer_revenue - q.new_customer_revenue d_newrev, p.returning_customer_revenue - q.returning_customer_revenue d_retrev,
    p.new_customer_net_sales - q.new_customer_net_sales d_newns, p.returning_customer_net_sales - q.returning_customer_net_sales d_retns,
    TO_JSON_STRING((SELECT AS STRUCT p.* EXCEPT(revenue, new_customer_revenue, returning_customer_revenue, net_sales,
                    new_customer_net_sales, returning_customer_net_sales, cogs, cm1, cm2, cm3)))
  = TO_JSON_STRING((SELECT AS STRUCT q.* EXCEPT(revenue, new_customer_revenue, returning_customer_revenue, net_sales,
                    new_customer_net_sales, returning_customer_net_sales, cogs, cm1, cm2, cm3))) other_cols_equal
  FROM p FULL JOIN q USING (client_id, date, currency)
  LEFT JOIN fee f ON f.client_id = p.client_id AND f.date = p.date AND f.currency = p.currency)
SELECT client_id, COUNT(*) days, COUNTIF(fee != 0) days_with_fee,
  COUNTIF(COALESCE(qr - pr, 0) != COALESCE(fee, 0)) rev_delta_ne_fee,
  COUNTIF(COALESCE(qn - pn, 0) != COALESCE(fee, 0)) ns_delta_ne_fee,
  COUNTIF(COALESCE(-d_newrev, 0) != COALESCE(fee_new, 0) OR COALESCE(-d_retrev, 0) != COALESCE(fee_ret, 0)) split_rev_ne,
  COUNTIF(COALESCE(-d_newns, 0)  != COALESCE(fee_new, 0) OR COALESCE(-d_retns, 0)  != COALESCE(fee_ret, 0)) split_ns_ne,
  SUM(qr - pr) sum_rev_delta, SUM(fee) sum_fee,
  COUNTIF(pc IS DISTINCT FROM qc) cogs_changed_days, COUNTIF(pc = 0 AND qc IS NULL) cogs_0_to_null,
  COUNTIF(qc IS NOT NULL AND (q1 - p1) != COALESCE(fee, 0)) cm1_delta_ne_fee,
  COUNTIF(qc IS NULL AND pr IS NOT NULL AND q3 IS NOT NULL) cm3_not_null_when_cogs_null,
  COUNTIF(NOT other_cols_equal) other_cols_changed
FROM j GROUP BY 1;


-- -----------------------------------------------------------------------------
-- R3. Order level: mart_orders diff explained, and the order identity
--   net_revenue + other_charges + total_tax = total_price - total_refunded (1 CZK)
-- Result 2026-10-04:
--   mart_orders: changed orders = orders with a fee (ethia 134, rawbark 10938),
--     0 changed without a fee, 0 other columns changed; revenue, net_sales and
--     order_margin deltas = fee, total_discounts delta = -fee, on every order.
--   identity: ethia 0 of 1,805 orders off by more than 1 CZK (max 1.00);
--     rawbark 105 of 50,008 (max 1,875 CZK). All 105 have a Woo payload whose
--     own total differs from its line + shipping + fee + tax lines (R3b),
--     102 of them 2025-11-04..12, 2 in 2026-03, 1 in 2026-07; none has a refund.
-- -----------------------------------------------------------------------------
WITH s AS (SELECT * FROM `oneeighty-warehouse.mart_qa.wp3_stg_woo_orders`),
p AS (SELECT * FROM `oneeighty-warehouse.mart.mart_orders` WHERE platform = 'woocommerce' AND date < CURRENT_DATE()),
q AS (SELECT * FROM `oneeighty-warehouse.mart_qa.wp3_mart_orders` WHERE platform = 'woocommerce' AND date < CURRENT_DATE()),
j AS (
  SELECT p.client_id, s.fee_discounts fee,
    TO_JSON_STRING(p) != TO_JSON_STRING(q) changed,
    TO_JSON_STRING((SELECT AS STRUCT p.* EXCEPT(revenue, net_sales, total_discounts, order_margin)))
      = TO_JSON_STRING((SELECT AS STRUCT q.* EXCEPT(revenue, net_sales, total_discounts, order_margin))) rest_equal,
    q.revenue - p.revenue d_rev, q.net_sales - p.net_sales d_ns, q.total_discounts - p.total_discounts d_disc,
    q.order_margin - p.order_margin d_margin, p.order_margin IS NULL AND q.order_margin IS NULL margin_both_null
  FROM p JOIN q USING (client_id, order_id) JOIN s USING (client_id, order_id))
SELECT client_id, COUNT(*) orders, COUNTIF(changed) changed, COUNTIF(COALESCE(fee, 0) != 0) with_fee,
  COUNTIF(changed AND COALESCE(fee, 0) = 0) changed_without_fee, COUNTIF(NOT rest_equal) other_cols_changed,
  COUNTIF(COALESCE(d_rev, 0) != COALESCE(fee, 0)) rev_ne, COUNTIF(COALESCE(d_ns, 0) != COALESCE(fee, 0)) ns_ne,
  COUNTIF(COALESCE(d_disc, 0) != -COALESCE(fee, 0)) disc_ne,
  COUNTIF(NOT margin_both_null AND COALESCE(d_margin, 0) != COALESCE(fee, 0)) margin_ne
FROM j GROUP BY 1;

SELECT client_id, COUNT(*) orders,
  COUNTIF(ABS(net_revenue + other_charges + total_tax - (total_price - total_refunded)) > 1) identity_fail_gt1,
  MAX(ABS(net_revenue + other_charges + total_tax - (total_price - total_refunded))) identity_max_abs
FROM `oneeighty-warehouse.mart_qa.wp3_stg_woo_orders`
GROUP BY 1;

-- R3b. The identity failures are payload-internal (Woo total != its own lines).
WITH s AS (
  SELECT *, net_revenue + other_charges + total_tax - (total_price - total_refunded) gap,
    SAFE_CAST(JSON_VALUE(payload_json, '$.total') AS NUMERIC) - SAFE_CAST(JSON_VALUE(payload_json, '$.total_tax') AS NUMERIC)
     - (SELECT SUM(CAST(JSON_VALUE(l, '$.total') AS NUMERIC)) FROM UNNEST(JSON_QUERY_ARRAY(payload_json, '$.line_items')) l)
     - COALESCE((SELECT SUM(CAST(JSON_VALUE(l, '$.total') AS NUMERIC)) FROM UNNEST(JSON_QUERY_ARRAY(payload_json, '$.shipping_lines')) l), 0)
     - COALESCE((SELECT SUM(CAST(JSON_VALUE(l, '$.total') AS NUMERIC)) FROM UNNEST(JSON_QUERY_ARRAY(payload_json, '$.fee_lines')) l), 0) AS payload_residual
  FROM `oneeighty-warehouse.mart_qa.wp3_stg_woo_orders` WHERE client_id = 'rawbark')
SELECT FORMAT_DATE('%Y-%m', order_date) m, COUNT(*) n_fail, SUM(gap) sum_gap,
  COUNTIF(ABS(payload_residual) > 0.05) payload_inconsistent, COUNTIF(total_refunded != 0) with_refund
FROM s WHERE ABS(gap) > 1 GROUP BY 1 ORDER BY 1;
-- Result: 2025-11: 102 / +23,321.35 / 102 / 0; 2026-03: 2 / +267.80 / 2 / 0;
--         2026-07: 1 / -120.54 / 1 / 0.


-- -----------------------------------------------------------------------------
-- R4. Line level: SUM(line revenue) per order = order subtotal_price within
-- 1 CZK; allocation sums to the order fee; every changed line explained;
-- product, sku and unit-economics marts follow the allocation per day.
-- Result 2026-10-04:
--   ethia: 1,805 orders, 0 off by more than 1 CZK, max allocation error 4.5e-7;
--          4,311 lines, 506 changed, all explained.
--   rawbark: 50,008 orders, 5 off by more than 1 CZK (same 5 off before 228:
--          lines sum to about 2x the order, duplicated raw lines: 72751, 72727,
--          72972, 70580, 72705), 2 orders without lines (62218 no fee; 63698
--          carries a -66.71 CZK credit fee that has no line to land on);
--          max allocation error 7.9e-6 CZK; 95,814 lines, 23,756 changed, all
--          explained (revenue and margin delta = alloc, line_discount delta = -alloc).
--   Marts (per client and day): product_perf revenue and margin, sku_perf
--   revenue, unit_economics net_sales (+alloc) and discounts (-alloc): 0 days
--   off; units, rows, cost, gross_retail, cogs, orders unchanged.
--   rawbark product revenue delta -2,210,924.52 = allocated sum; vs order-level
--   -2,210,991.23 the 66.71 gap is order 63698.
-- -----------------------------------------------------------------------------
WITH o AS (SELECT client_id, order_id, subtotal_price, fee_discounts FROM `oneeighty-warehouse.mart_qa.wp3_stg_woo_orders`),
qi AS (SELECT client_id, order_id, SUM(revenue) rev, SUM(fee_discount_alloc) alloc
       FROM `oneeighty-warehouse.mart_qa.wp3_stg_woo_order_items` GROUP BY 1, 2),
lines AS (
  SELECT q.client_id,
    TO_JSON_STRING((SELECT AS STRUCT q.* EXCEPT(fee_discount_alloc))) = TO_JSON_STRING(p) same,
    q.fee_discount_alloc,
    TO_JSON_STRING((SELECT AS STRUCT q.* EXCEPT(fee_discount_alloc, revenue, line_discount, margin)))
      = TO_JSON_STRING((SELECT AS STRUCT p.* EXCEPT(revenue, line_discount, margin))) rest_same,
    (q.revenue - p.revenue) = q.fee_discount_alloc rev_ok,
    (q.line_discount - p.line_discount) = -q.fee_discount_alloc disc_ok,
    (q.margin IS NULL AND p.margin IS NULL) OR (q.margin - p.margin) = q.fee_discount_alloc margin_ok
  FROM `oneeighty-warehouse.mart_qa.wp3_stg_woo_order_items` q
  JOIN `oneeighty-warehouse.stg.stg_woo_order_items` p USING (client_id, order_id, line_item_id))
SELECT o.client_id, COUNT(*) orders, COUNTIF(qi.order_id IS NULL) orders_without_lines,
  COUNTIF(ABS(qi.rev - o.subtotal_price) > 1) line_vs_order_gt1,
  MAX(ABS(qi.alloc - o.fee_discounts)) max_alloc_err,
  (SELECT COUNTIF(NOT same) FROM lines l WHERE l.client_id = o.client_id) lines_changed,
  (SELECT COUNTIF(NOT rest_same OR NOT rev_ok OR NOT disc_ok OR NOT margin_ok) FROM lines l WHERE l.client_id = o.client_id) unexplained
FROM o LEFT JOIN qi USING (client_id, order_id)
GROUP BY o.client_id;


-- -----------------------------------------------------------------------------
-- R5. Determinism: 5 runs, cache defeated by changing a comment in the query
-- text. FLOAT64 google_* columns excluded (RB17).
-- Result 2026-10-04, all 5 runs identical:
--   fp_orders 72074984842499293, fp_items -1591969489428326828,
--   fp_daily 4439520294866673598
-- -----------------------------------------------------------------------------
-- wp3 determinism run N
SELECT
 (SELECT FARM_FINGERPRINT(STRING_AGG(TO_JSON_STRING(t), '|' ORDER BY client_id, order_id))
    FROM `oneeighty-warehouse.mart_qa.wp3_stg_woo_orders` t WHERE order_date < CURRENT_DATE()) fp_orders,
 (SELECT FARM_FINGERPRINT(STRING_AGG(TO_JSON_STRING(t), '|' ORDER BY client_id, order_id, line_item_id))
    FROM `oneeighty-warehouse.mart_qa.wp3_stg_woo_order_items` t WHERE order_date < CURRENT_DATE()) fp_items,
 (SELECT FARM_FINGERPRINT(STRING_AGG(TO_JSON_STRING((SELECT AS STRUCT t.* EXCEPT(google_spend, google_revenue, google_purchases))),
                                     '|' ORDER BY client_id, date, currency))
    FROM `oneeighty-warehouse.mart_qa.wp3_mart_daily_kpis` t WHERE date < CURRENT_DATE()) fp_daily;


-- -----------------------------------------------------------------------------
-- R6. Reconciliation with the source (last 90 days): revenue from components
-- vs revenue from Woo's own order totals.
-- Result 2026-10-04: ethia 271 orders, 278,610.16 vs 278,610.16 (0 diff, order
-- by order); rawbark 2,690 orders, 5,005,242.62 vs 5,005,360.27 (-117.65 CZK,
-- -0.0024 %, the one inconsistent 2026-07 order). Both well under 2 %.
-- -----------------------------------------------------------------------------
SELECT client_id, COUNT(*) orders,
  SUM(net_revenue) cand_net_revenue,
  SUM(total_price - total_tax - total_refunded - other_charges) woo_totals_based,
  SUM(net_revenue) - SUM(total_price - total_tax - total_refunded - other_charges) diff
FROM `oneeighty-warehouse.mart_qa.wp3_stg_woo_orders`
WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY) AND order_date < CURRENT_DATE()
GROUP BY 1;


-- -----------------------------------------------------------------------------
-- R7. Dormant cost join, functional test (run once, objects dropped after).
-- A test copy mart_qa.wp3_product_costs_test got 7 synthetic rawbark rows and a
-- test view read it. Result 2026-10-04 (rawbark lines 2026-07-25 onward):
--   variation 65875 row (100, from 2026-08-01) beats product 62972 row (999):
--     Aug-Oct lines 100, July lines 999 (variation row not yet effective);
--     other variations of 62972: 999.
--   product 57 row (70) beats sku '36' row (5): 70.
--   sku '37' rows 50 from 2026-08-01, 60 from 2026-09-01: Aug 50, Sep-Oct 60.
--   product 323 row 20 EUR: Aug 483.58, Sep 485.08 CZK (ref.fx_rates), Oct NULL
--     (no October rate yet: NULL, never a stale rate), July NULL (before
--     effective_from).
--   line_cost = unit_cost * quantity and margin = revenue - line_cost on every
--   line; no row duplication; no other column changed.
-- With the real (empty for Woo) wp3_product_costs the candidate equals 228
-- without the cost join: that is covered by R1 to R5.
-- -----------------------------------------------------------------------------
