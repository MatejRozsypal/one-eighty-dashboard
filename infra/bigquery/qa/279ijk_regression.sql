-- =============================================================================
-- qa/279ijk_regression.sql
-- Package pm1: the regression and the before / after for 279i, 279j, 279k.
--
-- QA objects (mart_qa, prefix pm1_), built in this order:
--   pm1_plan_orders_v / pm1_plan_orders        279i against prod stg
--   pm1_plan_promo_orders_v / ..._orders       279j, reading pm1_plan_orders
--   pm1_plan_promo_perf_v  / ..._perf          279j, reading pm1_plan_promo_orders
--                                              and the deployed mart.plan_actuals_daily
--   pm1_plan_pacing                            279k, which is the deployed
--                                              plan_pacing_v minus 3 output
--                                              columns (the file diff against
--                                              279g is those 4 lines and nothing
--                                              else), materialised here as
--                                              mart.plan_pacing_v without them
-- Re-run 2026-10-07 after merging origin/main b406c9a, with 279f to 279h
-- deployed. as of 2026-10-06.
-- =============================================================================

-- 1. plan_orders: every pre-existing column identical to prod (137 362 / 137 362, 0 / 0)
WITH q AS (
  SELECT client_id, platform, order_id, order_date, customer_key, is_new_customer, goods_net,
         refund_net, net_revenue, total_discounts, fee_discounts, fx_rate, units,
         ARRAY_TO_STRING(coupon_codes, ',') cc, utm_campaign
  FROM `oneeighty-warehouse.mart_qa.pm1_plan_orders`
), p AS (
  SELECT client_id, platform, order_id, order_date, customer_key, is_new_customer, goods_net,
         refund_net, net_revenue, total_discounts, fee_discounts, fx_rate, units,
         ARRAY_TO_STRING(coupon_codes, ',') cc, utm_campaign
  FROM `oneeighty-warehouse.mart.plan_orders`
)
SELECT
  (SELECT COUNT(*) FROM q) qa_rows,
  (SELECT COUNT(*) FROM p) prod_rows,
  (SELECT COUNT(*) FROM (SELECT * FROM q EXCEPT DISTINCT SELECT * FROM p)) qa_not_prod,
  (SELECT COUNT(*) FROM (SELECT * FROM p EXCEPT DISTINCT SELECT * FROM q)) prod_not_qa;

-- 2. order_cogs against mart_daily_kpis, per client and month
--    Ethia: equal on 12 of 14 months; June and September 2026 differ by one
--    order each (the plan layer books the client local date, the mart the stg
--    date: 279b, unchanged here).
--    Manami: equal on 11 of 14 months; the three that differ also differ in
--    order count for the same reason.
WITH q AS (
  SELECT client_id, DATE_TRUNC(order_date, MONTH) m,
    COUNT(*) orders, COUNTIF(order_cogs IS NULL) uncosted, SUM(order_cogs) cogs
  FROM `oneeighty-warehouse.mart_qa.pm1_plan_orders`
  WHERE order_date >= '2025-09-01' GROUP BY 1, 2
), k AS (
  SELECT client_id, DATE_TRUNC(date, MONTH) m, SUM(cogs) cogs, SUM(orders) orders
  FROM `oneeighty-warehouse.mart.mart_daily_kpis`
  WHERE date >= '2025-09-01' GROUP BY 1, 2
)
SELECT q.client_id, q.m, q.orders, k.orders mart_orders, q.uncosted,
  ROUND(q.cogs, 2) qa_cogs, ROUND(k.cogs, 2) mart_cogs, ROUND(q.cogs - k.cogs, 2) diff
FROM q LEFT JOIN k USING (client_id, m)
ORDER BY q.client_id, q.m;

