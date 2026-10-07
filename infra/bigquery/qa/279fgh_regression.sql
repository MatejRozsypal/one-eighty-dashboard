-- =============================================================================
-- qa/279fgh_regression.sql  (package ca1, CM3 and aMER)
-- How the QA in projects/promo-pacing/raw/12-ca1-report.md was run.
--
-- QA objects (mart_qa, prefix ca1_): the bodies of 279f / 279g with every changed object
-- renamed (stg.stg_clickup_plan -> mart_qa.ca1_stg_clickup_plan, ..._versions,
-- mart.plan_input(_v), plan_actuals_daily(_v), plan_actuals_monthly(_v), plan_targets,
-- plan_targets_daily(_v), plan_pacing(_v), plan_checks -> mart_qa.ca1_*). Unchanged
-- inputs are read from prod (mart.plan_orders, mart.plan_order_lines,
-- mart.mart_daily_kpis, raw, ref). Tables built with the same SELECT *, refreshed_at as
-- the procedures, right after a prod refresh (same plan_orders snapshot).
--   1. 279f views; regression A.
--   2. CREATE TABLE ca1_plan_input AS plan_input_v; 279g views and tables; regression B
--      (snapshot kept as ca1_plan_pacing_reg, ca1_plan_targets_daily_reg).
--   3. Simulation: UPDATE ca1_plan_input with the values of 11-CLICKUP-CM3-AMER.md
--      (Tracker-basis CM3), rebuild targets daily and pacing, read samples C.
--   4. 279h as mart_qa.ca1h_plan_input_v; diff D.
-- =============================================================================

-- A. 279f: staging and plan_input unchanged on the old columns (expect 0 / 0 each)
WITH
a1 AS (SELECT TO_JSON_STRING(t) j FROM (SELECT * EXCEPT(target_cm3, target_amer, amer_window_days, amer_min_spend) FROM `oneeighty-warehouse.mart_qa.ca1_stg_clickup_plan`) t),
b1 AS (SELECT TO_JSON_STRING(t) j FROM `oneeighty-warehouse.stg.stg_clickup_plan` t),
a2 AS (SELECT TO_JSON_STRING(t) j FROM (SELECT * EXCEPT(target_cm3, target_amer, amer_window_days, amer_min_spend) FROM `oneeighty-warehouse.mart_qa.ca1_stg_clickup_plan_versions`) t),
b2 AS (SELECT TO_JSON_STRING(t) j FROM `oneeighty-warehouse.stg.stg_clickup_plan_versions` t),
a3 AS (SELECT TO_JSON_STRING(t) j FROM (SELECT * EXCEPT(target_cm3, target_amer, amer_window_days, amer_min_spend, orig_target_cm3, orig_target_amer) FROM `oneeighty-warehouse.mart_qa.ca1_plan_input_v`) t),
b3 AS (SELECT TO_JSON_STRING(t) j FROM `oneeighty-warehouse.mart.plan_input_v` t)
SELECT 'stg_plan' o, (SELECT COUNT(*) FROM (SELECT j FROM a1 EXCEPT DISTINCT SELECT j FROM b1)) qa_not_prod, (SELECT COUNT(*) FROM (SELECT j FROM b1 EXCEPT DISTINCT SELECT j FROM a1)) prod_not_qa
UNION ALL SELECT 'stg_versions', (SELECT COUNT(*) FROM (SELECT j FROM a2 EXCEPT DISTINCT SELECT j FROM b2)), (SELECT COUNT(*) FROM (SELECT j FROM b2 EXCEPT DISTINCT SELECT j FROM a2))
UNION ALL SELECT 'plan_input_v', (SELECT COUNT(*) FROM (SELECT j FROM a3 EXCEPT DISTINCT SELECT j FROM b3)), (SELECT COUNT(*) FROM (SELECT j FROM b3 EXCEPT DISTINCT SELECT j FROM a3));

-- B. 279g: old metrics and old columns unchanged (floats rounded to 6 decimals)
CREATE TEMP FUNCTION r(x FLOAT64) AS (ROUND(x, 6));
WITH
q AS (SELECT TO_JSON_STRING(STRUCT(client_id, period_type, period_id, period_label, metric, task_id, plan_status, as_of, period_start, period_end, days_total, days_elapsed, days_remaining, is_target_partial, r(target_total), r(curve_target_total), r(target_to_date), r(actual_to_date), r(pace_pct), r(gap_abs), r(projected_end), r(projected_low), r(projected_high), r(required_daily_rate), r(required_curve_mult), r(z_score), status, is_too_early, result, is_preliminary, mer_cap_pct, r(mer_plan_pct), r(mer_actual_pct), r(aov_plan), attributed_orders, attributed_target, r(baseline_total), r(baseline_to_date), r(lift_vs_baseline_pct))) j
      FROM `oneeighty-warehouse.mart_qa.ca1_plan_pacing_reg` WHERE metric NOT IN ('cm3', 'amer')),
