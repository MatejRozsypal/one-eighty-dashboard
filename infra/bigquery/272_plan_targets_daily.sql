-- =============================================================================
-- 272_plan_targets_daily.sql
-- Promo pacing (package pp1), step 3 of 4: the daily target curve.
--
-- Purpose
--   mart.plan_targets_daily: one row per client x date x metric with the day's weight,
--   the daily target and the cumulative target within the month and the quarter.
--
-- Change (additive)
--   NEW VIEW      mart.plan_targets_daily_v   the curve logic below.
--   NEW PROCEDURE mart.sp_refresh_plan_targets_daily()  rebuilds the table from the view
--                 via __next + ASSERTs (rows > 0, unique client/date/metric, every month
--                 sums to its target within 0.01) + COPY swap (253 pattern).
--   NEW TABLE     mart.plan_targets_daily  (view columns + refreshed_at), CLUSTER BY
--                 client_id, metric. Read by 273. Schedule the CALL hourly (ClickUp plan
--                 loads hourly; the fit window moves daily until a month starts).
--
-- Curve (projects/promo-pacing/raw/04 sections 1.3, 1.8: method M2 x promo windows)
--   w_d      = f_pay(d) x promo_mult(d) x f_cal(d)
--   target_d = T_month x w_d / sum of w over the month          (month total preserved)
--   f_pay    = (S + kappa) / (n_pay x r_nonpay + kappa) on days 10 to 16, else 1.
--              S = store orders on payday days, n_pay = payday days, r_nonpay = mean
--              orders on other days; all on non-promo days of the fit window.
--              Fit window per target month: the 365 days ending at fit_end =
--              LEAST(month_start - 1, as_of). Future months use today's trailing 365 days;
--              a month's curve is frozen once the month has started.
--              Non-promo = not in a coupon code window (code used 5+ times within at most
--              45 days, evergreen codes excluded) and not in a valid Promo window.
--   promo_mult = Day multiplier of the valid Promo window covering the day. Overlaps:
--              the SHORTEST covering window wins (ties: later start, then task id), so
--              long umbrella windows (F6 16. 11. to 17. 12., F9 to 8. 3.) never override
--              F3, F4, F5, F7. Empty multiplier = 1.0. All covering ids are kept in
--              overlapping_promo_task_ids and reported by mart.plan_checks.
--   f_cal      calendar override (CTE cal_overrides): Ethia 24. to 26. 12. = 0.1 (2025:
--              0 to 1 order a day, shop closed for delivery). Dated, set before the day.
--              Override days of past years are excluded from the payday fit.
--   w_d        = f_pay x promo_mult x f_cal.
--   revenue and new_customers follow the orders weights (aov_index = 1 in v1).
--   ad_spend is flat within the month (weight 1).
--
-- Parameters (CTE `params`, defaults for every client, per client overrides):
--   kappa 25, payday days 10 to 16, evergreen codes regex. Ethia: MUJPRVNI,
--   PRVNINAKUP10, ZNOVU10 (raw/04 1.7). Store orders: stg.stg_woo_orders only in v1.
--
-- Based on live view: none (new object). Reads mart.plan_targets (271),
--   mart.plan_input (270), stg.stg_woo_orders.
-- Affected clients: clients with plan rows (ethia). Regression: not applicable (new).
-- Validation 2026-10-06 (QA copy): every month and metric sums to its target within
--   1e-9; f_pay = 1.3756 (Oct 2026, fit 2025-10-01 to 2026-09-30), 1.3739 (Nov 2026
--   onwards, fit to 2026-10-05). raw/04 had 1.390; the difference is the 24. to 26. 12.
--   2025 exclusion (three near-zero non-payday days).
-- QA copy: mart_qa.pp1_plan_targets_daily. Deploy order: 270, 271, 272, 273.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_targets_daily_v` AS
WITH
months AS (
  SELECT DISTINCT client_id, month_start FROM `oneeighty-warehouse.mart.plan_targets`
),
params AS (
  SELECT c.client_id,
         IFNULL(o.kappa, 25.0)                      AS kappa,
         IFNULL(o.pay_from, 10)                     AS pay_from,
         IFNULL(o.pay_to, 16)                       AS pay_to,
         IFNULL(o.evergreen_codes, r'^$')           AS evergreen_codes
  FROM (SELECT DISTINCT client_id FROM months) c
  LEFT JOIN UNNEST([
    STRUCT('ethia' AS client_id, 25.0 AS kappa, 10 AS pay_from, 16 AS pay_to,
           r'^(MUJPRVNI|PRVNINAKUP10|ZNOVU10)$' AS evergreen_codes)
  ]) o ON o.client_id = c.client_id
),
orders AS (
  SELECT o.client_id, o.order_id, o.order_date AS d, o.coupon_codes, o.ingested_at
  FROM `oneeighty-warehouse.stg.stg_woo_orders` o
  JOIN params p ON p.client_id = o.client_id
  WHERE o.total_price > 0
),
as_of AS (                  -- yesterday (Prague), or the day before the last load
  SELECT client_id,
         LEAST(DATE_SUB(CURRENT_DATE('Europe/Prague'), INTERVAL 1 DAY),
               DATE_SUB(DATE(MAX(ingested_at), 'Europe/Prague'), INTERVAL 1 DAY)) AS as_of
  FROM orders GROUP BY client_id
),
daily_orders AS (
  SELECT client_id, d, COUNT(DISTINCT order_id) AS n FROM orders GROUP BY 1, 2
),
code_windows AS (
  SELECT o.client_id, UPPER(TRIM(c)) AS code, MIN(o.d) AS s, MAX(o.d) AS e
  FROM orders o
  JOIN params p ON p.client_id = o.client_id,
  UNNEST(JSON_VALUE_ARRAY(o.coupon_codes)) AS c
  WHERE TRIM(c) != '' AND NOT REGEXP_CONTAINS(UPPER(TRIM(c)), p.evergreen_codes)
  GROUP BY 1, 2
  HAVING COUNT(DISTINCT o.order_id) >= 5 AND DATE_DIFF(MAX(o.d), MIN(o.d), DAY) <= 45
),
cal_overrides AS (          -- f_cal: dated calendar overrides (move to a ref table when more appear)
  SELECT * FROM UNNEST([
    STRUCT('ethia' AS client_id, DATE '2025-12-24' AS d0, DATE '2025-12-26' AS d1, 0.1 AS f_cal,
           'Christmas, no delivery (history, fit exclusion)' AS reason),
    STRUCT('ethia', DATE '2026-12-24', DATE '2026-12-26', 0.1, 'Christmas, no delivery')
  ])
),
cal_override_days AS (
  SELECT client_id, d, MIN(f_cal) AS f_cal
  FROM cal_overrides, UNNEST(GENERATE_DATE_ARRAY(d0, d1)) AS d
  GROUP BY 1, 2
),
promos AS (
  SELECT client_id, task_id, name, start_date, end_date, day_multiplier
  FROM `oneeighty-warehouse.mart.plan_input`
  WHERE level = 'Promo' AND is_valid AND start_date IS NOT NULL AND end_date IS NOT NULL
),
promo_days AS (
  SELECT DISTINCT client_id, d FROM (
    SELECT client_id, d FROM code_windows, UNNEST(GENERATE_DATE_ARRAY(s, e)) AS d
    UNION ALL
    SELECT client_id, d FROM promos, UNNEST(GENERATE_DATE_ARRAY(start_date, end_date)) AS d
    UNION ALL
    SELECT client_id, d FROM cal_override_days)
),
fit_days AS (
  SELECT m.client_id, m.month_start, d,
         EXTRACT(DAY FROM d) BETWEEN p.pay_from AND p.pay_to AS is_pay,
         IFNULL(x.n, 0) AS n
  FROM months m
  JOIN params p ON p.client_id = m.client_id
  JOIN as_of a  ON a.client_id = m.client_id,
  UNNEST(GENERATE_DATE_ARRAY(
           DATE_SUB(LEAST(DATE_SUB(m.month_start, INTERVAL 1 DAY), a.as_of), INTERVAL 364 DAY),
           LEAST(DATE_SUB(m.month_start, INTERVAL 1 DAY), a.as_of))) AS d
  LEFT JOIN daily_orders x ON x.client_id = m.client_id AND x.d = d
  LEFT JOIN promo_days pd  ON pd.client_id = m.client_id AND pd.d = d
  WHERE pd.d IS NULL
),
pay_factor AS (
  SELECT f.client_id, f.month_start,
         MIN(f.d) AS fit_from, MAX(f.d) AS fit_to,
         IFNULL(SAFE_DIVIDE(SUM(IF(f.is_pay, f.n, 0)) + ANY_VALUE(p.kappa),
                            COUNTIF(f.is_pay) * AVG(IF(f.is_pay, NULL, f.n)) + ANY_VALUE(p.kappa)), 1.0) AS f_pay
  FROM fit_days f JOIN params p ON p.client_id = f.client_id
  GROUP BY 1, 2
),
cal AS (
  SELECT m.client_id, m.month_start, d AS date,
         EXTRACT(DAY FROM d) BETWEEN p.pay_from AND p.pay_to AS is_payday
  FROM months m
  JOIN params p ON p.client_id = m.client_id,
  UNNEST(GENERATE_DATE_ARRAY(m.month_start, LAST_DAY(m.month_start))) AS d
),
day_promo AS (               -- shortest covering window wins; empty multiplier = 1.0
  SELECT c.client_id, c.date,
         ARRAY_AGG(IF(pr.task_id IS NULL, NULL,
                      STRUCT(pr.task_id AS task_id, IFNULL(pr.day_multiplier, 1.0) AS mult)) IGNORE NULLS
                   ORDER BY DATE_DIFF(pr.end_date, pr.start_date, DAY), pr.start_date DESC, pr.task_id
                   LIMIT 1)[SAFE_OFFSET(0)] AS winner,
         ARRAY_AGG(pr.task_id IGNORE NULLS ORDER BY pr.start_date, pr.task_id) AS overlapping_promo_task_ids
  FROM cal c
  LEFT JOIN promos pr
    ON pr.client_id = c.client_id AND c.date BETWEEN pr.start_date AND pr.end_date
  GROUP BY 1, 2
),
w AS (
  SELECT c.client_id, c.month_start, c.date, c.is_payday,
         pf.f_pay AS payday_factor_month, pf.fit_from, pf.fit_to,
         IF(c.is_payday, IFNULL(pf.f_pay, 1.0), 1.0) AS f_pay_day,
         dp.winner.mult AS promo_mult, dp.winner.task_id AS promo_task_id, dp.overlapping_promo_task_ids,
         IFNULL(co.f_cal, 1.0) AS f_cal,
         IF(c.is_payday, IFNULL(pf.f_pay, 1.0), 1.0) * IFNULL(dp.winner.mult, 1.0) * IFNULL(co.f_cal, 1.0) AS w_orders
  FROM cal c
  LEFT JOIN pay_factor pf ON pf.client_id = c.client_id AND pf.month_start = c.month_start
  LEFT JOIN day_promo dp  ON dp.client_id = c.client_id AND dp.date = c.date
  LEFT JOIN cal_override_days co ON co.client_id = c.client_id AND co.d = c.date
),
wm AS (
  SELECT w.*, t.metric, t.target_value AS target_month, t.task_id AS month_task_id,
         t.period_label AS month_label, t.mer_cap_pct AS month_mer_cap_pct,
         t.source AS month_source, t.quarter_task_id,
         IF(t.metric = 'ad_spend', 1.0, w.w_orders) AS weight
  FROM w
  JOIN `oneeighty-warehouse.mart.plan_targets` t
    ON t.client_id = w.client_id AND t.month_start = w.month_start
),
td AS (
  SELECT wm.*,
         weight / SUM(weight) OVER mo                AS share_of_month,
         target_month * weight / SUM(weight) OVER mo AS target_daily
  FROM wm
  WINDOW mo AS (PARTITION BY client_id, metric, month_start)
)
SELECT
  client_id,
  date,
  month_start,
  DATE_TRUNC(date, QUARTER)                                         AS quarter_start,
  metric,
  weight,
  share_of_month,
  target_daily,
  SUM(target_daily) OVER (PARTITION BY client_id, metric, month_start ORDER BY date
                          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS target_cum_month,
  SUM(target_daily) OVER (PARTITION BY client_id, metric, DATE_TRUNC(date, QUARTER) ORDER BY date
                          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS target_cum_quarter,
  target_month,
  is_payday,
  f_pay_day,
  payday_factor_month,
  fit_from,
  fit_to,
  promo_mult,
  f_cal,
  promo_task_id,
  overlapping_promo_task_ids,
  IFNULL(ARRAY_LENGTH(overlapping_promo_task_ids), 0) > 1           AS has_promo_overlap,
  month_task_id,
  month_label,
  month_mer_cap_pct,
  month_source,
  quarter_task_id
FROM td;

-- Materialised copy. The view chain 270 > 271 > 272 inlines stg.stg_woo_orders several
-- times; stacking 273 on the view exceeds the BigQuery planning limit ("query is too
-- complex", measured 2026-10-06). The table is ~500 rows per client and month.
CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_plan_targets_daily`()
BEGIN
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_targets_daily__next`
  CLUSTER BY client_id, metric
  AS SELECT *, CURRENT_TIMESTAMP() AS refreshed_at
     FROM `oneeighty-warehouse.mart.plan_targets_daily_v`;

  ASSERT (SELECT COUNT(*) FROM `oneeighty-warehouse.mart.plan_targets_daily__next`) > 0
    AS 'plan_targets_daily: no rows';
  ASSERT NOT EXISTS (
    SELECT 1 FROM `oneeighty-warehouse.mart.plan_targets_daily__next`
    GROUP BY client_id, date, metric HAVING COUNT(*) > 1)
    AS 'plan_targets_daily: duplicate client_id, date, metric';
  ASSERT NOT EXISTS (
    SELECT 1 FROM `oneeighty-warehouse.mart.plan_targets_daily__next`
    GROUP BY client_id, month_start, metric
    HAVING ABS(SUM(target_daily) - ANY_VALUE(target_month)) > 0.01)
    AS 'plan_targets_daily: a month does not sum to its target';

  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_targets_daily`
  COPY `oneeighty-warehouse.mart.plan_targets_daily__next`;
  DROP TABLE `oneeighty-warehouse.mart.plan_targets_daily__next`;
END;

CALL `oneeighty-warehouse.mart.sp_refresh_plan_targets_daily`();