-- 3. plan_promo_orders: every pre-existing column identical to prod (450 / 450, 0 / 0)
WITH q AS (
  SELECT client_id, task_id, phase, mechanic, source, window_start, window_end, window_days,
         order_id, order_date, match_type, match_rank, matched_key,
         ARRAY_TO_STRING(match_types, ',') mts, is_primary, n_promos, arm, in_window,
         net_revenue, total_discounts, fee_discounts, has_mechanic, is_new_customer,
         ARRAY_TO_STRING(coupon_codes, ',') cc, promo_units, promo_line_revenue, gift_units
  FROM `oneeighty-warehouse.mart_qa.pm1_plan_promo_orders`
), p AS (
  SELECT client_id, task_id, phase, mechanic, source, window_start, window_end, window_days,
         order_id, order_date, match_type, match_rank, matched_key,
         ARRAY_TO_STRING(match_types, ',') mts, is_primary, n_promos, arm, in_window,
         net_revenue, total_discounts, fee_discounts, has_mechanic, is_new_customer,
         ARRAY_TO_STRING(coupon_codes, ',') cc, promo_units, promo_line_revenue, gift_units
  FROM `oneeighty-warehouse.mart.plan_promo_orders`
)
SELECT
  (SELECT COUNT(*) FROM q) qa_rows,
  (SELECT COUNT(*) FROM p) prod_rows,
  (SELECT COUNT(*) FROM (SELECT * FROM q EXCEPT DISTINCT SELECT * FROM p)) qa_not_prod,
  (SELECT COUNT(*) FROM (SELECT * FROM p EXCEPT DISTINCT SELECT * FROM q)) prod_not_qa;

-- 4. plan_promo_perf: every column that is NOT one of the three fixed ones
--    (810 / 810, 6 / 6). The 6 are the three Manami promos still running, on
--    the day after as of, and their total rows: fix 3.
WITH q AS (
  SELECT client_id, task_id, phase, mechanic, source, clickup_status, grain, date, day_index,
    window_start, window_end, window_days, is_complete,
    attr_orders, attr_revenue, attr_new_customers, attr_units, attr_gift_units,
    prim_orders, prim_revenue, late_orders, late_revenue,
    store_orders, store_revenue, store_new_customers, meta_spend, kpi_net_sales, mer_cap_pct,
    ROUND(attr_share_orders, 6) aso, ROUND(attr_share_revenue, 6) asr,
    ROUND(prim_share_orders, 6) pso, store_mer_pct, mer_over_cap
  FROM `oneeighty-warehouse.mart_qa.pm1_plan_promo_perf`
), p AS (
  SELECT client_id, task_id, phase, mechanic, source, clickup_status, grain, date, day_index,
    window_start, window_end, window_days, is_complete,
    attr_orders, attr_revenue, attr_new_customers, attr_units, attr_gift_units,
    prim_orders, prim_revenue, late_orders, late_revenue,
    store_orders, store_revenue, store_new_customers, meta_spend, kpi_net_sales, mer_cap_pct,
    ROUND(attr_share_orders, 6) aso, ROUND(attr_share_revenue, 6) asr,
    ROUND(prim_share_orders, 6) pso, store_mer_pct, mer_over_cap
  FROM `oneeighty-warehouse.mart.plan_promo_perf`
)
SELECT
  (SELECT COUNT(*) FROM q) qa_rows,
  (SELECT COUNT(*) FROM p) prod_rows,
  (SELECT COUNT(*) FROM (SELECT * FROM q EXCEPT DISTINCT SELECT * FROM p)) qa_not_prod,
  (SELECT COUNT(*) FROM (SELECT * FROM p EXCEPT DISTINCT SELECT * FROM q)) prod_not_qa;

-- 5. Before and after on the three fixed columns, per promo
WITH q AS (SELECT * FROM `oneeighty-warehouse.mart_qa.pm1_plan_promo_perf` WHERE grain = 'total'),
     p AS (SELECT * FROM `oneeighty-warehouse.mart.plan_promo_perf`        WHERE grain = 'total')
SELECT q.client_id, q.phase, q.window_start, q.window_end, q.is_storewide, q.has_coupon_data,
  p.attr_orders attr_before, q.attr_orders attr_after,
  p.attr_code_orders code_before, q.attr_code_orders code_after,
  p.attr_no_code_orders nocode_before, q.attr_no_code_orders nocode_after,
  p.attr_discounted_orders disc_before, q.attr_discounted_orders disc_after,
  q.store_orders, ROUND(100 * q.attr_share_orders, 1) share_pct, q.days_elapsed, q.window_days
FROM q JOIN p ON p.client_id = q.client_id AND p.task_id = q.task_id
WHERE q.attr_orders > 0
ORDER BY q.client_id, q.window_start;

