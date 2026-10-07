-- =============================================================================
-- qa/279fgh_regression.sql  (package ca1, CM3 and aMER)
-- How the QA in projects/promo-pacing/raw/12-ca1-report.md was run.
--
-- Two fields (owner 2026-10-07). A checkpoint measures over its own Start..Due and its
-- aMER qualifying spend is derived from the Ad budget, so there is no window or min spend
-- column to compare: see raw/12 section 8.
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
a1 AS (SELECT TO_JSON_STRING(t) j FROM (SELECT * EXCEPT(target_cm3, target_amer) FROM `oneeighty-warehouse.mart_qa.ca1_stg_clickup_plan`) t),
b1 AS (SELECT TO_JSON_STRING(t) j FROM `oneeighty-warehouse.stg.stg_clickup_plan` t),
a2 AS (SELECT TO_JSON_STRING(t) j FROM (SELECT * EXCEPT(target_cm3, target_amer) FROM `oneeighty-warehouse.mart_qa.ca1_stg_clickup_plan_versions`) t),
b2 AS (SELECT TO_JSON_STRING(t) j FROM `oneeighty-warehouse.stg.stg_clickup_plan_versions` t),
a3 AS (SELECT TO_JSON_STRING(t) j FROM (SELECT * EXCEPT(target_cm3, target_amer, orig_target_cm3, orig_target_amer) FROM `oneeighty-warehouse.mart_qa.ca1_plan_input_v`) t),
b3 AS (SELECT TO_JSON_STRING(t) j FROM `oneeighty-warehouse.mart.plan_input_v` t)
SELECT 'stg_plan' o, (SELECT COUNT(*) FROM (SELECT j FROM a1 EXCEPT DISTINCT SELECT j FROM b1)) qa_not_prod, (SELECT COUNT(*) FROM (SELECT j FROM b1 EXCEPT DISTINCT SELECT j FROM a1)) prod_not_qa
UNION ALL SELECT 'stg_versions', (SELECT COUNT(*) FROM (SELECT j FROM a2 EXCEPT DISTINCT SELECT j FROM b2)), (SELECT COUNT(*) FROM (SELECT j FROM b2 EXCEPT DISTINCT SELECT j FROM a2))
UNION ALL SELECT 'plan_input_v', (SELECT COUNT(*) FROM (SELECT j FROM a3 EXCEPT DISTINCT SELECT j FROM b3)), (SELECT COUNT(*) FROM (SELECT j FROM b3 EXCEPT DISTINCT SELECT j FROM a3));

-- B. 279g: old metrics unchanged. Rounding to a fixed number of decimals is unreliable
-- here (a value can sit exactly on the rounding boundary), so compare every non-numeric
-- column exactly and every numeric column by absolute difference.
-- Expect: 2874 rows, 0 non-numeric diffs, max_abs_diff about 5.8e-10, 0 rows over 1e-6.
WITH j AS (
 SELECT q.client_id, q.period_type, q.period_id, q.metric,
   TO_JSON_STRING(STRUCT(q.period_label, q.task_id, q.plan_status, q.as_of, q.period_start, q.period_end,
     q.days_total, q.days_elapsed, q.days_remaining, q.is_target_partial, q.status, q.is_too_early,
     q.result, q.is_preliminary, q.mer_cap_pct, q.attributed_orders, q.attributed_target,
     q.target_total IS NULL, q.actual_to_date IS NULL, q.projected_end IS NULL, q.pace_pct IS NULL,
     q.z_score IS NULL, q.projected_low IS NULL, q.baseline_total IS NULL))
   = TO_JSON_STRING(STRUCT(p.period_label, p.task_id, p.plan_status, p.as_of, p.period_start, p.period_end,
     p.days_total, p.days_elapsed, p.days_remaining, p.is_target_partial, p.status, p.is_too_early,
     p.result, p.is_preliminary, p.mer_cap_pct, p.attributed_orders, p.attributed_target,
     p.target_total IS NULL, p.actual_to_date IS NULL, p.projected_end IS NULL, p.pace_pct IS NULL,
     p.z_score IS NULL, p.projected_low IS NULL, p.baseline_total IS NULL)) AS non_numeric_same,
   GREATEST(
     ABS(IFNULL(q.target_total,0)-IFNULL(p.target_total,0)), ABS(IFNULL(q.curve_target_total,0)-IFNULL(p.curve_target_total,0)),
     ABS(IFNULL(q.target_to_date,0)-IFNULL(p.target_to_date,0)), ABS(IFNULL(q.actual_to_date,0)-IFNULL(p.actual_to_date,0)),
     ABS(IFNULL(q.pace_pct,0)-IFNULL(p.pace_pct,0)), ABS(IFNULL(q.gap_abs,0)-IFNULL(p.gap_abs,0)),
     ABS(IFNULL(q.projected_end,0)-IFNULL(p.projected_end,0)), ABS(IFNULL(q.projected_low,0)-IFNULL(p.projected_low,0)),
     ABS(IFNULL(q.projected_high,0)-IFNULL(p.projected_high,0)), ABS(IFNULL(q.required_daily_rate,0)-IFNULL(p.required_daily_rate,0)),
     ABS(IFNULL(q.required_curve_mult,0)-IFNULL(p.required_curve_mult,0)), ABS(IFNULL(q.z_score,0)-IFNULL(p.z_score,0)),
     ABS(IFNULL(q.mer_plan_pct,0)-IFNULL(p.mer_plan_pct,0)), ABS(IFNULL(q.mer_actual_pct,0)-IFNULL(p.mer_actual_pct,0)),
     ABS(IFNULL(q.aov_plan,0)-IFNULL(p.aov_plan,0)), ABS(IFNULL(q.baseline_total,0)-IFNULL(p.baseline_total,0)),
     ABS(IFNULL(q.baseline_to_date,0)-IFNULL(p.baseline_to_date,0)), ABS(IFNULL(q.lift_vs_baseline_pct,0)-IFNULL(p.lift_vs_baseline_pct,0))) AS max_abs_diff
 FROM `oneeighty-warehouse.mart_qa.ca1_plan_pacing_reg` q
 JOIN `oneeighty-warehouse.mart.plan_pacing` p USING (client_id, period_type, period_id, metric)
 WHERE q.metric NOT IN ('cm3', 'amer'))
