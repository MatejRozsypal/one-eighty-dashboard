-- =============================================================================
-- qa/294_backtest.sql
-- Backtest of the 294 maturity multiplier (research-ltgp-prediction.md
-- section 6). QA only: writes mart_qa.mk_bt_cohorts and
-- mart_qa.mk_bt_predictions, then reads the metrics. Run 2026-10-15 on
-- mart_qa.mk_market_orders; results in docs/sessions/2026-10-15/markets/DATA-BUILD.md.
--
-- Design
--   Targets: monthly cohorts Jan 2024 to Sep 2025 (quarterly 2024Q1 to 2025Q3)
--   whose 365 d actual is complete. Checkpoints N = 30 / 60 / 90 / 180.
--   Freeze date F = last day of the cohort period + N - 1 (the day the whole
--   cohort has reached age N). No leakage: a reference cohort is used only if
--   its 365 d window had closed by F (cohort end + 364 <= F); the target only
--   contributes its own day-N actuals. Cohort-level ratios do not change with
--   later data because orders are dated (exception: Dobias COGS re-costed at
--   current product cost, audit I20, affects all methods equally).
--   Methods
--     B0  naive: actual GP365 per customer of the most recent cohort mature at F
--     A1  repeat-only multiplier, median of the last 6 mature non-Q4 cohorts
--     A2  same, ratio of sums of the last 12
--     P   production (294): median of the last 12 monthly (min 6) / 8
--         quarterly (min 3) non-Q4; Q4 cohorts use the same period last year
--     wu  P without references from the first 6 months of a market's history
--   metric 'gp' = product GP of costed customers; 'revenue' = net revenue of
--   all customers (informational, the only one possible for RawBark).
-- Steps 1 and 2 are the exact statements that produced the published tables.
-- =============================================================================

-- 1. Cohort table
CREATE OR REPLACE TABLE `oneeighty-warehouse.mart_qa.mk_bt_cohorts`
OPTIONS (description = 'QA only (Markets backtest, 2026-10-15): cohort-level first-order and repeat GP / revenue per customer at 30/60/90/180/365 days, monthly and quarterly grain, from mart_qa.mk_market_orders.')
AS
WITH
f AS (
  SELECT client_id, customer_key, first_order_market AS market, first_order_date AS d
  FROM `oneeighty-warehouse.mart_qa.mk_market_orders` WHERE is_new_customer
),
pc AS (
  SELECT f.client_id, f.market, f.d, f.customer_key,
    LOGICAL_AND(IF(o.order_date < DATE_ADD(f.d, INTERVAL 365 DAY), o.gross_profit IS NOT NULL, TRUE)) AS costed,
    SUM(IF(o.is_new_customer, o.gross_profit, 0)) AS first_gp,
    SUM(IF(o.is_new_customer, o.net_revenue, 0)) AS first_rev,
    SUM(IF(NOT o.is_new_customer AND o.order_date < DATE_ADD(f.d, INTERVAL 30 DAY),  o.gross_profit, 0)) AS rg30,
    SUM(IF(NOT o.is_new_customer AND o.order_date < DATE_ADD(f.d, INTERVAL 60 DAY),  o.gross_profit, 0)) AS rg60,
    SUM(IF(NOT o.is_new_customer AND o.order_date < DATE_ADD(f.d, INTERVAL 90 DAY),  o.gross_profit, 0)) AS rg90,
    SUM(IF(NOT o.is_new_customer AND o.order_date < DATE_ADD(f.d, INTERVAL 180 DAY), o.gross_profit, 0)) AS rg180,
    SUM(IF(NOT o.is_new_customer AND o.order_date < DATE_ADD(f.d, INTERVAL 365 DAY), o.gross_profit, 0)) AS rg365,
    SUM(IF(NOT o.is_new_customer AND o.order_date < DATE_ADD(f.d, INTERVAL 30 DAY),  o.net_revenue, 0)) AS rr30,
    SUM(IF(NOT o.is_new_customer AND o.order_date < DATE_ADD(f.d, INTERVAL 60 DAY),  o.net_revenue, 0)) AS rr60,
    SUM(IF(NOT o.is_new_customer AND o.order_date < DATE_ADD(f.d, INTERVAL 90 DAY),  o.net_revenue, 0)) AS rr90,
    SUM(IF(NOT o.is_new_customer AND o.order_date < DATE_ADD(f.d, INTERVAL 180 DAY), o.net_revenue, 0)) AS rr180,
    SUM(IF(NOT o.is_new_customer AND o.order_date < DATE_ADD(f.d, INTERVAL 365 DAY), o.net_revenue, 0)) AS rr365
  FROM f JOIN `oneeighty-warehouse.mart_qa.mk_market_orders` o
    ON o.client_id = f.client_id AND o.customer_key = f.customer_key
  GROUP BY f.client_id, f.market, f.d, f.customer_key
),
g AS (
  SELECT 'month' AS grain, DATE_TRUNC(d, MONTH) AS cohort, LAST_DAY(d, MONTH) AS cohort_end, pc.* FROM pc
  UNION ALL
  SELECT 'quarter', DATE_TRUNC(d, QUARTER), LAST_DAY(d, QUARTER), pc.* FROM pc
),
mm AS (
  SELECT grain, cohort, cohort_end, client_id, market, 'gp' AS metric_name,
    first_gp AS first_v, rg30 AS r30, rg60 AS r60, rg90 AS r90, rg180 AS r180, rg365 AS r365
  FROM g WHERE costed
  UNION ALL
  SELECT grain, cohort, cohort_end, client_id, market, 'revenue',
    first_rev, rr30, rr60, rr90, rr180, rr365
  FROM g WHERE first_rev IS NOT NULL
)
SELECT client_id, market, metric_name AS metric, grain, cohort, cohort_end,
  COUNT(*) AS customers,
  AVG(first_v) AS first_pc,
  AVG(r30) AS r30, AVG(r60) AS r60, AVG(r90) AS r90, AVG(r180) AS r180, AVG(r365) AS r365,
  STDDEV_SAMP(r30) AS sd30, STDDEV_SAMP(r60) AS sd60, STDDEV_SAMP(r90) AS sd90, STDDEV_SAMP(r180) AS sd180