-- 6. The promo detail and the margin, per promo
SELECT client_id, phase, is_storewide, has_coupon_data,
  attr_orders, store_orders,
  attr_code_orders, attr_no_code_orders, attr_discounted_orders,
  attr_new_customers, attr_returning_customers, attr_gift_units,
  ROUND(attr_revenue, 0) rev, ROUND(attr_discount_given, 0) discount_given,
  attr_orders_costed, ROUND(attr_cogs, 0) cogs, ROUND(attr_cm1, 0) cm1, attr_cm1_pct,
  ROUND(attr_meta_spend, 0) promo_ad_spend, ROUND(attr_cm3, 0) cm3,
  ROUND(store_cm3, 0) store_cm3, store_cm3_measured,
  attr_orders_coupon, attr_orders_sku, attr_orders_gift_sku, attr_orders_utm, attr_orders_window
FROM `oneeighty-warehouse.mart_qa.pm1_plan_promo_perf`
WHERE grain = 'total' AND attr_orders > 0
ORDER BY client_id, window_start;

-- 7. Invariants, all 0
SELECT
  (SELECT COUNT(*) FROM `oneeighty-warehouse.mart_qa.pm1_plan_promo_perf`
    WHERE grain = 'total' AND attr_orders > store_orders) attr_over_store,
  (SELECT COUNT(*) FROM `oneeighty-warehouse.mart_qa.pm1_plan_promo_perf`
    WHERE attr_orders != attr_code_orders + attr_no_code_orders) code_split_mismatch,
  (SELECT COUNT(*) FROM `oneeighty-warehouse.mart_qa.pm1_plan_promo_perf`
    WHERE attr_orders != attr_new_customers + attr_returning_customers) customer_split_mismatch,
  (SELECT COUNT(*) FROM `oneeighty-warehouse.mart_qa.pm1_plan_promo_perf`
    WHERE grain = 'total' AND attr_orders > 0
      AND attr_orders != attr_orders_coupon + attr_orders_sku + attr_orders_gift_sku
                         + attr_orders_utm + attr_orders_window) match_mix_mismatch,
  (SELECT COUNT(*) FROM `oneeighty-warehouse.mart_qa.pm1_plan_promo_perf`
    WHERE grain = 'total' AND attr_cm1 IS NOT NULL AND attr_cm1 > attr_revenue) cm1_over_revenue,
  (SELECT COUNT(*) FROM (SELECT client_id, task_id, grain, date, COUNT(*) n
     FROM `oneeighty-warehouse.mart_qa.pm1_plan_promo_perf` GROUP BY 1, 2, 3, 4 HAVING n > 1)) dup_perf_rows,
  (SELECT COUNT(*) FROM (SELECT client_id, task_id, order_id, COUNT(*) n
     FROM `oneeighty-warehouse.mart_qa.pm1_plan_promo_orders` GROUP BY 1, 2, 3 HAVING n > 1)) dup_promo_orders,
  (SELECT COUNT(*) FROM `oneeighty-warehouse.mart_qa.pm1_plan_promo_perf`
    WHERE grain = 'total' AND is_storewide AND attr_orders != store_orders) storewide_not_store;

-- 8. plan_pacing after 279k: 4 303 / 4 303 rows, 0 / 0 differences on every
--    remaining column, against the deployed table.
WITH q AS (SELECT * EXCEPT (refreshed_at) FROM `oneeighty-warehouse.mart_qa.pm1_plan_pacing`),
     c AS (SELECT * EXCEPT (refreshed_at, baseline_total, baseline_to_date, lift_vs_baseline_pct)
           FROM `oneeighty-warehouse.mart.plan_pacing`)
SELECT
  (SELECT COUNT(*) FROM q) pm1_rows,
  (SELECT COUNT(*) FROM c) prod_rows,
  (SELECT COUNT(*) FROM (SELECT * FROM q EXCEPT DISTINCT SELECT * FROM c)) pm1_not_prod,
  (SELECT COUNT(*) FROM (SELECT * FROM c EXCEPT DISTINCT SELECT * FROM q)) prod_not_pm1;

-- 9. What the removed lift actually said: on every row that carried one, the
--    baseline equals the target to date, so the lift is pace minus 1.
SELECT client_id, period_id, period_label, metric, ROUND(actual_to_date, 0) actual,
  ROUND(target_to_date, 1) target_to_date, ROUND(baseline_to_date, 1) baseline_to_date,
  lift_vs_baseline_pct, ROUND(pace_pct, 1) pace_pct
FROM `oneeighty-warehouse.mart.plan_pacing`
WHERE lift_vs_baseline_pct IS NOT NULL
ORDER BY 1, 2, 4;
