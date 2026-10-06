-- =============================================================================
-- 279c_plan_layer_rewire.sql
-- Promo pacing (package pp1): every plan object reads the canonical actuals of 279b
-- instead of stg.stg_woo_orders / mart.mart_daily_kpis, so the layer runs for
-- WooCommerce, Shoptet and Shopify clients with one rule set.
--
-- Change (CREATE OR REPLACE of live objects, plus new columns, no column removed)
--   mart.plan_targets            seasonal split: LY orders from mart.plan_actuals_daily
--   mart.plan_targets_daily_v    payday fit, code windows and as_of from plan_actuals_daily;
--                                NEW column baseline_daily = target_d / promo_mult_d (curve
--                                without the promo multiplier, same month normaliser)
--   mart.plan_pacing_v           actuals from plan_actuals_daily; Manami params (phi 1.17,
--                                CV 0.74, estimated like raw/04 1.8, Oct 2025 to Sep 2026);
--                                NEW metric 'units' on Checkpoint rows with Target units +
--                                SKUs (non-gift lines matching the SKUs, Start..LEAST(Due,
--                                as_of)); NEW columns baseline_total, baseline_to_date,
--                                lift_vs_baseline_pct on promo rows
--   mart.plan_promo_orders_v     pp2 logic (274 to 276) on mart.plan_orders /
--   mart.plan_promo_perf_v       plan_order_lines / plan_actuals_daily; gift = unit price < 1
--   mart.plan_promo_orders,      were views (~404 MB per read), now TABLES refreshed by
--   mart.plan_promo_perf         mart.sp_refresh_plan_pacing() (same columns + refreshed_at)
--   mart.sp_refresh_plan_pacing  now: plan_input (279a) -> actuals (279b) -> targets_daily -> pacing -> promo
--                                orders -> promo perf, each __next + ASSERT + COPY swap
--   mart.plan_checks             Checkpoint with Target units counts as a threshold; units
--                                without SKUs flagged
--
-- Based on live views 2026-10-06 (271 to 273 as deployed from this branch, 274 to 276 by
--   pp2: plan_promo_orders, plan_promo_perf read from INFORMATION_SCHEMA).
-- Affected clients: ethia (only client with plan rows in prod). Regression (QA copies vs
--   prod, EXCEPT DISTINCT both ways): see raw/06 section 9. Every Ethia change is listed.
-- Deploy order: 277 (sections 1 and 2), 279a, 279b, 279c. Then schedule CALL mart.sp_refresh_plan_pacing() hourly.
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
ly AS (                     -- store orders 12 months before each quarter month (canonical)
  SELECT qm.client_id, qm.quarter_task_id, qm.month_start,
         DATE_DIFF(LAST_DAY(qm.month_start), qm.month_start, DAY) + 1 AS days_m,
         IFNULL(SUM(a.orders), 0) AS ly_orders
  FROM q_months qm
  LEFT JOIN `oneeighty-warehouse.mart.plan_actuals_daily` a
    ON a.client_id = qm.client_id
   AND DATE_TRUNC(a.date, MONTH) = DATE_SUB(qm.month_start, INTERVAL 12 MONTH)
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

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_targets_daily_v` AS
WITH
months AS (
  SELECT DISTINCT client_id, month_start FROM `oneeighty-warehouse.mart.plan_targets`
),
params AS (
  SELECT c.client_id,
         IFNULL(o.kappa, 25.0)                      AS kappa,
         IFNULL(o.pay_from, 10)                     AS pay_from,
         IFNULL(o.pay_to, 16)                       AS pay_to
  FROM (SELECT DISTINCT client_id FROM months) c
  LEFT JOIN UNNEST([
    STRUCT('ethia' AS client_id, 25.0 AS kappa, 10 AS pay_from, 16 AS pay_to)
  ]) o ON o.client_id = c.client_id
),
act AS (                    -- canonical daily actuals (279b), zero-filled
  SELECT a.client_id, a.date, a.orders, a.is_code_window, a.as_of
  FROM `oneeighty-warehouse.mart.plan_actuals_daily` a
  JOIN params p ON p.client_id = a.client_id
),
as_of AS (
  SELECT client_id, ANY_VALUE(as_of) AS as_of FROM act GROUP BY client_id
),
daily_orders AS (
  SELECT client_id, date AS d, orders AS n FROM act
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
    SELECT client_id, date AS d FROM act WHERE is_code_window
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
         target_month * weight / SUM(weight) OVER mo AS target_daily,
         -- curve without the promo multiplier, same normaliser (baseline for lift)
         target_month * weight / IFNULL(promo_mult, 1.0) / SUM(weight) OVER mo AS baseline_daily
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
  IF(metric = 'ad_spend', target_daily, baseline_daily)           AS baseline_daily,
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


-- Rebuild the curve table now, so plan_pacing_v can see the new baseline_daily column.
CALL `oneeighty-warehouse.mart.sp_refresh_plan_targets_daily`();

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_pacing_v` AS
WITH
td AS (
  SELECT * FROM `oneeighty-warehouse.mart.plan_targets_daily`
),
clients AS (SELECT DISTINCT client_id FROM td),
params AS (
  SELECT c.client_id,
         IFNULL(o.phi, 1.5) AS phi, IFNULL(o.cv, 0.5) AS cv, IFNULL(o.k, 30.0) AS k
  FROM clients c
  LEFT JOIN UNNEST([STRUCT('ethia' AS client_id, 1.48 AS phi, 0.52 AS cv, 30.0 AS k),
                    STRUCT('manami', 1.17, 0.74, 30.0)]) o
    ON o.client_id = c.client_id
),
act AS (                    -- canonical daily actuals (279b)
  SELECT a.client_id, a.date AS d, a.orders, a.revenue, a.new_customers, a.meta_spend AS ad_spend, a.as_of
  FROM `oneeighty-warehouse.mart.plan_actuals_daily` a
  JOIN clients c ON c.client_id = a.client_id
),
as_of AS (
  SELECT client_id, ANY_VALUE(as_of) AS as_of FROM act GROUP BY client_id
),
hist AS (                    -- trailing 365-day AOV: noise scale when a period has no orders target
  SELECT a.client_id, SAFE_DIVIDE(SUM(a.revenue), SUM(a.orders)) AS aov_hist
  FROM act a JOIN as_of x USING (client_id)
  WHERE a.d > DATE_SUB(x.as_of, INTERVAL 365 DAY)
  GROUP BY 1
),
-- one row per client x day with targets, wide
base AS (
  SELECT t.client_id, t.date, a.as_of,
         SUM(IF(t.metric = 'orders',        t.target_daily, 0)) AS t_orders,
         SUM(IF(t.metric = 'revenue',       t.target_daily, 0)) AS t_revenue,
         SUM(IF(t.metric = 'new_customers', t.target_daily, 0)) AS t_new,
         SUM(IF(t.metric = 'ad_spend',      t.target_daily, 0)) AS t_spend,
         SUM(IF(t.metric = 'orders',        t.baseline_daily, 0)) AS b_orders,
         SUM(IF(t.metric = 'revenue',       t.baseline_daily, 0)) AS b_revenue,
         SUM(IF(t.metric = 'new_customers', t.baseline_daily, 0)) AS b_new,
         LOGICAL_OR(t.metric = 'orders')        AS has_orders,
         LOGICAL_OR(t.metric = 'revenue')       AS has_revenue,
         LOGICAL_OR(t.metric = 'new_customers') AS has_new,
         LOGICAL_OR(t.metric = 'ad_spend')      AS has_spend
  FROM td t JOIN as_of a ON a.client_id = t.client_id
  GROUP BY 1, 2, 3
),
base_act AS (
  SELECT b.*,
         b.date <= b.as_of AS is_elapsed,
         IF(b.date <= b.as_of, IFNULL(o.orders, 0), NULL)        AS a_orders,
         IF(b.date <= b.as_of, IFNULL(o.revenue, 0), NULL)       AS a_revenue,
         IF(b.date <= b.as_of, IFNULL(o.new_customers, 0), NULL) AS a_new,
         IF(b.date <= b.as_of, IFNULL(s.ad_spend, 0), NULL)      AS a_spend
  FROM base b
  LEFT JOIN act o ON o.client_id = b.client_id AND o.d = b.date
  LEFT JOIN act s ON s.client_id = b.client_id AND s.d = b.date
),
plan AS (
  SELECT * FROM `oneeighty-warehouse.mart.plan_input`
  WHERE start_date IS NOT NULL OR level = 'Checkpoint'
),
gate_keys AS (               -- Checkpoint SKUs, same matching as promo attribution
  SELECT p.client_id, p.task_id,
         COALESCE(p.start_date, DATE_TRUNC(p.end_date, QUARTER)) AS g_start, p.end_date AS g_end,
         ARRAY(SELECT UPPER(TRIM(x)) FROM UNNEST(SPLIT(p.skus, ',')) x WHERE TRIM(x) != '') AS sku_keys
  FROM plan p
  WHERE p.level = 'Checkpoint' AND p.is_valid AND p.target_units IS NOT NULL AND p.skus IS NOT NULL
),
gate_units AS (              -- product units (gift lines < 1 per unit excluded) in Start..LEAST(Due, as_of)
  SELECT g.client_id, g.task_id, SUM(l.quantity) AS units
  FROM gate_keys g
  JOIN as_of a ON a.client_id = g.client_id
  JOIN `oneeighty-warehouse.mart.plan_order_lines` l
    ON l.client_id = g.client_id AND l.order_date BETWEEN g.g_start AND LEAST(g.g_end, a.as_of)
  WHERE NOT l.is_gift
    AND EXISTS (SELECT 1 FROM UNNEST(g.sku_keys) pk, UNNEST(l.line_keys) lk
                WHERE lk = pk OR (ENDS_WITH(pk, '*') AND STARTS_WITH(lk, RTRIM(pk, '*'))))
  GROUP BY 1, 2
),
-- period definitions: id, label, defined start / end, task, thresholds
periods AS (
  SELECT DISTINCT client_id, 'day' AS period_type, FORMAT_DATE('%F', date) AS period_id,
         FORMAT_DATE('%a %e %b %Y', date) AS period_label, date AS p_start, date AS p_end,
         CAST(NULL AS STRING) AS task_id, CAST(NULL AS STRING) AS plan_status, CAST(NULL AS FLOAT64) AS mer_cap_pct,
         CAST(NULL AS FLOAT64) AS thr_orders, CAST(NULL AS FLOAT64) AS thr_revenue, CAST(NULL AS FLOAT64) AS thr_new,
         CAST(NULL AS FLOAT64) AS attr_orders_target, CAST(NULL AS FLOAT64) AS attr_new_target,
         CAST(NULL AS FLOAT64) AS attr_revenue_target,
         CAST(NULL AS FLOAT64) AS thr_units
  FROM base
  UNION ALL
  SELECT DISTINCT client_id, 'week', FORMAT_DATE('%G-W%V', date), FORMAT_DATE('Week %V %G', date),
         DATE_TRUNC(date, ISOWEEK), DATE_ADD(DATE_TRUNC(date, ISOWEEK), INTERVAL 6 DAY),
         CAST(NULL AS STRING), CAST(NULL AS STRING), CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64)
  FROM base
  UNION ALL
  SELECT client_id, 'month', FORMAT_DATE('%Y-%m', month_start), ANY_VALUE(month_label),
         month_start, LAST_DAY(month_start), ANY_VALUE(month_task_id), 'approved', ANY_VALUE(month_mer_cap_pct),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64)
  FROM td
  GROUP BY client_id, month_start
  UNION ALL
  SELECT client_id, 'quarter', FORMAT_DATE('%Y-Q%Q', start_date), name, start_date, end_date,
         task_id, status, mer_cap_pct, CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64)
  FROM plan WHERE level = 'Quarter' AND is_valid
  UNION ALL
  SELECT client_id, 'promo', task_id, name, start_date, end_date, task_id, status, mer_cap_pct,
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64),
         CAST(target_orders AS FLOAT64), CAST(target_new_customers AS FLOAT64), CAST(target_revenue AS FLOAT64),
         CAST(NULL AS FLOAT64)
  FROM plan WHERE level = 'Promo' AND (is_valid OR status = 'planning') AND end_date IS NOT NULL
  UNION ALL
  SELECT client_id, 'gate', task_id, name,
         COALESCE(start_date, DATE_TRUNC(end_date, QUARTER)),
         end_date,
         task_id, status, mer_cap_pct,
         CAST(target_orders AS FLOAT64), CAST(target_revenue AS FLOAT64), CAST(target_new_customers AS FLOAT64),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64),
         IF(skus IS NOT NULL, CAST(target_units AS FLOAT64), NULL)
  FROM plan WHERE level = 'Checkpoint' AND is_valid AND end_date IS NOT NULL
),
agg AS (
  SELECT p.client_id, p.period_type, p.period_id, p.period_label, p.p_start, p.p_end, p.task_id,
         p.plan_status, p.mer_cap_pct, p.thr_orders, p.thr_revenue, p.thr_new,
         p.attr_orders_target, p.attr_new_target, p.attr_revenue_target, p.thr_units,
         ANY_VALUE(b.as_of) AS as_of,
         COUNT(b.date) AS target_days,
         SUM(b.t_orders) AS t_orders, SUM(b.t_revenue) AS t_revenue, SUM(b.t_new) AS t_new, SUM(b.t_spend) AS t_spend,
         SUM(IF(b.is_elapsed, b.t_orders, 0))  AS ct_orders,
         SUM(IF(b.is_elapsed, b.t_revenue, 0)) AS ct_revenue,
         SUM(IF(b.is_elapsed, b.t_new, 0))     AS ct_new,
         SUM(IF(b.is_elapsed, b.t_spend, 0))   AS ct_spend,
         SUM(b.b_orders) AS bt_orders, SUM(b.b_revenue) AS bt_revenue, SUM(b.b_new) AS bt_new,
         SUM(IF(b.is_elapsed, b.b_orders, 0))  AS bct_orders,
         SUM(IF(b.is_elapsed, b.b_revenue, 0)) AS bct_revenue,
         SUM(IF(b.is_elapsed, b.b_new, 0))     AS bct_new,
         IFNULL(SUM(b.a_orders), 0)  AS c_orders,
         IFNULL(SUM(b.a_revenue), 0) AS c_revenue,
         IFNULL(SUM(b.a_new), 0)     AS c_new,
         IFNULL(SUM(b.a_spend), 0)   AS c_spend,
         LOGICAL_AND(b.has_orders) AS has_orders, LOGICAL_AND(b.has_revenue) AS has_revenue,
         LOGICAL_AND(b.has_new) AS has_new, LOGICAL_AND(b.has_spend) AS has_spend,
         LOGICAL_OR(b.is_elapsed AND b.date >= DATE_SUB(b.as_of, INTERVAL 1 DAY)) AS is_preliminary
  FROM periods p
  JOIN base_act b
    ON b.client_id = p.client_id AND b.date BETWEEN p.p_start AND p.p_end
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
),
agg2 AS (
  SELECT a.*, pr.phi, pr.cv, pr.k,
         DATE_DIFF(a.p_end, a.p_start, DAY) + 1 AS days_total,
         GREATEST(0, LEAST(DATE_DIFF(a.as_of, a.p_start, DAY) + 1, DATE_DIFF(a.p_end, a.p_start, DAY) + 1)) AS days_elapsed,
         COALESCE(SAFE_DIVIDE(a.t_revenue, NULLIF(a.t_orders, 0)), h.aov_hist) AS aov_plan,
         -- orders-equivalent of the curve: the orders target, or revenue / historical AOV
         -- when only revenue is planned (identical to t_orders whenever t_orders > 0)
         IF(a.t_orders > 0, a.t_orders, SAFE_DIVIDE(a.t_revenue, h.aov_hist))   AS t_orders_eff,
         IF(a.t_orders > 0, a.ct_orders, SAFE_DIVIDE(a.ct_revenue, h.aov_hist)) AS ct_orders_eff,
         COALESCE(SAFE_DIVIDE(a.ct_orders, NULLIF(a.t_orders, 0)),
                  SAFE_DIVIDE(a.ct_revenue, NULLIF(a.t_revenue, 0)))            AS curve_share_to_date
  FROM agg a JOIN params pr ON pr.client_id = a.client_id
  LEFT JOIN hist h ON h.client_id = a.client_id
),
agg2b AS (
  SELECT a.*, SAFE_DIVIDE(a.c_orders + a.k, a.ct_orders_eff + a.k) AS pf_orders
  FROM agg2 a
),
agg3 AS (
  SELECT a.*, IFNULL(gu.units, 0) AS c_units
  FROM agg2b a
  LEFT JOIN gate_units gu ON a.period_type = 'gate' AND gu.client_id = a.client_id AND gu.task_id = a.task_id
),
-- unpivot to metrics; gate rows use thresholds as targets, prorated by the curve
lng AS (
  SELECT a.*, m.*
  FROM agg3 a,
  UNNEST([
    STRUCT('orders' AS metric, a.has_orders AS has_target,
           IF(a.period_type = 'gate', a.thr_orders, a.t_orders) AS t,
           IF(a.period_type = 'gate', a.thr_orders * a.curve_share_to_date, a.ct_orders) AS ct,
           CAST(a.c_orders AS FLOAT64) AS c, a.t_orders AS t_curve, a.attr_orders_target AS attr_t,
           a.bt_orders AS bt, a.bct_orders AS bct),
    STRUCT('revenue', a.has_revenue,
           IF(a.period_type = 'gate', a.thr_revenue, a.t_revenue),
           IF(a.period_type = 'gate', a.thr_revenue * a.curve_share_to_date, a.ct_revenue),
           a.c_revenue, a.t_revenue, a.attr_revenue_target, a.bt_revenue, a.bct_revenue),
    STRUCT('new_customers', a.has_new,
           IF(a.period_type = 'gate', a.thr_new, a.t_new),
           IF(a.period_type = 'gate', a.thr_new * a.curve_share_to_date, a.ct_new),
           CAST(a.c_new AS FLOAT64), a.t_new, a.attr_new_target, a.bt_new, a.bct_new),
    STRUCT('ad_spend', a.has_spend,
           IF(a.period_type = 'gate', NULL, a.t_spend),
           IF(a.period_type = 'gate', NULL, a.ct_spend),
           a.c_spend, a.t_spend, CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64)),
    STRUCT('units', a.period_type = 'gate' AND a.thr_units IS NOT NULL,
           a.thr_units,
           a.thr_units * a.curve_share_to_date,
           CAST(a.c_units AS FLOAT64), a.t_orders_eff, CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64))
  ]) AS m
  WHERE m.has_target
    AND (a.period_type != 'gate' OR m.t IS NOT NULL
         OR (m.metric = 'orders' AND a.thr_orders IS NULL AND a.thr_revenue IS NULL AND a.thr_new IS NULL
             AND a.thr_units IS NULL))
),
calc AS (
  SELECT l.*,
         l.as_of < l.p_start  AS not_started,
         l.as_of >= l.p_end   AS is_closed,
         l.k * SAFE_DIVIDE(l.t_curve, l.t_orders_eff) AS k_m,
         -- z noise scale (one standard deviation of C - CT)
         CASE l.metric
           WHEN 'revenue'  THEN SQRT(l.phi * l.ct_orders_eff * (1 + l.cv * l.cv)) * l.aov_plan
           WHEN 'ad_spend' THEN NULL
           ELSE SQRT(l.phi * l.ct)
         END AS sd
  FROM lng l
),
calc2 AS (
  SELECT c.*,
         SAFE_DIVIDE(c.c, c.ct) AS pace,
         SAFE_DIVIDE(c.c - c.ct, c.sd) AS z,
         CASE
           WHEN c.t IS NULL THEN NULL
           WHEN c.is_closed THEN c.c
           WHEN c.not_started THEN c.t
           ELSE c.c + (c.t - c.ct) * SAFE_DIVIDE(c.c + c.k_m, c.ct + c.k_m)
         END AS proj,
         -- remaining orders expected (for the cone)
         IF(c.is_closed OR c.t IS NULL, 0,
            CASE c.metric
              WHEN 'orders'        THEN (c.t - c.ct) * SAFE_DIVIDE(c.c + c.k_m, c.ct + c.k_m)
              WHEN 'new_customers' THEN (c.t - c.ct) * SAFE_DIVIDE(c.c + c.k_m, c.ct + c.k_m)
              WHEN 'revenue'       THEN (c.t_orders_eff - c.ct_orders_eff) * c.pf_orders
            END) AS rem_units,
         CASE
           WHEN c.period_type IN ('month', 'quarter') THEN c.days_elapsed < 5
           WHEN c.period_type IN ('promo', 'gate') THEN c.days_total < 7 AND c.ct < 0.3 * c.t
           ELSE FALSE
         END AS is_too_early
  FROM calc c
),
month_proj AS (             -- quarter projection = sum of month projections (raw/04 2.6)
  SELECT client_id, metric, p_start AS month_start, proj
  FROM calc2 WHERE period_type = 'month'
),
quarter_proj AS (
  SELECT q.client_id, q.period_id, q.metric, SUM(mp.proj) AS proj
  FROM calc2 q
  JOIN month_proj mp
    ON mp.client_id = q.client_id AND mp.metric = q.metric
   AND mp.month_start BETWEEN q.p_start AND q.p_end
  WHERE q.period_type = 'quarter'
  GROUP BY 1, 2, 3
),
final AS (
  SELECT c.*,
         IF(c.period_type = 'quarter' AND c.t IS NOT NULL, qp.proj, c.proj) AS projected_end
  FROM calc2 c
  LEFT JOIN quarter_proj qp
    ON c.period_type = 'quarter' AND qp.client_id = c.client_id
   AND qp.period_id = c.period_id AND qp.metric = c.metric
)
SELECT
  client_id,
  period_type,
  period_id,
  period_label,
  metric,
  task_id,
  plan_status,
  as_of,
  p_start                                         AS period_start,
  p_end                                           AS period_end,
  days_total,
  days_elapsed,
  days_total - days_elapsed                       AS days_remaining,
  target_days < days_total                        AS is_target_partial,
  t                                               AS target_total,
  t_curve                                         AS curve_target_total,
  ct                                              AS target_to_date,
  IF(not_started, NULL, c)                        AS actual_to_date,
  IF(not_started, NULL, ROUND(100 * pace, 2))     AS pace_pct,
  IF(not_started, NULL, c - ct)                   AS gap_abs,
  projected_end,
  IF(metric = 'ad_spend' OR t IS NULL OR not_started OR is_closed, NULL,
     projected_end - 1.2816 * SQRT(phi * GREATEST(rem_units, 0) * IF(metric = 'revenue', 1 + cv * cv, 1))
                     * IF(metric = 'revenue', aov_plan, 1))  AS projected_low,
  IF(metric = 'ad_spend' OR t IS NULL OR not_started OR is_closed, NULL,
     projected_end + 1.2816 * SQRT(phi * GREATEST(rem_units, 0) * IF(metric = 'revenue', 1 + cv * cv, 1))
                     * IF(metric = 'revenue', aov_plan, 1))  AS projected_high,
  IF(is_closed OR t IS NULL, NULL,
     SAFE_DIVIDE(t - c, days_total - days_elapsed))          AS required_daily_rate,
  IF(is_closed OR t IS NULL, NULL, SAFE_DIVIDE(t - c, t - ct)) AS required_curve_mult,
  IF(not_started OR is_closed, NULL, ROUND(z, 3))            AS z_score,
  CASE
    WHEN not_started THEN 'not_started'
    WHEN is_closed THEN 'closed'
    WHEN period_type = 'day' OR t IS NULL OR ct IS NULL OR ct <= 0 THEN NULL
    WHEN is_too_early THEN 'on_track'
    WHEN metric = 'ad_spend' THEN
      CASE WHEN pace < 0.80 THEN 'off_track' WHEN pace < 0.90 THEN 'behind'
           WHEN pace > 1.10 THEN 'ahead' ELSE 'on_track' END
    WHEN pace < 0.90 AND z <= -1.645 THEN 'off_track'
    WHEN pace < 0.97 AND z <= -1.0   THEN 'behind'
    WHEN pace > 1.10 AND z >= 1.645  THEN 'ahead'
    ELSE 'on_track'
  END                                                        AS status,
  is_too_early AND NOT not_started AND NOT is_closed         AS is_too_early,
  CASE
    WHEN NOT is_closed OR t IS NULL OR metric = 'ad_spend' THEN NULL
    WHEN period_type = 'gate' THEN
      IF(c_orders >= IFNULL(thr_orders, 0) AND c_revenue >= IFNULL(thr_revenue, 0)
         AND c_new >= IFNULL(thr_new, 0)
         AND c_units >= IFNULL(thr_units, 0)
         AND (mer_cap_pct IS NULL OR 100 * SAFE_DIVIDE(c_spend, c_revenue) <= mer_cap_pct), 'met', 'missed')
    WHEN c >= t THEN 'met' ELSE 'missed'
  END                                                        AS result,
  is_preliminary AND NOT not_started                         AS is_preliminary,
  mer_cap_pct,
  ROUND(100 * SAFE_DIVIDE(t_spend, t_revenue), 2)            AS mer_plan_pct,
  IF(not_started, NULL, ROUND(100 * SAFE_DIVIDE(c_spend, c_revenue), 2)) AS mer_actual_pct,
  aov_plan,
  CAST(NULL AS FLOAT64)                                      AS attributed_orders,
  attr_t                                                     AS attributed_target,
  IF(period_type = 'promo', bt, NULL)                        AS baseline_total,
  IF(period_type = 'promo' AND NOT not_started, bct, NULL)   AS baseline_to_date,
  IF(period_type = 'promo' AND NOT not_started,
     ROUND(100 * (SAFE_DIVIDE(c, bct) - 1), 2), NULL)        AS lift_vs_baseline_pct