FROM mm
GROUP BY client_id, market, metric_name, grain, cohort, cohort_end;

-- 2. Predictions at every freeze date
CREATE OR REPLACE TABLE `oneeighty-warehouse.mart_qa.mk_bt_predictions`
OPTIONS (description = 'QA only (Markets backtest, 2026-10-15): predicted vs actual 365 d GP (or revenue) per customer for cohorts Jan 2024 to Sep 2025, frozen at cohort end + N - 1. Methods: B0 naive, A1 median last 6, A2 ratio of sums last 12, P production rule of 294 (wu = refs from the first 6 months of a market history excluded).')
AS
WITH
hist AS (
  SELECT client_id, market, metric, grain, MIN(cohort) AS hist_start
  FROM `oneeighty-warehouse.mart_qa.mk_bt_cohorts` WHERE grain = 'month' AND customers >= 5
  GROUP BY 1, 2, 3, 4
),
cn AS (
  SELECT c.client_id, c.market, c.metric, c.grain, c.cohort, c.cohort_end, c.customers, c.first_pc, n,
    CASE n WHEN 30 THEN c.r30 WHEN 60 THEN c.r60 WHEN 90 THEN c.r90 WHEN 180 THEN c.r180 END AS rn_v,
    CASE n WHEN 30 THEN c.sd30 WHEN 60 THEN c.sd60 WHEN 90 THEN c.sd90 WHEN 180 THEN c.sd180 END AS sd_v,
    c.r365, c.first_pc + c.r365 AS actual365,
    (c.grain = 'month' AND EXTRACT(MONTH FROM c.cohort) IN (11, 12))
      OR (c.grain = 'quarter' AND EXTRACT(QUARTER FROM c.cohort) = 4) AS is_q4,
    c.cohort < DATE_ADD(h.hist_start, INTERVAL 6 MONTH) AS is_warmup
  FROM `oneeighty-warehouse.mart_qa.mk_bt_cohorts` c
  JOIN hist h ON h.client_id = c.client_id AND h.market = c.market AND h.metric = c.metric
  , UNNEST([30, 60, 90, 180]) AS n
  WHERE c.market != 'OTHER' AND c.client_id != 'venev'
),
targets AS (
  SELECT * FROM cn
  WHERE cohort BETWEEN '2024-01-01' AND '2025-09-01'
    AND DATE_ADD(cohort_end, INTERVAL 364 DAY) <= '2026-10-14'
),
pairs AS (
  SELECT t.client_id, t.market, t.metric, t.grain, t.cohort, t.n,
    r.cohort AS r_cohort, r.is_q4 AS r_q4, r.is_warmup AS r_wu, r.rn_v AS r_rn, r.r365 AS r_r365,
    r.customers AS r_cust, r.actual365 AS r_actual,
    CAST(SAFE_DIVIDE(r.r365, r.rn_v) AS FLOAT64) AS ratio
  FROM targets t
  JOIN cn r
    ON r.client_id = t.client_id AND r.market = t.market AND r.metric = t.metric
   AND r.grain = t.grain AND r.n = t.n
   AND DATE_ADD(r.cohort_end, INTERVAL 364 DAY) <= DATE_ADD(t.cohort_end, INTERVAL t.n - 1 DAY)
),
b0 AS (
  SELECT client_id, market, metric, grain, cohort, n,
    ARRAY_AGG(r_actual ORDER BY r_cohort DESC LIMIT 1)[OFFSET(0)] AS pred_b0
  FROM pairs GROUP BY 1, 2, 3, 4, 5, 6
),
ly AS (
  SELECT client_id, market, metric, grain, cohort, n, ratio AS ratio_ly
  FROM pairs WHERE r_cohort = DATE_SUB(cohort, INTERVAL 1 YEAR) AND r_rn > 0
),
ranked AS (
  SELECT p.*,
    ROW_NUMBER() OVER (PARTITION BY client_id, market, metric, grain, cohort, n ORDER BY r_cohort DESC) AS rk
  FROM pairs p WHERE NOT r_q4 AND r_rn > 0
),
ranked_wu AS (
  SELECT p.*,
    ROW_NUMBER() OVER (PARTITION BY client_id, market, metric, grain, cohort, n ORDER BY r_cohort DESC) AS rk
  FROM pairs p WHERE NOT r_q4 AND r_rn > 0 AND NOT r_wu
),
w_prod AS (
  SELECT client_id, market, metric, grain, cohort, n,
    PERCENTILE_CONT(ratio, 0.5) OVER w AS med, PERCENTILE_CONT(ratio, 0.1) OVER w AS p10,
    PERCENTILE_CONT(ratio, 0.9) OVER w AS p90, PERCENTILE_CONT(ratio, 0.25) OVER w AS p25,
    PERCENTILE_CONT(ratio, 0.75) OVER w AS p75, COUNT(*) OVER w AS n_ref,
    SUM(r_r365 * r_cust) OVER w / SUM(r_rn * r_cust) OVER w AS ros
  FROM ranked WHERE rk <= IF(grain = 'month', 12, 8)
  WINDOW w AS (PARTITION BY client_id, market, metric, grain, cohort, n)
),
prod AS (
  SELECT client_id, market, metric, grain, cohort, n,
    ANY_VALUE(med) AS med, ANY_VALUE(p10) AS p10, ANY_VALUE(p90) AS p90,
    ANY_VALUE(p25) AS p25, ANY_VALUE(p75) AS p75, ANY_VALUE(n_ref) AS n_ref,
    CAST(ANY_VALUE(ros) AS FLOAT64) AS ros
  FROM w_prod GROUP BY 1, 2, 3, 4, 5, 6
),
w_wu AS (
  SELECT client_id, market, metric, grain, cohort, n,
    PERCENTILE_CONT(ratio, 0.5) OVER w AS med_wu, COUNT(*) OVER w AS n_ref_wu
  FROM ranked_wu WHERE rk <= IF(grain = 'month', 12, 8)
  WINDOW w AS (PARTITION BY client_id, market, metric, grain, cohort, n)
),
wu AS (
  SELECT client_id, market, metric, grain, cohort, n, ANY_VALUE(med_wu) AS med_wu, ANY_VALUE(n_ref_wu) AS n_ref_wu
  FROM w_wu GROUP BY 1, 2, 3, 4, 5, 6
),
w_a1 AS (
  SELECT client_id, market, metric, grain, cohort, n,
    PERCENTILE_CONT(ratio, 0.5) OVER w AS med6
  FROM ranked WHERE rk <= 6
  WINDOW w AS (PARTITION BY client_id, market, metric, grain, cohort, n)
),
a1 AS (
  SELECT client_id, market, metric, grain, cohort, n, ANY_VALUE(med6) AS med6
  FROM w_a1 GROUP BY 1, 2, 3, 4, 5, 6
)
SELECT
  t.client_id, t.market, t.metric, t.grain, t.cohort, t.n, t.is_q4, t.customers,
  CAST(t.first_pc AS FLOAT64) AS first_pc, CAST(t.rn_v AS FLOAT64) AS rn_pc,
  IFNULL(t.sd_v, 0) / SQRT(t.customers) AS se,
  CAST(t.actual365 AS FLOAT64) AS actual,
  CAST(b0.pred_b0 AS FLOAT64) AS pred_b0,
  CAST(t.first_pc AS FLOAT64) + CAST(t.rn_v AS FLOAT64) * a1.med6 AS pred_a1,
  CAST(t.first_pc AS FLOAT64) + CAST(t.rn_v AS FLOAT64) * p.ros AS pred_a2,
  p.n_ref, p.med, p.p10, p.p90, p.p25, p.p75, ly.ratio_ly,
  CASE
    WHEN t.is_q4 AND ly.ratio_ly IS NOT NULL AND p.med > 0 THEN ly.ratio_ly
    WHEN NOT t.is_q4 AND p.n_ref >= IF(t.grain = 'month', 6, 3) THEN p.med
  END AS m_p,
  CASE
    WHEN t.is_q4 AND ly.ratio_ly IS NOT NULL AND wu.med_wu > 0 THEN ly.ratio_ly
    WHEN NOT t.is_q4 AND wu.n_ref_wu >= IF(t.grain = 'month', 6, 3) THEN wu.med_wu
  END AS m_wu
