-- =============================================================================
-- qa/275_276_backtest.sql  (package PP2, run 2026-10-06 in mart_qa)
-- Objects under test: mart_qa.pp2_promo_keys (274), mart_qa.pp2_plan_promo_orders (275),
-- mart_qa.pp2_plan_promo_perf (276). Build them from the migration files with the names
-- ref.plan_promo_keys / mart.plan_promo_orders / mart.plan_promo_perf replaced by the
-- mart_qa names above. Results in projects/promo-pacing/raw/07-pp2-report.md.
-- =============================================================================

-- 1. Bridge by promo and match type
SELECT phase, match_type, in_window, COUNT(*) n, COUNTIF(is_primary) prim,
       COUNTIF(n_promos > 1) overlap, ROUND(SUM(net_revenue)) rev,
       COUNTIF(is_new_customer) newc, SUM(promo_units) units, SUM(gift_units) gifts,
       COUNTIF(has_mechanic) mech, STRING_AGG(DISTINCT matched_key) keys
FROM `oneeighty-warehouse.mart_qa.pp2_plan_promo_orders`
GROUP BY 1, 2, 3 ORDER BY 1, 2;

-- 2. Synthetic overlap test: insert, run 3, delete
INSERT INTO `oneeighty-warehouse.mart_qa.pp2_promo_keys`
  (client_id, task_id, phase, promo_name, source, clickup_status, mechanic, is_storewide,
   is_test, window_start, window_end, coupon_codes, skus, gift_skus, utm_campaigns,
   pending_note, updated_at)
VALUES
('ethia','test-A','T-A','synthetic storewide overlap','test',NULL,'Cart discount',TRUE,FALSE,
 '2025-11-20','2025-12-10',[],[],[],[],'synthetic overlap test',CURRENT_TIMESTAMP()),
('ethia','test-B','T-B','synthetic code test + late','test',NULL,'Full price',FALSE,TRUE,
 '2026-01-01','2026-01-10',['LEDEN9'],['PID:1023'],['PID:1702'],[],'arm and coupon_late test',CURRENT_TIMESTAMP()),
('ethia','test-C','T-C','synthetic rejected','test','rejected','Cart discount',TRUE,FALSE,
 '2026-01-01','2026-01-31',[],[],[],[],'must be ignored',CURRENT_TIMESTAMP());

-- 3. Overlap pairs, duplicates, primary uniqueness
WITH b AS (SELECT * FROM `oneeighty-warehouse.mart_qa.pp2_plan_promo_orders`)
SELECT 'pairs' k, COUNT(*) n, pair FROM (
  SELECT order_id, STRING_AGG(CONCAT(phase, ':', match_type, IF(is_primary, '*', '')) ORDER BY phase) pair
  FROM b GROUP BY order_id HAVING COUNT(*) > 1) GROUP BY pair
UNION ALL
SELECT 'dup_check', COUNT(*), 'promo x order dups'
FROM (SELECT task_id, order_id FROM b GROUP BY 1, 2 HAVING COUNT(*) > 1)
UNION ALL
SELECT 'primary_check', COUNT(*), 'orders with != 1 primary'
FROM (SELECT order_id FROM b GROUP BY 1 HAVING COUNTIF(is_primary) != 1);
-- expected (2026-10-06): H-BF2025:coupon* + T-A:window 30, H-BF2025:window* + T-A:window 6,
-- H-XMAS2025:sku* + T-A:window 10, H-LEDEN9:coupon* + T-B:coupon_late 45,
-- H-LEDEN9:coupon + T-B:coupon* 4 (shorter window wins); dups 0; primary_check 0.

-- 4. Sanity on perf: attributed <= store per promo day, exclusive sum <= store per day
WITH p AS (SELECT * FROM `oneeighty-warehouse.mart_qa.pp2_plan_promo_perf` WHERE grain = 'day'),
d AS (SELECT client_id, date, SUM(prim_orders) prim, SUM(prim_revenue) primrev,
             ANY_VALUE(store_orders) store, ANY_VALUE(store_revenue) srev, SUM(attr_orders) attr_sum
      FROM p GROUP BY 1, 2)
SELECT
  (SELECT COUNT(*) FROM p WHERE attr_orders > store_orders) promo_days_attr_gt_store,  -- 0
  (SELECT COUNT(*) FROM d WHERE prim > store) days_prim_gt_store,                     -- 0
  (SELECT COUNT(*) FROM d WHERE primrev > srev + 0.01) days_primrev_gt_store,         -- 0
  (SELECT COUNT(*) FROM d WHERE attr_sum > store) days_nonexcl_sum_gt_store;          -- 10, synthetic overlap only

DELETE FROM `oneeighty-warehouse.mart_qa.pp2_promo_keys` WHERE source = 'test';

-- 5. Promo totals (backtest table of the report)
SELECT phase, attr_orders, ROUND(attr_revenue) attr_rev, attr_new_customers, attr_units,
       prim_orders, late_orders, store_orders, ROUND(store_revenue) store_rev,
       ROUND(attr_share_orders, 3) sh_o, ROUND(attr_share_revenue, 3) sh_r, store_mer_pct
FROM `oneeighty-warehouse.mart_qa.pp2_plan_promo_perf`
WHERE grain = 'total' AND source = 'history'
ORDER BY window_start;