p AS (SELECT TO_JSON_STRING(STRUCT(client_id, period_type, period_id, period_label, metric, task_id, plan_status, as_of, period_start, period_end, days_total, days_elapsed, days_remaining, is_target_partial, r(target_total), r(curve_target_total), r(target_to_date), r(actual_to_date), r(pace_pct), r(gap_abs), r(projected_end), r(projected_low), r(projected_high), r(required_daily_rate), r(required_curve_mult), r(z_score), status, is_too_early, result, is_preliminary, mer_cap_pct, r(mer_plan_pct), r(mer_actual_pct), r(aov_plan), attributed_orders, attributed_target, r(baseline_total), r(baseline_to_date), r(lift_vs_baseline_pct))) j
      FROM `oneeighty-warehouse.mart.plan_pacing`),
qt AS (SELECT TO_JSON_STRING(t) j FROM (SELECT * EXCEPT(refreshed_at, ratio_den_daily, target_ratio) FROM `oneeighty-warehouse.mart_qa.ca1_plan_targets_daily_reg` WHERE metric NOT IN ('cm3', 'amer')) t),
pt AS (SELECT TO_JSON_STRING(t) j FROM (SELECT * EXCEPT(refreshed_at) FROM `oneeighty-warehouse.mart.plan_targets_daily`) t)
SELECT 'plan_pacing' o, (SELECT COUNT(*) FROM (SELECT j FROM q EXCEPT DISTINCT SELECT j FROM p)) qa_not_prod, (SELECT COUNT(*) FROM (SELECT j FROM p EXCEPT DISTINCT SELECT j FROM q)) prod_not_qa
UNION ALL SELECT 'plan_targets_daily', (SELECT COUNT(*) FROM (SELECT j FROM qt EXCEPT DISTINCT SELECT j FROM pt)), (SELECT COUNT(*) FROM (SELECT j FROM pt EXCEPT DISTINCT SELECT j FROM qt));

-- B2. CM3 and aMER actuals equal the mart (Snapshot) numbers
SELECT p.client_id, p.metric, p.actual_to_date, k.cm3 AS mart_cm3, SAFE_DIVIDE(k.ncr, k.paid) AS mart_amer
FROM `oneeighty-warehouse.mart_qa.ca1_plan_pacing` p
JOIN (SELECT client_id, SUM(cm3) cm3, SUM(new_customer_revenue) ncr, SUM(paid_spend) paid
      FROM `oneeighty-warehouse.mart.mart_daily_kpis`
      WHERE date BETWEEN '2026-10-01' AND '2026-10-06' GROUP BY 1) k USING (client_id)
WHERE p.period_type = 'month' AND p.period_id = '2026-10' AND p.metric IN ('cm3', 'amer');

-- C. Sample (simulation with the proposed ClickUp values)
SELECT period_type, period_id, period_label, metric, measure_start, measure_end, target_total, target_to_date,
       actual_to_date, pace_pct, projected_end, z_score, status, result, condition_met,
       ratio_num_actual, ratio_den_actual, trailing_7d_ratio, required_ratio, min_spend, is_measured
FROM `oneeighty-warehouse.mart_qa.ca1_plan_pacing`
WHERE client_id = 'ethia' AND metric IN ('cm3', 'amer') AND period_type IN ('month', 'quarter', 'gate')
ORDER BY period_type, period_id, metric;

-- D. 279h: only mer_cap_pct / note (and the seed's original new customers) change
SELECT a.task_id, a.name, a.mer_cap_pct AS before_cap, b.mer_cap_pct AS after_cap,
       a.orig_target_new_customers AS before_orig_new, b.orig_target_new_customers AS after_orig_new
FROM `oneeighty-warehouse.mart_qa.ca1_plan_input_v` a
FULL JOIN `oneeighty-warehouse.mart_qa.ca1h_plan_input_v` b USING (client_id, task_id)
WHERE TO_JSON_STRING(a) IS DISTINCT FROM TO_JSON_STRING(b);