FROM targets t
LEFT JOIN b0 USING (client_id, market, metric, grain, cohort, n)
LEFT JOIN a1 USING (client_id, market, metric, grain, cohort, n)
LEFT JOIN prod p USING (client_id, market, metric, grain, cohort, n)
LEFT JOIN wu USING (client_id, market, metric, grain, cohort, n)
LEFT JOIN ly USING (client_id, market, metric, grain, cohort, n);

-- 3. Metrics per client x market x metric x grain x N
--    band1 = P10..P90 curve + 1.28 SE (research draft), band2 = P25..P75 + 1.28 SE,
--    band3 = P10..P90 curve only. 294 ships P25..P75 + 0.84 SE (step 4).
WITH x AS (
  SELECT *, first_pc + rn_pc * m_p AS pred_p, first_pc + rn_pc * m_wu AS pred_wu,
    SAFE_DIVIDE(m_p, med) AS sc
  FROM `oneeighty-warehouse.mart_qa.mk_bt_predictions` WHERE m_p IS NOT NULL AND actual > 0
), y AS (
  SELECT *,
    first_pc + GREATEST(rn_pc - 1.2816 * se, 0) * p10 * sc AS lo1, first_pc + (rn_pc + 1.2816 * se) * p90 * sc AS hi1,
    first_pc + GREATEST(rn_pc - 0.84 * se, 0) * p25 * sc AS lo_s, first_pc + (rn_pc + 0.84 * se) * p75 * sc AS hi_s,
    first_pc + rn_pc * p10 * sc AS lo3, first_pc + rn_pc * p90 * sc AS hi3
  FROM x)
