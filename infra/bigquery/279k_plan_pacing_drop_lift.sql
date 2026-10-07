-- =============================================================================
-- 279k_plan_pacing_drop_lift.sql
-- Promo pacing (package pm1): the lift metric leaves the plan layer.
--
-- Why
--   plan_pacing.lift_vs_baseline_pct read "actual in the window over the plan
--   curve with the promo's Day multiplier divided out, minus 1". That is the
--   error of the target, not the effect of the promo. For a client with no Day
--   multiplier on any promo (every Manami promo today) the baseline equals the
--   curve, so the lift collapses to pace minus 1 and reported F6 Maj at
--   +297 % against a test target. There is no counterfactual in the warehouse
--   (raw/04 section 3.3 B2 and B5 are not built), so no honest single number
--   can take its place. The Promo view shows the promo's own detail and
--   margin instead (279j).
--
-- Change
--   REPLACE VIEW mart.plan_pacing_v   WITHOUT the output columns
--                                     baseline_total, baseline_to_date,
--                                     lift_vs_baseline_pct
--   Then CALL mart.sp_refresh_plan_pacing() (procedure unchanged), which also
--   rebuilds plan_orders, plan_promo_orders and plan_promo_perf (279i, 279j).
--
-- Kept on purpose
--   plan_targets_daily.baseline_daily (the curve with the promo multiplier
--   divided out) stays. It is a property of the target curve, not a claim
--   about demand without the promo, and the internal bt / bct plumbing of
--   this view is woven through the metric unpivot: removing it would rewrite
--   the whole pacing table for no change in any number that is read.
--
-- Frontend order matters: the page must stop reading the three columns BEFORE
--   this runs, or the Goals page read fails on an unrecognised name.
--
-- Based on: 279g as written (same file, same view), 3 output lines removed.
-- Affected clients: every client with plan rows (3 columns disappear).
-- QA copies: mart_qa.pm1_plan_pacing(_v).
-- Deploy order: 279i, 279j, then this file. Single CALL at the end.
-- =============================================================================

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
  SELECT a.client_id, a.date AS d, a.orders, a.revenue, a.new_customers, a.meta_spend AS ad_spend, a.as_of,
         -- 279g: mart definitions (mart_daily_kpis via 279g plan_actuals_daily)
         a.kpi_revenue, a.new_customer_revenue AS ncr, a.new_customer_orders AS nco,
         a.paid_spend AS paid, a.cm3, a.is_cm3_measured, a.is_spend_missing
  FROM `oneeighty-warehouse.mart.plan_actuals_daily` a
  JOIN clients c ON c.client_id = a.client_id
),
as_of AS (
  SELECT client_id, ANY_VALUE(as_of) AS as_of FROM act GROUP BY client_id
),
hist AS (                    -- trailing 365-day AOV: noise scale when a period has no orders target
  SELECT a.client_id, SAFE_DIVIDE(SUM(a.revenue), SUM(a.orders)) AS aov_hist,
         -- 279g: new customer AOV (aMER noise) and gross margin rate (CM3 noise), mart basis
         SAFE_DIVIDE(SUM(a.ncr), SUM(a.nco))                                      AS aov_new_hist,
         SAFE_DIVIDE(SUM(IF(a.is_cm3_measured, a.cm3 + IFNULL(a.paid, 0), NULL)),
                     SUM(IF(a.is_cm3_measured, a.kpi_revenue, NULL)))             AS gm_rate_hist
  FROM act a JOIN as_of x USING (client_id)
  WHERE a.d > DATE_SUB(x.as_of, INTERVAL 365 DAY)
  GROUP BY 1
),
tr7 AS (                     -- 279g: aMER over the 7 days ending as_of (scale rule reading)
  SELECT a.client_id,
         IF(COUNTIF(a.is_spend_missing) > 0, NULL,
            SAFE_DIVIDE(SUM(a.ncr), NULLIF(SUM(a.paid), 0))) AS amer_7d
  FROM act a JOIN as_of x USING (client_id)
  WHERE a.d BETWEEN DATE_SUB(x.as_of, INTERVAL 6 DAY) AND x.as_of
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
         LOGICAL_OR(t.metric = 'ad_spend')      AS has_spend,
         -- 279g
         SUM(IF(t.metric = 'cm3',  t.target_daily, 0))    AS t_cm3,
         SUM(IF(t.metric = 'amer', t.target_daily, 0))    AS t_anum,
         SUM(IF(t.metric = 'amer', t.ratio_den_daily, 0)) AS t_aden,
         LOGICAL_OR(t.metric = 'cm3')           AS has_cm3,
         LOGICAL_OR(t.metric = 'amer')          AS has_amer
  FROM td t JOIN as_of a ON a.client_id = t.client_id
  GROUP BY 1, 2, 3
),
base_act AS (
  SELECT b.*,
         b.date <= b.as_of AS is_elapsed,
         IF(b.date <= b.as_of, IFNULL(o.orders, 0), NULL)        AS a_orders,
         IF(b.date <= b.as_of, IFNULL(o.revenue, 0), NULL)       AS a_revenue,
         IF(b.date <= b.as_of, IFNULL(o.new_customers, 0), NULL) AS a_new,
         IF(b.date <= b.as_of, IFNULL(s.ad_spend, 0), NULL)      AS a_spend,
         -- 279g: mart CM3 (NULL on a day without cost data), new customer revenue, paid spend
         IF(b.date <= b.as_of, o.cm3, NULL)                      AS a_cm3,
         b.date <= b.as_of AND NOT IFNULL(o.is_cm3_measured, FALSE) AS a_cm3_unmeasured,
         IF(b.date <= b.as_of, IFNULL(o.ncr, 0), NULL)           AS a_ncr,
         IF(b.date <= b.as_of, IFNULL(o.paid, 0), NULL)          AS a_paid,
         b.date <= b.as_of AND IFNULL(o.is_spend_missing, FALSE) AS a_spend_missing
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
         CAST(NULL AS FLOAT64) AS thr_units,
         CAST(NULL AS FLOAT64) AS thr_cm3, CAST(NULL AS FLOAT64) AS thr_amer,
         CAST(NULL AS INT64) AS amer_win_days, CAST(NULL AS FLOAT64) AS amer_min_spend
  FROM base
  UNION ALL
  SELECT DISTINCT client_id, 'week', FORMAT_DATE('%G-W%V', date), FORMAT_DATE('Week %V %G', date),
         DATE_TRUNC(date, ISOWEEK), DATE_ADD(DATE_TRUNC(date, ISOWEEK), INTERVAL 6 DAY),
         CAST(NULL AS STRING), CAST(NULL AS STRING), CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS INT64), CAST(NULL AS FLOAT64)
  FROM base
  UNION ALL
  SELECT client_id, 'month', FORMAT_DATE('%Y-%m', month_start), ANY_VALUE(month_label),
         month_start, LAST_DAY(month_start), ANY_VALUE(month_task_id), 'approved', ANY_VALUE(month_mer_cap_pct),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS INT64), CAST(NULL AS FLOAT64)
  FROM td
  GROUP BY client_id, month_start
  UNION ALL
  SELECT client_id, 'quarter', FORMAT_DATE('%Y-Q%Q', start_date), name, start_date, end_date,
         task_id, status, mer_cap_pct, CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS INT64), CAST(NULL AS FLOAT64)
  FROM plan WHERE level = 'Quarter' AND is_valid
  UNION ALL
  SELECT client_id, 'promo', task_id, name, start_date, end_date, task_id, status, mer_cap_pct,
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64),
         CAST(target_orders AS FLOAT64), CAST(target_new_customers AS FLOAT64), CAST(target_revenue AS FLOAT64),
         CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS INT64), CAST(NULL AS FLOAT64)
  FROM plan WHERE level = 'Promo' AND (is_valid OR status = 'planning') AND end_date IS NOT NULL
  UNION ALL
  SELECT client_id, 'gate', task_id, name,
         COALESCE(start_date, DATE_TRUNC(end_date, QUARTER)),
         end_date,
         task_id, status, mer_cap_pct,
         CAST(target_orders AS FLOAT64), CAST(target_revenue AS FLOAT64), CAST(target_new_customers AS FLOAT64),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64),
         IF(skus IS NOT NULL, CAST(target_units AS FLOAT64), NULL),
         -- 279g: CM3 floor over Start..Due; aMER floor over the window; min spend in it
         CAST(target_cm3 AS FLOAT64), target_amer, amer_window_days, CAST(amer_min_spend AS FLOAT64)
  FROM plan WHERE level = 'Checkpoint' AND is_valid AND end_date IS NOT NULL
),
gate_win AS (                 -- 279g: aMER measurement window of a Checkpoint
  SELECT p.client_id, p.task_id,
         IF(p.amer_win_days IS NULL, p.p_start,
            DATE_SUB(p.p_end, INTERVAL GREATEST(p.amer_win_days, 1) - 1 DAY)) AS m_start,
         p.p_end AS m_end
  FROM periods p
  WHERE p.period_type = 'gate' AND p.thr_amer IS NOT NULL
),
gate_amer_act AS (            -- actuals (mart) from m_start to LEAST(m_end, as_of)
  SELECT g.client_id, g.task_id,
         SUM(a.ncr) AS w_ncr, SUM(IFNULL(a.paid, 0)) AS w_paid, COUNTIF(a.is_spend_missing) AS w_missing
  FROM gate_win g
  JOIN as_of x ON x.client_id = g.client_id
  LEFT JOIN act a ON a.client_id = g.client_id AND a.d BETWEEN g.m_start AND LEAST(g.m_end, x.as_of)
  GROUP BY 1, 2
),
gate_amer_plan AS (           -- plan curve over the window and to date
  SELECT g.client_id, g.task_id,
         SUM(IF(t.metric = 'amer', t.target_daily, 0))                         AS w_t_anum,
         SUM(IF(t.metric = 'amer', t.ratio_den_daily, 0))                      AS w_t_aden,
         SUM(IF(t.metric = 'amer' AND t.date <= x.as_of, t.target_daily, 0))    AS w_ct_anum,
         SUM(IF(t.metric = 'amer' AND t.date <= x.as_of, t.ratio_den_daily, 0)) AS w_ct_aden,
         SUM(IF(t.metric = 'ad_spend', t.target_daily, 0))                     AS w_t_spend,
         SUM(IF(t.metric = 'ad_spend' AND t.date <= x.as_of, t.target_daily, 0)) AS w_ct_spend
  FROM gate_win g
  JOIN as_of x ON x.client_id = g.client_id
  LEFT JOIN td t ON t.client_id = g.client_id AND t.date BETWEEN g.m_start AND g.m_end
  GROUP BY 1, 2
),
gate_amer AS (
  SELECT g.client_id, g.task_id, g.m_start, g.m_end,
         ga.w_ncr, ga.w_paid, ga.w_missing,
         gp.w_t_anum, gp.w_t_aden, gp.w_ct_anum, gp.w_ct_aden, gp.w_t_spend, gp.w_ct_spend
  FROM gate_win g
  JOIN gate_amer_act ga  USING (client_id, task_id)
  JOIN gate_amer_plan gp USING (client_id, task_id)
),
agg AS (
  SELECT p.client_id, p.period_type, p.period_id, p.period_label, p.p_start, p.p_end, p.task_id,
         p.plan_status, p.mer_cap_pct, p.thr_orders, p.thr_revenue, p.thr_new,
         p.attr_orders_target, p.attr_new_target, p.attr_revenue_target, p.thr_units,
         p.thr_cm3, p.thr_amer, p.amer_win_days, p.amer_min_spend,
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
         LOGICAL_OR(b.is_elapsed AND b.date >= DATE_SUB(b.as_of, INTERVAL 1 DAY)) AS is_preliminary,
         -- 279g
         SUM(b.t_cm3) AS t_cm3, SUM(IF(b.is_elapsed, b.t_cm3, 0)) AS ct_cm3,
         SUM(b.t_anum) AS t_anum, SUM(b.t_aden) AS t_aden,
         SUM(IF(b.is_elapsed, b.t_anum, 0)) AS ct_anum, SUM(IF(b.is_elapsed, b.t_aden, 0)) AS ct_aden,
         IFNULL(SUM(b.a_cm3), 0) AS c_cm3, COUNTIF(b.a_cm3_unmeasured) AS n_cm3_unmeasured,
         IFNULL(SUM(b.a_ncr), 0) AS c_ncr, IFNULL(SUM(b.a_paid), 0) AS c_paid,
         COUNTIF(b.a_spend_missing) AS n_spend_missing,
         LOGICAL_AND(b.has_cm3) AS has_cm3, LOGICAL_AND(b.has_amer) AS has_amer
  FROM periods p
  JOIN base_act b
    ON b.client_id = p.client_id AND b.date BETWEEN p.p_start AND p.p_end
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20
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
  SELECT a.*, IFNULL(gu.units, 0) AS c_units,
         -- 279g. CM3 actual: n/a when any elapsed day lacks cost data (never a partial sum).
         IF(a.n_cm3_unmeasured > 0, NULL, a.c_cm3)                              AS c_cm3_eff,
         -- aMER: numerator / denominator over the period, or the Checkpoint's aMER window.
         IF(ga.task_id IS NULL, a.c_ncr, IFNULL(ga.w_ncr, 0))                     AS num_c,
         IF(ga.task_id IS NULL, a.c_paid, IFNULL(ga.w_paid, 0))                   AS den_c,
         IF(ga.task_id IS NULL, a.n_spend_missing, IFNULL(ga.w_missing, 0))       AS n_den_missing,
         IF(ga.task_id IS NULL, a.t_anum, ga.w_t_anum)                            AS num_t,
         IF(ga.task_id IS NULL, a.t_aden, ga.w_t_aden)                            AS den_t,
         IF(ga.task_id IS NULL, a.ct_anum, ga.w_ct_anum)                          AS num_ct,
         IF(ga.task_id IS NULL, a.ct_aden, ga.w_ct_aden)                          AS den_ct,
         IF(ga.task_id IS NULL, a.t_spend, ga.w_t_spend)                          AS spend_t_w,
         IF(ga.task_id IS NULL, a.ct_spend, ga.w_ct_spend)                        AS spend_ct_w,
         IF(ga.task_id IS NULL, a.p_start, ga.m_start)                            AS m_start,
         IF(ga.task_id IS NULL, a.p_end, ga.m_end)                                AS m_end,
         t7.amer_7d,
         x.aov_new_hist, x.gm_rate_hist,
         IFNULL(ga.w_ncr, 0)  AS num_g,
         IFNULL(ga.w_paid, 0) AS den_g
  FROM agg2b a
  LEFT JOIN gate_units gu ON a.period_type = 'gate' AND gu.client_id = a.client_id AND gu.task_id = a.task_id
  LEFT JOIN gate_amer ga  ON a.period_type = 'gate' AND ga.client_id = a.client_id AND ga.task_id = a.task_id
  LEFT JOIN tr7 t7        ON t7.client_id = a.client_id
  LEFT JOIN hist x        ON x.client_id = a.client_id
),
-- unpivot to metrics; gate rows use thresholds as targets, prorated by the curve
lng AS (
  -- every metric gets an actuals row; target columns stay NULL when the period has none
  SELECT a.*, m.* EXCEPT (t, ct, bt, bct),
         IF(m.has_target, m.t, NULL)   AS t,
         IF(m.has_target, m.ct, NULL)  AS ct,
         IF(m.has_target, m.bt, NULL)  AS bt,
         IF(m.has_target, m.bct, NULL) AS bct
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
           CAST(a.c_units AS FLOAT64), a.t_orders_eff, CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64)),
    -- 279g: CM3. Gate: the floor gets the same component curve as a target,
    -- floor_to_date = (floor + planned spend) x revenue share to date - planned spend to date.
    STRUCT('cm3', IF(a.period_type = 'gate', a.thr_cm3 IS NOT NULL, a.has_cm3),
           IF(a.period_type = 'gate', a.thr_cm3, a.t_cm3),
           IF(a.period_type = 'gate', (a.thr_cm3 + a.t_spend) * a.curve_share_to_date - a.ct_spend, a.ct_cm3),
           a.c_cm3_eff, a.t_cm3, CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64)),
    -- 279g: aMER, a ratio. t / ct / c are ratios; agg3 num_* / den_* carry the parts.
    STRUCT('amer', IF(a.period_type = 'gate', a.thr_amer IS NOT NULL, a.has_amer),
           IF(a.period_type = 'gate', a.thr_amer, SAFE_DIVIDE(a.num_t, a.den_t)),
           IF(a.period_type = 'gate', a.thr_amer, SAFE_DIVIDE(a.num_ct, a.den_ct)),
           IF(a.n_den_missing > 0, NULL, SAFE_DIVIDE(a.num_c, NULLIF(a.den_c, 0))),
           SAFE_DIVIDE(a.num_t, a.den_t), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64))
  ]) AS m
  WHERE (a.period_type != 'gate' AND m.metric != 'units')
     OR (a.period_type = 'gate' AND m.has_target
         AND (m.t IS NOT NULL
              OR (m.metric = 'orders' AND a.thr_orders IS NULL AND a.thr_revenue IS NULL AND a.thr_new IS NULL
                  AND a.thr_units IS NULL AND a.thr_cm3 IS NULL AND a.thr_amer IS NULL)))
),
calc AS (
  SELECT l.*,
         l.as_of < IF(l.metric = 'amer', l.m_start, l.p_start) AS not_started,
         l.as_of >= l.p_end   AS is_closed,
         l.k * SAFE_DIVIDE(l.t_curve, l.t_orders_eff) AS k_m,
         -- z noise scale (one standard deviation of C - CT)
         CASE l.metric
           WHEN 'revenue'  THEN SQRT(l.phi * l.ct_orders_eff * (1 + l.cv * l.cv)) * l.aov_plan
           WHEN 'ad_spend' THEN NULL
           -- 279g: CM3 noise = gross margin noise of the expected orders to date
           WHEN 'cm3'  THEN SQRT(l.phi * l.ct_orders_eff * (1 + l.cv * l.cv)) * l.aov_plan * l.gm_rate_hist
           -- 279g: aMER noise on the numerator: new customer revenue expected on the actual spend
           WHEN 'amer' THEN SQRT(l.phi * GREATEST(SAFE_DIVIDE(l.ct * l.den_c, l.aov_new_hist), 0)
                                 * (1 + l.cv * l.cv)) * l.aov_new_hist
           ELSE SQRT(l.phi * l.ct)
         END AS sd
  FROM lng l
),
calc2 AS (
  SELECT c.*,
         IF(c.metric = 'cm3' AND NOT c.ct > 0, NULL, SAFE_DIVIDE(c.c, c.ct)) AS pace,
         IF(c.metric = 'amer', SAFE_DIVIDE(c.num_c - c.ct * c.den_c, c.sd),
            SAFE_DIVIDE(c.c - c.ct, c.sd)) AS z,
         CASE
           WHEN c.t IS NULL THEN NULL
           WHEN c.is_closed THEN c.c
           WHEN c.not_started THEN IF(c.metric = 'amer', c.t_curve, c.t)
           -- 279g CM3: gross margin to come at the shrunk revenue pace, minus the planned
           -- spend to come: C + (GM_T - GM_CT) x pf - (S_T - S_CT), GM = CM3 + spend
           WHEN c.metric = 'cm3' THEN
             c.c + ((c.t + c.t_spend) - (c.ct + c.ct_spend))
                   * SAFE_DIVIDE(c.c + c.c_paid + c.k * c.aov_plan * c.gm_rate_hist,
                                 c.ct + c.ct_spend + c.k * c.aov_plan * c.gm_rate_hist)
                 - (c.t_spend - c.ct_spend)
           -- 279g aMER: (num to date + plan ratio of the rest x shrunk pace x spend to come)
           --            / (spend to date + spend to come); spend to come = plan, else run-rate
           WHEN c.metric = 'amer' THEN
             SAFE_DIVIDE(
               c.num_c + IFNULL(SAFE_DIVIDE(c.num_t - c.num_ct, NULLIF(c.den_t - c.den_ct, 0)), c.t_curve)
                         * SAFE_DIVIDE(c.num_c + c.k * c.aov_new_hist, c.ct * c.den_c + c.k * c.aov_new_hist)
                         * IF(IFNULL(c.spend_t_w, 0) > 0, c.spend_t_w - c.spend_ct_w,
                              SAFE_DIVIDE(c.den_c, c.days_elapsed) * (c.days_total - c.days_elapsed)),
               c.den_c + IF(IFNULL(c.spend_t_w, 0) > 0, c.spend_t_w - c.spend_ct_w,
                            SAFE_DIVIDE(c.den_c, c.days_elapsed) * (c.days_total - c.days_elapsed)))
           ELSE c.c + (c.t - c.ct) * SAFE_DIVIDE(c.c + c.k_m, c.ct + c.k_m)
         END AS proj,
         -- 279g: spend still to come in the period / window (plan, else run-rate)
         IF(c.metric = 'amer' AND NOT c.is_closed,
            IF(IFNULL(c.spend_t_w, 0) > 0, c.spend_t_w - c.spend_ct_w,
               SAFE_DIVIDE(c.den_c, c.days_elapsed) * (c.days_total - c.days_elapsed)), NULL) AS spend_rest,
         -- remaining orders expected (for the cone)
         IF(c.is_closed OR c.t IS NULL, 0,
            CASE c.metric
              WHEN 'orders'        THEN (c.t - c.ct) * SAFE_DIVIDE(c.c + c.k_m, c.ct + c.k_m)
              WHEN 'new_customers' THEN (c.t - c.ct) * SAFE_DIVIDE(c.c + c.k_m, c.ct + c.k_m)
              WHEN 'revenue'       THEN (c.t_orders_eff - c.ct_orders_eff) * c.pf_orders
            END) AS rem_units,
         CASE
           WHEN c.period_type IN ('month', 'quarter') THEN c.days_elapsed < 5
           -- 279g: an aMER window is too early below 30 % of its qualifying or planned spend
           WHEN c.metric = 'amer' AND c.period_type IN ('promo', 'gate') THEN
             c.den_c < 0.3 * COALESCE(c.amer_min_spend, NULLIF(c.spend_t_w, 0), c.den_c + 1)
           WHEN c.metric = 'cm3' AND c.period_type IN ('promo', 'gate') THEN
             c.days_total < 7 AND c.curve_share_to_date < 0.3
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
         IF(c.period_type = 'quarter' AND c.t IS NOT NULL AND c.metric != 'amer', qp.proj, c.proj) AS projected_end
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
  IF(metric IN ('ad_spend', 'cm3', 'amer') OR t IS NULL OR not_started OR is_closed, NULL,
     projected_end - 1.2816 * SQRT(phi * GREATEST(rem_units, 0) * IF(metric = 'revenue', 1 + cv * cv, 1))
                     * IF(metric = 'revenue', aov_plan, 1))  AS projected_low,
  IF(metric IN ('ad_spend', 'cm3', 'amer') OR t IS NULL OR not_started OR is_closed, NULL,
     projected_end + 1.2816 * SQRT(phi * GREATEST(rem_units, 0) * IF(metric = 'revenue', 1 + cv * cv, 1))
                     * IF(metric = 'revenue', aov_plan, 1))  AS projected_high,
  IF(is_closed OR t IS NULL OR metric = 'amer', NULL,
     SAFE_DIVIDE(t - c, days_total - days_elapsed))          AS required_daily_rate,
  IF(is_closed OR t IS NULL OR metric = 'amer', NULL, SAFE_DIVIDE(t - c, t - ct)) AS required_curve_mult,
  IF(not_started OR is_closed, NULL, ROUND(z, 3))            AS z_score,
  CASE
    WHEN not_started THEN 'not_started'
    WHEN is_closed THEN 'closed'
    -- 279g: CM3 (may be negative: judged on the gap relative to the target and its noise)
    WHEN metric = 'cm3' AND NOT (period_type = 'day' OR t IS NULL OR ct IS NULL) THEN
      CASE
        WHEN c IS NULL THEN NULL
        WHEN is_too_early THEN 'on_track'
        WHEN z <= -1.645 AND SAFE_DIVIDE(c - ct, ABS(t)) < -0.10 THEN 'off_track'
        WHEN z <= -1.0   AND SAFE_DIVIDE(c - ct, ABS(t)) < -0.03 THEN 'behind'
        WHEN z >= 1.645  AND SAFE_DIVIDE(c - ct, ABS(t)) > 0.10  THEN 'ahead'
        ELSE 'on_track'
      END
    -- 279g: aMER floor of a Checkpoint: below the floor is behind, significantly below is
    -- off track; a window that will not reach its min spend is behind
    WHEN metric = 'amer' AND period_type = 'gate' AND t IS NOT NULL THEN
      CASE
        WHEN is_too_early OR c IS NULL THEN 'on_track'
        WHEN amer_min_spend IS NOT NULL AND den_c + IFNULL(spend_rest, 0) < amer_min_spend THEN 'behind'
        WHEN c >= t AND pace > 1.10 AND z >= 1.645 THEN 'ahead'
        WHEN c >= t THEN 'on_track'
        WHEN z <= -1.645 THEN 'off_track'
        ELSE 'behind'
      END
    -- 279g: aMER of a period: actual ratio to date vs the plan ratio to date
    WHEN metric = 'amer' AND NOT (period_type = 'day' OR t IS NULL OR ct IS NULL OR ct <= 0) THEN
      CASE
        WHEN c IS NULL THEN NULL
        WHEN is_too_early THEN 'on_track'
        WHEN pace < 0.90 AND z <= -1.645 THEN 'off_track'
        WHEN pace < 0.97 AND z <= -1.0   THEN 'behind'
        WHEN pace > 1.10 AND z >= 1.645  THEN 'ahead'
        ELSE 'on_track'
      END
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
    -- 279g: a condition that cannot be measured (no cost data, missing spend) has no result
    WHEN period_type = 'gate' AND ((thr_cm3 IS NOT NULL AND c_cm3_eff IS NULL)
                                   OR (thr_amer IS NOT NULL AND n_den_missing > 0)) THEN NULL
    WHEN period_type = 'gate' THEN
      IF(c_orders >= IFNULL(thr_orders, 0) AND c_revenue >= IFNULL(thr_revenue, 0)
         AND c_new >= IFNULL(thr_new, 0)
         AND c_units >= IFNULL(thr_units, 0)
         AND (mer_cap_pct IS NULL OR 100 * SAFE_DIVIDE(c_spend, c_revenue) <= mer_cap_pct)
         -- 279g
         AND (thr_cm3 IS NULL OR c_cm3_eff >= thr_cm3)
         AND (thr_amer IS NULL OR (IFNULL(SAFE_DIVIDE(num_g, NULLIF(den_g, 0)), 0) >= thr_amer
                                   AND den_g >= IFNULL(amer_min_spend, 0))), 'met', 'missed')
    WHEN metric IN ('cm3', 'amer') AND c IS NULL THEN NULL
    WHEN c >= t THEN 'met' ELSE 'missed'
  END                                                        AS result,
  is_preliminary AND NOT not_started                         AS is_preliminary,
  mer_cap_pct,
  ROUND(100 * SAFE_DIVIDE(t_spend, t_revenue), 2)            AS mer_plan_pct,
  IF(not_started, NULL, ROUND(100 * SAFE_DIVIDE(c_spend, c_revenue), 2)) AS mer_actual_pct,
  aov_plan,
  CAST(NULL AS FLOAT64)                                      AS attributed_orders,
  attr_t                                                     AS attributed_target,
  -- 279g (appended; NULL on the rows of the other metrics)
  IF(metric = 'amer' AND NOT not_started, num_c, NULL)       AS ratio_num_actual,
  IF(metric = 'amer' AND NOT not_started, den_c, NULL)       AS ratio_den_actual,
  IF(metric = 'amer', num_ct, NULL)                          AS ratio_num_target_to_date,
  IF(metric = 'amer', den_ct, NULL)                          AS ratio_den_target_to_date,
  IF(metric = 'amer', num_t, NULL)                           AS ratio_num_target,
  IF(metric = 'amer', den_t, NULL)                           AS ratio_den_target,
  IF(metric = 'amer' AND period_type != 'day' AND NOT not_started AND NOT is_closed,
     amer_7d, NULL)                                          AS trailing_7d_ratio,
  IF(metric = 'amer' AND t IS NOT NULL AND NOT is_closed AND NOT not_started AND spend_rest > 0,
     SAFE_DIVIDE(t * (den_c + spend_rest) - num_c, spend_rest), NULL) AS required_ratio,
  IF(metric = 'amer', m_start, p_start)                      AS measure_start,
  IF(metric = 'amer', m_end, p_end)                          AS measure_end,
  IF(period_type = 'gate' AND metric = 'amer', amer_min_spend, NULL) AS min_spend,
  IF(period_type = 'gate' AND t IS NOT NULL AND NOT not_started AND c IS NOT NULL,
     c >= t AND (metric != 'amer' OR den_c >= IFNULL(amer_min_spend, 0)), NULL) AS condition_met,
  CASE metric
    WHEN 'cm3'  THEN n_cm3_unmeasured = 0
    WHEN 'amer' THEN n_den_missing = 0
    ELSE TRUE
  END                                                        AS is_measured
FROM final;


CALL `oneeighty-warehouse.mart.sp_refresh_plan_pacing`();