FROM final;

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_promo_orders_v` AS
WITH keys AS (
  SELECT
    k.client_id, k.task_id, k.phase, k.mechanic, k.source, k.is_storewide,
    IFNULL(k.is_test, FALSE) AS is_test,
    k.window_start, k.window_end,
    DATE_DIFF(k.window_end, k.window_start, DAY) + 1 AS window_days,
    ARRAY(SELECT UPPER(TRIM(x)) FROM UNNEST(k.coupon_codes) x WHERE TRIM(x) != '') AS coupon_keys,
    ARRAY(SELECT UPPER(TRIM(x)) FROM UNNEST(k.skus) x WHERE TRIM(x) != '') AS sku_keys,
    ARRAY(SELECT UPPER(TRIM(x)) FROM UNNEST(k.gift_skus) x WHERE TRIM(x) != '') AS gift_keys,
    ARRAY(SELECT LOWER(REPLACE(TRIM(x), '+', ' ')) FROM UNNEST(k.utm_campaigns) x WHERE TRIM(x) != '') AS utm_keys
  FROM `oneeighty-warehouse.ref.plan_promo_keys` k
  WHERE k.window_start IS NOT NULL
    AND k.window_end >= k.window_start
    AND IFNULL(k.clickup_status, '') NOT IN ('rejected', 'on hold')
),
orders AS (                 -- canonical valid orders, all platforms (279b)
  SELECT
    o.client_id, o.order_id, o.order_date,
    o.net_revenue,
    o.total_discounts, o.fee_discounts,
    (IFNULL(o.total_discounts, 0) > 0 OR IFNULL(o.fee_discounts, 0) < 0) AS has_mechanic,
    o.is_new_customer,
    LOWER(REPLACE(TRIM(o.utm_campaign), '+', ' ')) AS utm_campaign,
    o.coupon_codes
  FROM `oneeighty-warehouse.mart.plan_orders` o
  WHERE o.client_id IN (SELECT DISTINCT client_id FROM keys)
),
lines AS (                  -- canonical lines; gift = unit price < 1 (279b)
  SELECT l.client_id, l.order_id, l.quantity, l.revenue, l.is_gift AS is_zero, l.line_keys
  FROM `oneeighty-warehouse.mart.plan_order_lines` l
  WHERE l.client_id IN (SELECT DISTINCT client_id FROM keys)
),
cand AS (
  SELECT k.*, o.* EXCEPT (client_id),
    o.order_date BETWEEN k.window_start AND k.window_end AS in_window
  FROM keys k
  JOIN orders o
    ON o.client_id = k.client_id
   AND o.order_date BETWEEN k.window_start AND DATE_ADD(k.window_end, INTERVAL 60 DAY)
),
coupon_hit AS (
  SELECT c.client_id, c.task_id, c.order_id, MIN(oc) AS matched_key
  FROM cand c, UNNEST(c.coupon_codes) oc, UNNEST(c.coupon_keys) pk
  WHERE oc = pk OR (ENDS_WITH(pk, '*') AND STARTS_WITH(oc, RTRIM(pk, '*')))
  GROUP BY 1, 2, 3
),
line_hit AS (
  SELECT
    c.client_id, c.task_id, c.order_id,
    l.quantity, l.revenue, l.is_zero,
    (SELECT MIN(pk) FROM UNNEST(c.sku_keys) pk, UNNEST(l.line_keys) lk
      WHERE lk = pk OR (ENDS_WITH(pk, '*') AND STARTS_WITH(lk, RTRIM(pk, '*')))) AS sku_key,
    (SELECT MIN(pk) FROM UNNEST(c.gift_keys) pk, UNNEST(l.line_keys) lk
      WHERE lk = pk OR (ENDS_WITH(pk, '*') AND STARTS_WITH(lk, RTRIM(pk, '*')))) AS gift_key
  FROM cand c
  JOIN lines l ON l.client_id = c.client_id AND l.order_id = c.order_id
  WHERE c.in_window
    AND (ARRAY_LENGTH(c.sku_keys) > 0 OR ARRAY_LENGTH(c.gift_keys) > 0)
),
line_agg AS (
  SELECT client_id, task_id, order_id,
    MIN(IF(NOT is_zero, sku_key, NULL)) AS sku_key,
    MIN(IF(is_zero, COALESCE(gift_key, sku_key), NULL)) AS gift_key,
    SUM(IF(NOT is_zero AND sku_key IS NOT NULL, quantity, 0)) AS promo_units,
    SUM(IF(NOT is_zero AND sku_key IS NOT NULL, revenue, 0)) AS promo_line_revenue,
    SUM(IF(is_zero AND COALESCE(gift_key, sku_key) IS NOT NULL, quantity, 0)) AS gift_units
  FROM line_hit
  GROUP BY 1, 2, 3
),
utm_hit AS (
  SELECT c.client_id, c.task_id, c.order_id, MIN(pk) AS matched_key
  FROM cand c, UNNEST(c.utm_keys) pk
  WHERE c.in_window AND c.utm_campaign IS NOT NULL
    AND (c.utm_campaign = pk OR (ENDS_WITH(pk, '*') AND STARTS_WITH(c.utm_campaign, RTRIM(pk, '*'))))
  GROUP BY 1, 2, 3
),
matched AS (
  SELECT
    c.*,
    ch.matched_key AS coupon_key,
    la.sku_key, la.gift_key, la.promo_units, la.promo_line_revenue, la.gift_units,
    uh.matched_key AS utm_key,
    ARRAY(
      SELECT AS STRUCT t.match_type, t.match_rank, t.matched_key FROM UNNEST([
        STRUCT('coupon' AS match_type, 1 AS match_rank,
               IF(c.in_window, ch.matched_key, NULL) AS matched_key),
        STRUCT('sku', 2, la.sku_key),
        STRUCT('gift_sku', 3, la.gift_key),
        STRUCT('utm', 4, uh.matched_key),
        STRUCT('coupon_late', 5, IF(NOT c.in_window, ch.matched_key, NULL)),
        STRUCT('window', 6, IF(c.in_window AND c.is_storewide, 'window', NULL))
      ]) t
      WHERE t.matched_key IS NOT NULL
      ORDER BY t.match_rank
    ) AS hits
  FROM cand c
  LEFT JOIN coupon_hit ch USING (client_id, task_id, order_id)
  LEFT JOIN line_agg  la USING (client_id, task_id, order_id)
  LEFT JOIN utm_hit   uh USING (client_id, task_id, order_id)
),
best AS (
  SELECT
    m.*,
    m.hits[OFFSET(0)].match_type AS match_type,
    m.hits[OFFSET(0)].match_rank AS match_rank,
    m.hits[OFFSET(0)].matched_key AS matched_key,
    ARRAY(SELECT h.match_type FROM UNNEST(m.hits) h ORDER BY h.match_rank) AS match_types
  FROM matched m
  WHERE ARRAY_LENGTH(m.hits) > 0
)
SELECT
  b.client_id, b.task_id, b.phase, b.mechanic, b.source,
  b.window_start, b.window_end, b.window_days,
  b.order_id, b.order_date,
  b.match_type, b.match_rank, b.matched_key, b.match_types,
  ROW_NUMBER() OVER (
    PARTITION BY b.client_id, b.order_id
    ORDER BY b.match_rank, b.window_days, b.window_start DESC, b.task_id
  ) = 1 AS is_primary,
  COUNT(*) OVER (PARTITION BY b.client_id, b.order_id) AS n_promos,
  IF(b.is_test, IF(b.coupon_key IS NOT NULL, 'code', 'no_code'), NULL) AS arm,
  b.in_window,
  b.net_revenue, b.total_discounts, b.fee_discounts, b.has_mechanic,
  b.is_new_customer,
  b.coupon_codes,
  IFNULL(b.promo_units, 0) AS promo_units,
  IFNULL(b.promo_line_revenue, 0) AS promo_line_revenue,
  IFNULL(b.gift_units, 0) AS gift_units
FROM best b;

-- pp2's promo objects become tables (a view cannot be replaced by a table in place).
DROP VIEW IF EXISTS `oneeighty-warehouse.mart.plan_promo_orders`;
DROP VIEW IF EXISTS `oneeighty-warehouse.mart.plan_promo_perf`;

-- Bootstrap the promo orders table so plan_promo_perf_v can be created.
CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_promo_orders` CLUSTER BY client_id, task_id
AS SELECT *, CURRENT_TIMESTAMP() AS refreshed_at FROM `oneeighty-warehouse.mart.plan_promo_orders_v`;

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_promo_perf_v` AS
WITH keys AS (
  SELECT
    k.client_id, k.task_id, k.phase, k.mechanic, k.source, k.clickup_status,
    k.window_start, k.window_end,
    DATE_DIFF(k.window_end, k.window_start, DAY) + 1 AS window_days,
    k.mer_cap_pct,
    CURRENT_DATE(c.timezone) AS today
  FROM `oneeighty-warehouse.ref.plan_promo_keys` k
  JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
  WHERE k.window_start IS NOT NULL
    AND k.window_end >= k.window_start
    AND IFNULL(k.clickup_status, '') NOT IN ('rejected', 'on hold')
),
days AS (
  SELECT k.*, d AS date, DATE_DIFF(d, k.window_start, DAY) + 1 AS day_index
  FROM keys k, UNNEST(GENERATE_DATE_ARRAY(k.window_start, k.window_end)) d
),
span AS (
  SELECT client_id, MIN(window_start) AS d0, MAX(window_end) AS d1 FROM keys GROUP BY 1
),
store_day AS (              -- canonical daily actuals (279b)
  SELECT a.client_id, a.date,
    a.orders AS store_orders,
    CAST(a.revenue AS NUMERIC) AS store_revenue,
    a.new_customers AS store_new_customers
  FROM `oneeighty-warehouse.mart.plan_actuals_daily` a
  JOIN span s ON s.client_id = a.client_id AND a.date BETWEEN s.d0 AND s.d1
),
kpi_day AS (                -- Meta spend and net revenue from the same canonical table
  SELECT a.client_id, a.date, CAST(a.meta_spend AS NUMERIC) AS meta_spend,
         CAST(a.revenue AS NUMERIC) AS kpi_net_sales
  FROM `oneeighty-warehouse.mart.plan_actuals_daily` a
  JOIN span s ON s.client_id = a.client_id AND a.date BETWEEN s.d0 AND s.d1
),
attr_day AS (
  SELECT client_id, task_id, order_date AS date,
    COUNT(*) AS attr_orders,
    SUM(net_revenue) AS attr_revenue,
    COUNTIF(is_new_customer) AS attr_new_customers,
    SUM(promo_units) AS attr_units,
    SUM(gift_units) AS attr_gift_units,
    COUNTIF(arm = 'code') AS attr_code_orders,
    COUNTIF(arm = 'no_code') AS attr_no_code_orders,
    COUNTIF(match_type = 'window' AND has_mechanic) AS attr_discounted_orders,
    COUNTIF(is_primary) AS prim_orders,
    SUM(IF(is_primary, net_revenue, 0)) AS prim_revenue
  FROM `oneeighty-warehouse.mart.plan_promo_orders`
  WHERE in_window
  GROUP BY 1, 2, 3
),
late AS (
  SELECT client_id, task_id, COUNT(*) AS late_orders, SUM(net_revenue) AS late_revenue
  FROM `oneeighty-warehouse.mart.plan_promo_orders`
  WHERE NOT in_window
  GROUP BY 1, 2
),
day_rows AS (
  SELECT
    d.client_id, d.task_id, d.phase, d.mechanic, d.source, d.clickup_status,
    'day' AS grain, d.date, d.day_index, d.window_start, d.window_end, d.window_days,
    d.date < d.today AS is_complete,
    IFNULL(a.attr_orders, 0) AS attr_orders,
    IFNULL(a.attr_revenue, 0) AS attr_revenue,
    IFNULL(a.attr_new_customers, 0) AS attr_new_customers,
    IFNULL(a.attr_units, 0) AS attr_units,
    IFNULL(a.attr_gift_units, 0) AS attr_gift_units,
    IFNULL(a.attr_code_orders, 0) AS attr_code_orders,
    IFNULL(a.attr_no_code_orders, 0) AS attr_no_code_orders,
    IFNULL(a.attr_discounted_orders, 0) AS attr_discounted_orders,
    IFNULL(a.prim_orders, 0) AS prim_orders,
    IFNULL(a.prim_revenue, 0) AS prim_revenue,
    CAST(NULL AS INT64) AS late_orders,
    CAST(NULL AS NUMERIC) AS late_revenue,
    IFNULL(s.store_orders, 0) AS store_orders,
    IFNULL(s.store_revenue, 0) AS store_revenue,
    IFNULL(s.store_new_customers, 0) AS store_new_customers,
    k.meta_spend, k.kpi_net_sales,
    d.mer_cap_pct
  FROM days d
  LEFT JOIN attr_day a USING (client_id, task_id, date)
  LEFT JOIN store_day s ON s.client_id = d.client_id AND s.date = d.date
  LEFT JOIN kpi_day k ON k.client_id = d.client_id AND k.date = d.date
),
total_rows AS (
  SELECT
    r.client_id, r.task_id, r.phase, r.mechanic, r.source, r.clickup_status,
    'total' AS grain, CAST(NULL AS DATE) AS date, CAST(NULL AS INT64) AS day_index,
    r.window_start, r.window_end, r.window_days,
    LOGICAL_AND(r.is_complete) AS is_complete,
    SUM(r.attr_orders), SUM(r.attr_revenue), SUM(r.attr_new_customers), SUM(r.attr_units),
    SUM(r.attr_gift_units), SUM(r.attr_code_orders), SUM(r.attr_no_code_orders),
    SUM(r.attr_discounted_orders), SUM(r.prim_orders), SUM(r.prim_revenue),
    ANY_VALUE(IFNULL(l.late_orders, 0)), ANY_VALUE(IFNULL(l.late_revenue, 0)),
    SUM(r.store_orders), SUM(r.store_revenue), SUM(r.store_new_customers),
    SUM(r.meta_spend), SUM(r.kpi_net_sales),
    ANY_VALUE(r.mer_cap_pct)
  FROM day_rows r
  LEFT JOIN late l USING (client_id, task_id)
  GROUP BY r.client_id, r.task_id, r.phase, r.mechanic, r.source, r.clickup_status,
           r.window_start, r.window_end, r.window_days
),
all_rows AS (
  SELECT * FROM day_rows
  UNION ALL
  SELECT * FROM total_rows
)
SELECT
  a.*,
  SAFE_DIVIDE(a.attr_orders, NULLIF(a.store_orders, 0)) AS attr_share_orders,
  SAFE_DIVIDE(a.attr_revenue, NULLIF(a.store_revenue, 0)) AS attr_share_revenue,
  SAFE_DIVIDE(a.prim_orders, NULLIF(a.store_orders, 0)) AS prim_share_orders,
  ROUND(100 * SAFE_DIVIDE(a.meta_spend, NULLIF(a.kpi_net_sales, 0)), 1) AS store_mer_pct,
  IF(a.mer_cap_pct IS NULL OR a.kpi_net_sales IS NULL OR a.kpi_net_sales = 0, NULL,
     100 * a.meta_spend / a.kpi_net_sales > a.mer_cap_pct) AS mer_over_cap
FROM all_rows a;

-- One hourly entry point: canonical actuals (279b) -> curve (272) -> pacing -> promo tables.
CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_plan_pacing`()
BEGIN
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_input__next` CLUSTER BY client_id, level
  AS SELECT *, CURRENT_TIMESTAMP() AS refreshed_at FROM `oneeighty-warehouse.mart.plan_input_v`;
  ASSERT NOT EXISTS (SELECT 1 FROM `oneeighty-warehouse.mart.plan_input__next`
                     GROUP BY client_id, task_id HAVING COUNT(*) > 1) AS 'plan_input: duplicate task';
  ASSERT (SELECT COUNT(*) FROM `oneeighty-warehouse.mart.plan_input__next`) > 0 AS 'plan_input: no rows';
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_input` COPY `oneeighty-warehouse.mart.plan_input__next`;
  DROP TABLE `oneeighty-warehouse.mart.plan_input__next`;

  CALL `oneeighty-warehouse.mart.sp_refresh_plan_actuals`();
  CALL `oneeighty-warehouse.mart.sp_refresh_plan_targets_daily`();

  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_pacing__next`
  CLUSTER BY client_id, period_type, metric
  AS SELECT *, CURRENT_TIMESTAMP() AS refreshed_at
     FROM `oneeighty-warehouse.mart.plan_pacing_v`;
  ASSERT (SELECT COUNT(*) FROM `oneeighty-warehouse.mart.plan_pacing__next`) > 0
    AS 'plan_pacing: no rows';
  ASSERT NOT EXISTS (
    SELECT 1 FROM `oneeighty-warehouse.mart.plan_pacing__next`
    GROUP BY client_id, period_type, period_id, metric HAVING COUNT(*) > 1)
    AS 'plan_pacing: duplicate client_id, period_type, period_id, metric';
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_pacing`
  COPY `oneeighty-warehouse.mart.plan_pacing__next`;
  DROP TABLE `oneeighty-warehouse.mart.plan_pacing__next`;

  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_promo_orders__next`
  CLUSTER BY client_id, task_id
  AS SELECT *, CURRENT_TIMESTAMP() AS refreshed_at FROM `oneeighty-warehouse.mart.plan_promo_orders_v`;
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_promo_orders`
  COPY `oneeighty-warehouse.mart.plan_promo_orders__next`;
  DROP TABLE `oneeighty-warehouse.mart.plan_promo_orders__next`;

  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_promo_perf__next`
  CLUSTER BY client_id, task_id
  AS SELECT *, CURRENT_TIMESTAMP() AS refreshed_at FROM `oneeighty-warehouse.mart.plan_promo_perf_v`;
  ASSERT NOT EXISTS (
    SELECT 1 FROM `oneeighty-warehouse.mart.plan_promo_perf__next`
    GROUP BY client_id, task_id, grain, date HAVING COUNT(*) > 1)
    AS 'plan_promo_perf: duplicate client_id, task_id, grain, date';
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_promo_perf`
  COPY `oneeighty-warehouse.mart.plan_promo_perf__next`;
  DROP TABLE `oneeighty-warehouse.mart.plan_promo_perf__next`;