SELECT client_id, market, metric, grain, n, COUNT(*) AS k, COUNTIF(is_q4) AS q4, MIN(n_ref) AS min_ref,
  ROUND(100 * AVG(ABS(pred_p - actual) / actual), 1) AS mape_p,
  ROUND(100 * APPROX_QUANTILES(ABS(pred_p - actual) / actual, 2)[OFFSET(1)], 1) AS mdape_p,
  ROUND(100 * AVG((pred_p - actual) / actual), 1) AS bias_p,
  ROUND(100 * AVG(ABS(pred_b0 - actual) / actual), 1) AS mape_b0,
  ROUND(100 * AVG((pred_b0 - actual) / actual), 1) AS bias_b0,
  ROUND(100 * AVG(ABS(pred_a1 - actual) / actual), 1) AS mape_a1,
  ROUND(100 * AVG(ABS(pred_a2 - actual) / actual), 1) AS mape_a2,
  ROUND(100 * AVG(ABS(pred_wu - actual) / actual), 1) AS mape_wu,
  ROUND(100 * COUNTIF(actual BETWEEN lo1 AND hi1) / COUNT(*)) AS cov_band1,
  ROUND(100 * COUNTIF(actual BETWEEN lo_s AND hi_s) / COUNT(*)) AS cov_shipped,
  ROUND(100 * AVG((hi_s - lo_s) / pred_p)) AS width_shipped_pct,
  ROUND(100 * COUNTIF(actual BETWEEN lo3 AND hi3) / COUNT(*)) AS cov_band3,
  ROUND(100 * AVG(IF(is_q4, ABS(pred_p - actual) / actual, NULL)), 1) AS mape_p_q4,
  ROUND(100 * AVG(IF(is_q4, ABS(pred_a1 - actual) / actual, NULL)), 1) AS mape_a1_q4
FROM y
GROUP BY 1, 2, 3, 4, 5
ORDER BY 1, 2, 3, 4, 5;