SELECT COUNT(*) rows_compared, COUNTIF(NOT non_numeric_same) non_numeric_diffs,
       MAX(max_abs_diff) max_abs_diff, COUNTIF(max_abs_diff > 0.000001) n_over_1e6
FROM j;

-- B1b. plan_targets_daily, old metrics (expect 1857 / 1857, 0 and 0)
WITH qt AS (SELECT TO_JSON_STRING(t) j FROM (SELECT * EXCEPT(refreshed_at, ratio_den_daily, target_ratio) FROM `oneeighty-warehouse.mart_qa.ca1_plan_targets_daily_reg` WHERE metric NOT IN ('cm3', 'amer')) t),
pt AS (SELECT TO_JSON_STRING(t) j FROM (SELECT * EXCEPT(refreshed_at) FROM `oneeighty-warehouse.mart.plan_targets_daily`) t)
SELECT (SELECT COUNT(*) FROM qt) qa_rows, (SELECT COUNT(*) FROM pt) prod_rows,
       (SELECT COUNT(*) FROM (SELECT j FROM qt EXCEPT DISTINCT SELECT j FROM pt)) qa_not_prod,
       (SELECT COUNT(*) FROM (SELECT j FROM pt EXCEPT DISTINCT SELECT j FROM qt)) prod_not_qa;

-- B2. CM3 and aMER actuals equal the mart (Snapshot) numbers
SELECT p.client_id, p.metric, p.actual_to_date, k.cm3 AS mart_cm3, SAFE_DIVIDE(k.ncr, k.paid) AS mart_amer
FROM `oneeighty-warehouse.mart_qa.ca1_plan_pacing` p
JOIN (SELECT client_id, SUM(cm3) cm3, SUM(new_customer_revenue) ncr, SUM(paid_spend) paid
      FROM `oneeighty-warehouse.mart.mart_daily_kpis`
      WHERE date BETWEEN '2026-10-01' AND '2026-10-06' GROUP BY 1) k USING (client_id)
WHERE p.period_type = 'month' AND p.period_id = '2026-10' AND p.metric IN ('cm3', 'amer');

-- C. Sample (simulation with the proposed ClickUp values, dashboard-basis CM3).
-- min_spend is derived: 50 % of the ad spend the plan puts in the window.
SELECT period_type, period_id, period_label, metric, period_start, period_end, target_total, target_to_date,
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

-- E. No-budget path: a synthetic aMER floor on a Manami checkpoint (Manami months carry
-- no Ad budget). Expect min_spend NULL, the spend still reported, the floor judged on the
-- ratio alone, and the amer_no_budget check firing. Revert the UPDATE afterwards.
--   UPDATE mart_qa.ca1_plan_input SET target_amer = 2.0 WHERE client_id = 'manami' AND task_id = <first checkpoint>;
SELECT p.period_id, p.period_label, p.target_total AS floor_amer, p.actual_to_date,
       p.min_spend, p.ratio_den_actual AS spend_on, p.status, p.condition_met, p.is_measured,
       (SELECT COUNT(*) FROM `oneeighty-warehouse.mart_qa.ca1_plan_checks` c
        WHERE c.client_id = 'manami' AND c.check_id = 'amer_no_budget') AS check_fires
FROM `oneeighty-warehouse.mart_qa.ca1_plan_pacing_v` p
WHERE p.client_id = 'manami' AND p.period_type = 'gate' AND p.metric = 'amer';
--   UPDATE mart_qa.ca1_plan_input SET target_amer = NULL WHERE client_id = 'manami';