END;

CALL `oneeighty-warehouse.mart.sp_refresh_plan_pacing`();

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_checks` AS
WITH
p AS (SELECT * FROM `oneeighty-warehouse.mart.plan_input`),
v AS (SELECT * FROM p WHERE is_valid),
clients AS (SELECT DISTINCT client_id FROM p),
promo_overlap AS (           -- logged, resolved by the shortest window rule (272)
  SELECT a.client_id, 'info' AS severity, 'promo_overlap' AS check_id, a.task_id,
         FORMAT('%s and %s overlap %t to %t; curve uses %s (shortest window)',
                a.name, b.name, GREATEST(a.start_date, b.start_date), LEAST(a.end_date, b.end_date),
                IF(DATE_DIFF(a.end_date, a.start_date, DAY) < DATE_DIFF(b.end_date, b.start_date, DAY)
                   OR (DATE_DIFF(a.end_date, a.start_date, DAY) = DATE_DIFF(b.end_date, b.start_date, DAY)
                       AND a.start_date >= b.start_date), a.name, b.name)) AS detail
  FROM v a JOIN v b
    ON a.client_id = b.client_id AND a.level = 'Promo' AND b.level = 'Promo' AND a.task_id < b.task_id
   AND a.start_date <= b.end_date AND b.start_date <= a.end_date
),
daily_sum AS (
  SELECT client_id, 'error', 'daily_sum_mismatch', ANY_VALUE(month_task_id),
         FORMAT('%t %s: daily targets sum to %.4f, month target %.4f', month_start, metric,
                SUM(target_daily), ANY_VALUE(target_month))
  FROM `oneeighty-warehouse.mart.plan_targets_daily`
  GROUP BY client_id, month_start, metric
  HAVING ABS(SUM(target_daily) - ANY_VALUE(target_month)) > 0.01
),
q_vs_m AS (
  SELECT q.client_id, 'error', 'quarter_month_mismatch', q.task_id,
         FORMAT('%s %s: quarter %g vs sum of months %g', q.name, m.metric, m.qv, m.mv)
  FROM v q
  JOIN (
    SELECT t.quarter_task_id, t.client_id, t.metric, SUM(t.target_value) AS mv,
           ANY_VALUE(CASE t.metric WHEN 'revenue' THEN CAST(qq.target_revenue AS FLOAT64)
                                   WHEN 'orders' THEN qq.target_orders
                                   WHEN 'new_customers' THEN qq.target_new_customers
                                   WHEN 'ad_spend' THEN CAST(qq.ad_budget AS FLOAT64) END) AS qv
    FROM `oneeighty-warehouse.mart.plan_targets` t
    JOIN v qq ON qq.task_id = t.quarter_task_id AND qq.client_id = t.client_id
    GROUP BY 1, 2, 3) m
    ON m.quarter_task_id = q.task_id AND m.client_id = q.client_id
  WHERE m.qv IS NOT NULL AND ABS(m.qv - m.mv) > 0.01
),
dup_period AS (
  SELECT client_id, 'error', 'duplicate_period', ANY_VALUE(task_id),
         FORMAT('%d valid %s tasks for %t; the latest version_at is used', COUNT(*), level,
                ANY_VALUE(DATE_TRUNC(COALESCE(start_date, end_date), MONTH)))
  FROM v
  WHERE level IN ('Month', 'Quarter', 'Target state') AND COALESCE(start_date, end_date) IS NOT NULL
  GROUP BY client_id, level, DATE_TRUNC(COALESCE(start_date, end_date), MONTH)
  HAVING COUNT(*) > 1
),
missing_target_state AS (
  SELECT c.client_id, 'warning', 'missing_level', CAST(NULL AS STRING),
         'no valid Target state task'
  FROM clients c
  WHERE NOT EXISTS (SELECT 1 FROM v WHERE v.client_id = c.client_id AND v.level = 'Target state')
),
month_without_quarter AS (
  SELECT m.client_id, 'warning', 'missing_level', m.task_id,
         FORMAT('%s has no valid Quarter task covering it', m.name)
  FROM v m
  WHERE m.level = 'Month'
    AND NOT EXISTS (SELECT 1 FROM v q WHERE q.client_id = m.client_id AND q.level = 'Quarter'
                    AND m.start_date BETWEEN q.start_date AND q.end_date)
),
quarter_split AS (
  SELECT client_id, 'info', 'quarter_split', task_id,
         FORMAT('%s %s split from the quarter (no Month task)', period_label, metric)
  FROM `oneeighty-warehouse.mart.plan_targets` WHERE source = 'quarter_split'
),
promo_outside_targets AS (
  SELECT pr.client_id, 'warning', 'promo_outside_targets', pr.task_id,
         FORMAT('%s runs %t to %t, monthly targets cover %t to %t', pr.name, pr.start_date, pr.end_date,
                r.d0, r.d1)
  FROM v pr
  JOIN (SELECT client_id, MIN(date) AS d0, MAX(date) AS d1
        FROM `oneeighty-warehouse.mart.plan_targets_daily` GROUP BY 1) r
    ON r.client_id = pr.client_id
  WHERE pr.level = 'Promo' AND (pr.start_date < r.d0 OR pr.end_date > r.d1)
),
field_gaps AS (
  SELECT client_id, 'warning', 'missing_field', task_id,
         FORMAT('%s (%s): %s', name, level,
                CASE
                  WHEN start_date IS NULL AND level != 'Checkpoint' THEN 'no Start date'
                  WHEN end_date IS NULL THEN 'no Due date'
                  WHEN level = 'Promo' AND mechanic IS NULL THEN 'no Mechanic'
                  WHEN level = 'Checkpoint' AND target_orders IS NULL AND target_revenue IS NULL
                       AND target_new_customers IS NULL AND mer_cap_pct IS NULL
                       AND target_units IS NULL THEN 'no numeric threshold'
                  WHEN level = 'Checkpoint' AND target_units IS NOT NULL AND skus IS NULL
                       THEN 'Target units without SKUs (not measurable)'
                  WHEN level = 'Month' AND (target_revenue IS NULL OR target_orders IS NULL) THEN 'no revenue or orders target'
                END)
  FROM p
  WHERE status NOT IN ('rejected', 'on hold')
    AND ((start_date IS NULL AND level != 'Checkpoint') OR end_date IS NULL
      OR (level = 'Promo' AND mechanic IS NULL)
      OR (level = 'Checkpoint' AND target_orders IS NULL AND target_revenue IS NULL
          AND target_new_customers IS NULL AND mer_cap_pct IS NULL AND target_units IS NULL)
      OR (level = 'Checkpoint' AND target_units IS NOT NULL AND skus IS NULL)
      OR (level = 'Month' AND (target_revenue IS NULL OR target_orders IS NULL)))
),
name_check AS (
  SELECT client_id, 'warning', 'name_mismatch', task_id,
         FORMAT('%s: expected "%s"', name, expected)
  FROM (
    SELECT p.*,
           CASE level
             WHEN 'Quarter'      THEN FORMAT_DATE('Q%Q %Y', start_date)
             WHEN 'Month'        THEN FORMAT_DATE('%B %Y', start_date)
             WHEN 'Target state' THEN FORMAT_DATE('Target state %m/%Y', end_date)
           END AS expected
    FROM p)
  WHERE (level IN ('Quarter', 'Month', 'Target state') AND name IS DISTINCT FROM expected)
     OR (level = 'Promo' AND NOT REGEXP_CONTAINS(IFNULL(name, ''), r'^F[0-9]+ · '))
     OR (level = 'Checkpoint' AND NOT REGEXP_CONTAINS(IFNULL(name, ''), r'^G[0-9]+ · '))
),
gate_above_curve AS (
  SELECT client_id, 'info', 'gate_above_plan', task_id,
         FORMAT('%s threshold %g %s vs plan curve %.1f over the same window', period_label,
                target_total, metric, curve_target_total)
  FROM `oneeighty-warehouse.mart.plan_pacing`
  WHERE period_type = 'gate' AND target_total > curve_target_total * 1.02
)
SELECT * FROM promo_overlap
UNION ALL SELECT * FROM daily_sum
UNION ALL SELECT * FROM q_vs_m
UNION ALL SELECT * FROM dup_period
UNION ALL SELECT * FROM missing_target_state
UNION ALL SELECT * FROM month_without_quarter
UNION ALL SELECT * FROM quarter_split
UNION ALL SELECT * FROM promo_outside_targets
UNION ALL SELECT * FROM field_gaps
UNION ALL SELECT * FROM name_check
UNION ALL SELECT * FROM gate_above_curve;
