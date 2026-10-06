-- =============================================================================
-- 271_plan_targets.sql
-- Promo pacing (package pp1), step 2 of 4: valid monthly targets.
--
-- Purpose
--   mart.plan_targets: one row per client x month x metric (revenue, orders,
--   new_customers, ad_spend) with the current and the original plan value.
--   revenue = net revenue ex VAT, ex shipping, after refunds (see 273 header).
--
-- Rules
--   * Valid = status approved or done (mart.plan_input.is_valid).
--   * Month task present: its value is the target (source 'month_task'). Two valid Month
--     tasks for one month: the latest version_at wins (mart.plan_checks reports it).
--   * Month missing but its Quarter task exists: the quarter remainder (quarter value minus
--     the explicit months, floored at 0) is split over the missing months by a shrunk
--     seasonal share (source 'quarter_split'):
--       f_m   = (LY_m + 25) / (LY_q * days_m / days_q + 25)   LY = store orders 12 months
--                                                             earlier, same months
--       share = days_m * f_m / sum over missing months (days * f)
--     With no history f_m = 1, i.e. a days share. ad_spend always uses the days share
--     (spend is a decision, not a forecast). Same kappa 25 as the daily curve.
--   * Original values come from the first approved version of the same task.
--
-- Based on live view: none (new object). Reads mart.plan_input (270), stg.stg_woo_orders.
-- Affected clients: clients with plan rows (ethia). Regression: not applicable (new).
-- Validation 2026-10-06: 16 rows (4 months x 4 metrics), all 'month_task'. Split rule
--   tested by dropping November and December: 127.8 / 147.2 orders, 147 319 / 169 681 Kč,
--   38 361 / 39 639 Kč ad spend (LY orders 93 / 110, f_m 0.982 / 1.094).
-- QA copy: mart_qa.pp1_plan_targets. Deploy order: 270, 271, 272, 273.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_targets` AS
WITH
p AS (
  SELECT * FROM `oneeighty-warehouse.mart.plan_input` WHERE is_valid
),
mon AS (
  SELECT * EXCEPT (rn) FROM (
    SELECT p.*, DATE_TRUNC(start_date, MONTH) AS month_start,
           ROW_NUMBER() OVER (PARTITION BY client_id, DATE_TRUNC(start_date, MONTH)
                              ORDER BY version_at DESC, task_id) AS rn
    FROM p WHERE level = 'Month' AND start_date IS NOT NULL)
  WHERE rn = 1
),
qtr AS (
  SELECT * FROM p WHERE level = 'Quarter' AND start_date IS NOT NULL AND end_date IS NOT NULL
),
q_months AS (
  SELECT q.client_id, q.task_id AS quarter_task_id, q.start_date AS q_start, q.end_date AS q_end,
         ms AS month_start
  FROM qtr q, UNNEST(GENERATE_DATE_ARRAY(DATE_TRUNC(q.start_date, MONTH), q.end_date, INTERVAL 1 MONTH)) AS ms
),
metric_rows AS (            -- unpivot a plan row into metrics (current, original)
  SELECT client_id, task_id, level, month_start, name, version, version_original, mer_cap_pct,
         m.metric, m.v, m.v0
  FROM (SELECT client_id, task_id, level, month_start, name, version, version_original, mer_cap_pct,
               target_revenue, orig_target_revenue, target_orders, orig_target_orders,
               target_new_customers, orig_target_new_customers, ad_budget, orig_ad_budget
        FROM mon
        UNION ALL
        SELECT client_id, task_id, level, CAST(NULL AS DATE), name, version, version_original, mer_cap_pct,
               target_revenue, orig_target_revenue, target_orders, orig_target_orders,
               target_new_customers, orig_target_new_customers, ad_budget, orig_ad_budget
        FROM qtr) t,
  UNNEST([
    STRUCT('revenue' AS metric, CAST(t.target_revenue AS FLOAT64) AS v, CAST(t.orig_target_revenue AS FLOAT64) AS v0),
    STRUCT('orders', CAST(t.target_orders AS FLOAT64), CAST(t.orig_target_orders AS FLOAT64)),
    STRUCT('new_customers', CAST(t.target_new_customers AS FLOAT64), CAST(t.orig_target_new_customers AS FLOAT64)),
    STRUCT('ad_spend', CAST(t.ad_budget AS FLOAT64), CAST(t.orig_ad_budget AS FLOAT64))
  ]) AS m
),
explicit AS (
  SELECT r.client_id, r.month_start, r.metric, r.v, r.v0, r.task_id, r.name, r.version,
         r.version_original, r.mer_cap_pct, qm.quarter_task_id
  FROM metric_rows r
  LEFT JOIN q_months qm ON qm.client_id = r.client_id AND qm.month_start = r.month_start
  WHERE r.level = 'Month'
),
-- quarter split for months without a Month task
missing AS (
  SELECT qm.* FROM q_months qm
  LEFT JOIN mon ON mon.client_id = qm.client_id AND mon.month_start = qm.month_start
  WHERE mon.task_id IS NULL
),
ly AS (                     -- store orders 12 months before each quarter month
  SELECT qm.client_id, qm.quarter_task_id, qm.month_start,
         DATE_DIFF(LAST_DAY(qm.month_start), qm.month_start, DAY) + 1 AS days_m,
         COUNT(DISTINCT o.order_id) AS ly_orders
  FROM q_months qm
  LEFT JOIN `oneeighty-warehouse.stg.stg_woo_orders` o
    ON o.client_id = qm.client_id AND o.total_price > 0
   AND DATE_TRUNC(o.order_date, MONTH) = DATE_SUB(qm.month_start, INTERVAL 12 MONTH)
  GROUP BY 1, 2, 3, 4
),
season AS (
  SELECT l.*,
         (l.ly_orders + 25) / (SUM(l.ly_orders) OVER q * l.days_m / SUM(l.days_m) OVER q + 25) AS f_m
  FROM ly l
  WINDOW q AS (PARTITION BY l.client_id, l.quarter_task_id)
),
miss_share AS (
  SELECT m.client_id, m.quarter_task_id, m.month_start,
         s.days_m * s.f_m / SUM(s.days_m * s.f_m) OVER w AS share_season,
         s.days_m / SUM(s.days_m) OVER w                  AS share_days
  FROM missing m
  JOIN season s USING (client_id, quarter_task_id, month_start)
  WINDOW w AS (PARTITION BY m.client_id, m.quarter_task_id)
),
explicit_q AS (
  SELECT client_id, quarter_task_id, metric, SUM(v) AS v, SUM(v0) AS v0
  FROM explicit WHERE quarter_task_id IS NOT NULL
  GROUP BY 1, 2, 3
),
q_remainder AS (
  SELECT q.client_id, q.task_id AS quarter_task_id, q.name, q.version, q.version_original,
         q.mer_cap_pct, q.metric,
         GREATEST(q.v  - IFNULL(e.v, 0), 0)  AS rem,
         GREATEST(q.v0 - IFNULL(e.v0, 0), 0) AS rem0
  FROM metric_rows q
  LEFT JOIN explicit_q e
    ON e.client_id = q.client_id AND e.quarter_task_id = q.task_id AND e.metric = q.metric
  WHERE q.level = 'Quarter'
),
split AS (
  SELECT s.client_id, s.month_start, r.metric,
         r.rem  * IF(r.metric = 'ad_spend', s.share_days, s.share_season) AS v,
         r.rem0 * IF(r.metric = 'ad_spend', s.share_days, s.share_season) AS v0,
         r.quarter_task_id AS task_id, FORMAT_DATE('%B %Y', s.month_start) AS name,
         r.version, r.version_original, r.mer_cap_pct, r.quarter_task_id
  FROM miss_share s
  JOIN q_remainder r USING (client_id, quarter_task_id)
)
SELECT
  client_id,
  month_start,
  LAST_DAY(month_start)                          AS month_end,
  metric,
  v                                              AS target_value,
  v0                                             AS target_value_original,
  v IS DISTINCT FROM v0                          AS is_changed,
  source,
  task_id,
  quarter_task_id,
  name                                           AS period_label,
  version,
  version_original,
  mer_cap_pct
FROM (
  SELECT client_id, month_start, metric, v, v0, 'month_task' AS source, task_id, quarter_task_id,
         name, version, version_original, mer_cap_pct
  FROM explicit
  UNION ALL
  SELECT client_id, month_start, metric, v, v0, 'quarter_split', task_id, quarter_task_id,
         name, version, version_original, mer_cap_pct
  FROM split
)
WHERE v IS NOT NULL;
