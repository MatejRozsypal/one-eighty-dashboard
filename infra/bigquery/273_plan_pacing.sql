-- =============================================================================
-- 273_plan_pacing.sql
-- Promo pacing (package pp1), step 4 of 4: pacing and plan checks.
--
-- Change (additive)
--   NEW VIEW      mart.plan_pacing_v           the pacing logic below
--   NEW PROCEDURE mart.sp_refresh_plan_pacing() CALLs mart.sp_refresh_plan_targets_daily(),
--                 then rebuilds mart.plan_pacing from the view (__next, ASSERT rows > 0 and
--                 unique key, COPY swap). Schedule hourly (n8n, 253 pattern).
--   NEW TABLE     mart.plan_pacing  (view columns + refreshed_at), CLUSTER BY client_id,
--                 period_type, metric. The dashboard reads this table.
--   NEW VIEW      mart.plan_checks
--
-- Purpose
--   mart.plan_pacing: ONE long table for every Plan page view. Row = client_id x
--   period_type ('day','week','month','quarter','promo','gate') x period_id x metric
--   ('revenue','orders','new_customers','ad_spend'), as of yesterday (Europe/Prague).
--   mart.plan_checks: plan data issues (overlapping promo windows, info only, months whose daily
--   targets do not sum to the month target, quarter vs month sums, missing levels,
--   names that do not match the Level and dates, checkpoints without a threshold).
--
-- Actuals (store level, whole shop, Woo clients in v1)
--   orders        COUNT(DISTINCT order_id), stg.stg_woo_orders, total_price > 0
--   revenue       SUM(subtotal_price - IFNULL(total_refunded, 0)): goods ex VAT after
--                 discounts and refunds, WITHOUT shipping. This is the definition the
--                 targets were set in (raw/04 0.1). /goals today shows
--                 mart_daily_kpis.revenue = stg net_revenue, which ADDS shipping ex VAT
--                 (+2.6 to 3.5 % for Ethia Jul to Sep 2026) and counts total_price = 0
--                 orders (+1 order in Aug and Sep). Using it would read "ahead" by about 3 %
--                 every day. Choose mart revenue only if the targets are restated with
--                 shipping.
--   new_customers COUNTIF(is_returning_customer = FALSE)
--   ad_spend      Meta spend in client currency (stg.stg_meta_campaign_insights x
--                 ref.fx_rates, same rule as mart_daily_kpis.meta_spend; matches it to the
--                 crown for Ethia Oct 2026). Google Ads not included in v1 (Ethia has none).
--
-- Method (projects/promo-pacing/raw/04 section 2)
--   as_of         LEAST(yesterday Prague, day before the last order load).
--   T, CT, C      period target, curve target to as_of, actual to as_of (days with
--                 targets only; periods are clipped to the target calendar).
--   pace_pct      100 x C / CT. gap_abs = C - CT.
--   projected_end C + (T - CT) x pf, pf = (C + K) / (CT + K), K = 30 orders scaled by
--                 T_metric / T_orders (shrunk to plan early). Quarter = sum of month
--                 projections (raw/04 2.6). Closed: C. Not started: T.
--   projected_low/high  80 % cone: orders and new customers +- 1.2816 sqrt(phi R),
--                 revenue +- 1.2816 sqrt(phi R_orders (1 + CV^2)) AOV_plan.
--   status        not_started (as_of < start), closed (as_of >= end), else
--                 off_track pace < 90 % and z <= -1.645; behind pace < 97 % and z <= -1;
--                 ahead pace > 110 % and z >= 1.645; else on_track.
--                 z = (C - CT) / sqrt(phi CT) (orders, new customers),
--                 z = (C - CT) / (sqrt(phi CT_orders (1 + CV^2)) AOV_plan) (revenue).
--                 ad_spend has no z: pace < 80 off_track, < 90 behind, > 110 ahead.
--                 Too early (is_too_early, status forced to on_track): month or quarter
--                 before day 5; promo or gate shorter than 7 days before 30 % of CT.
--                 Day rows only get not_started / closed.
--   Gate          measured window = Start to Due, inclusive (ClickUp convention: G1
--                 9. to 19. 10., checked 20. 10.). No Start: from the quarter start of
--                 Due. target_total = threshold,
--                 target_to_date = threshold x curve share to date. result 'met' needs
--                 every stated threshold (orders, revenue, new customers, MER cap).
--   Promo         whole store in the window vs the curve slice of the window.
--                 attributed_orders stays NULL until pp2 (mart.plan_promo_orders).
--   Parameters    phi 1.48, CV 0.52, K 30 for Ethia (raw/04 1.8); defaults 1.5, 0.5, 30.
--
-- Based on live view: none (new objects). Reads mart.plan_targets_daily (272),
--   mart.plan_targets (271), mart.plan_input (270), stg.stg_woo_orders,
--   stg.stg_meta_campaign_insights, ref.clients, ref.fx_rates.
-- Affected clients: clients with plan rows (ethia). Regression: not applicable (new).
-- Validation 2026-10-06 (QA copies, as_of 2026-10-05): 623 rows (day 492, week 72,
--   month 16, quarter 4, promo 36, gate 3), key unique; October orders CT 15.61 equals the
--   hand calculation 105 x 5 / 33.629; plan_checks 0 errors, 3 warnings, 5 info.
--   One CALL processes ~142 MB (stg_woo_orders + Meta insights).
-- QA copies: mart_qa.pp1_plan_pacing, mart_qa.pp1_plan_checks.
-- Deploy order: 270, 271, 272, 273.
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
  LEFT JOIN UNNEST([STRUCT('ethia' AS client_id, 1.48 AS phi, 0.52 AS cv, 30.0 AS k)]) o
    ON o.client_id = c.client_id
),
orders AS (
  SELECT o.client_id, o.order_id, o.order_date AS d, o.ingested_at,
         CAST(o.subtotal_price - IFNULL(o.total_refunded, 0) AS FLOAT64) AS net,
         o.is_returning_customer
  FROM `oneeighty-warehouse.stg.stg_woo_orders` o
  JOIN clients c ON c.client_id = o.client_id
  WHERE o.total_price > 0
),
as_of AS (
  SELECT client_id,
         LEAST(DATE_SUB(CURRENT_DATE('Europe/Prague'), INTERVAL 1 DAY),
               DATE_SUB(DATE(MAX(ingested_at), 'Europe/Prague'), INTERVAL 1 DAY)) AS as_of
  FROM orders GROUP BY client_id
),
act_orders AS (
  SELECT client_id, d,
         COUNT(DISTINCT order_id)                 AS orders,
         SUM(net)                                 AS revenue,
         COUNTIF(is_returning_customer = FALSE)   AS new_customers
  FROM orders GROUP BY 1, 2
),
act_spend AS (
  SELECT m.client_id, m.date_start AS d,
         CAST(SUM(m.spend * IF(rc.meta_currency = rc.currency, NUMERIC '1', fx.rate)) AS FLOAT64) AS ad_spend
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` m
  JOIN clients c ON c.client_id = m.client_id
  JOIN `oneeighty-warehouse.ref.clients` rc ON rc.client_id = m.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
    ON  fx.month_start   = DATE_TRUNC(m.date_start, MONTH)
    AND fx.from_currency = rc.meta_currency
    AND fx.to_currency   = rc.currency
  WHERE m.date_start >= (SELECT MIN(date) FROM td)
  GROUP BY 1, 2
),
-- one row per client x day with targets, wide
base AS (
  SELECT t.client_id, t.date, a.as_of,
         SUM(IF(t.metric = 'orders',        t.target_daily, 0)) AS t_orders,
         SUM(IF(t.metric = 'revenue',       t.target_daily, 0)) AS t_revenue,
         SUM(IF(t.metric = 'new_customers', t.target_daily, 0)) AS t_new,
         SUM(IF(t.metric = 'ad_spend',      t.target_daily, 0)) AS t_spend,
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
  LEFT JOIN act_orders o ON o.client_id = b.client_id AND o.d = b.date
  LEFT JOIN act_spend s  ON s.client_id = b.client_id AND s.d = b.date
),
plan AS (
  SELECT * FROM `oneeighty-warehouse.mart.plan_input`
  WHERE start_date IS NOT NULL OR level = 'Checkpoint'
),
-- period definitions: id, label, defined start / end, task, thresholds
periods AS (
  SELECT DISTINCT client_id, 'day' AS period_type, FORMAT_DATE('%F', date) AS period_id,
         FORMAT_DATE('%a %e %b %Y', date) AS period_label, date AS p_start, date AS p_end,
         CAST(NULL AS STRING) AS task_id, CAST(NULL AS STRING) AS plan_status, CAST(NULL AS FLOAT64) AS mer_cap_pct,
         CAST(NULL AS FLOAT64) AS thr_orders, CAST(NULL AS FLOAT64) AS thr_revenue, CAST(NULL AS FLOAT64) AS thr_new,
         CAST(NULL AS FLOAT64) AS attr_orders_target, CAST(NULL AS FLOAT64) AS attr_new_target,
         CAST(NULL AS FLOAT64) AS attr_revenue_target
  FROM base
  UNION ALL
  SELECT DISTINCT client_id, 'week', FORMAT_DATE('%G-W%V', date), FORMAT_DATE('Week %V %G', date),
         DATE_TRUNC(date, ISOWEEK), DATE_ADD(DATE_TRUNC(date, ISOWEEK), INTERVAL 6 DAY),
         CAST(NULL AS STRING), CAST(NULL AS STRING), CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64)
  FROM base
  UNION ALL
  SELECT client_id, 'month', FORMAT_DATE('%Y-%m', month_start), ANY_VALUE(month_label),
         month_start, LAST_DAY(month_start), ANY_VALUE(month_task_id), 'approved', ANY_VALUE(month_mer_cap_pct),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64)
  FROM td
  GROUP BY client_id, month_start
  UNION ALL
  SELECT client_id, 'quarter', FORMAT_DATE('%Y-Q%Q', start_date), name, start_date, end_date,
         task_id, status, mer_cap_pct, CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64)
  FROM plan WHERE level = 'Quarter' AND is_valid
  UNION ALL
  SELECT client_id, 'promo', task_id, name, start_date, end_date, task_id, status, mer_cap_pct,
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64),
         CAST(target_orders AS FLOAT64), CAST(target_new_customers AS FLOAT64), CAST(target_revenue AS FLOAT64)
  FROM plan WHERE level = 'Promo' AND (is_valid OR status = 'planning') AND end_date IS NOT NULL
  UNION ALL
  SELECT client_id, 'gate', task_id, name,
         COALESCE(start_date, DATE_TRUNC(end_date, QUARTER)),
         end_date,
         task_id, status, mer_cap_pct,
         CAST(target_orders AS FLOAT64), CAST(target_revenue AS FLOAT64), CAST(target_new_customers AS FLOAT64),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64)
  FROM plan WHERE level = 'Checkpoint' AND is_valid AND end_date IS NOT NULL
),
agg AS (
  SELECT p.client_id, p.period_type, p.period_id, p.period_label, p.p_start, p.p_end, p.task_id,
         p.plan_status, p.mer_cap_pct, p.thr_orders, p.thr_revenue, p.thr_new,
         p.attr_orders_target, p.attr_new_target, p.attr_revenue_target,
         ANY_VALUE(b.as_of) AS as_of,
         COUNT(b.date) AS target_days,
         SUM(b.t_orders) AS t_orders, SUM(b.t_revenue) AS t_revenue, SUM(b.t_new) AS t_new, SUM(b.t_spend) AS t_spend,
         SUM(IF(b.is_elapsed, b.t_orders, 0))  AS ct_orders,
         SUM(IF(b.is_elapsed, b.t_revenue, 0)) AS ct_revenue,
         SUM(IF(b.is_elapsed, b.t_new, 0))     AS ct_new,
         SUM(IF(b.is_elapsed, b.t_spend, 0))   AS ct_spend,
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
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15
),
agg2 AS (
  SELECT a.*, pr.phi, pr.cv, pr.k,
         DATE_DIFF(a.p_end, a.p_start, DAY) + 1 AS days_total,
         GREATEST(0, LEAST(DATE_DIFF(a.as_of, a.p_start, DAY) + 1, DATE_DIFF(a.p_end, a.p_start, DAY) + 1)) AS days_elapsed,
         SAFE_DIVIDE(a.t_revenue, a.t_orders) AS aov_plan,
         SAFE_DIVIDE(a.c_orders + pr.k, a.ct_orders + pr.k) AS pf_orders
  FROM agg a JOIN params pr ON pr.client_id = a.client_id
),
-- unpivot to metrics; gate rows use thresholds as targets, prorated by the curve
lng AS (
  SELECT a.*, m.*
  FROM agg2 a,
  UNNEST([
    STRUCT('orders' AS metric, a.has_orders AS has_target,
           IF(a.period_type = 'gate', a.thr_orders, a.t_orders) AS t,
           IF(a.period_type = 'gate', a.thr_orders * SAFE_DIVIDE(a.ct_orders, a.t_orders), a.ct_orders) AS ct,
           CAST(a.c_orders AS FLOAT64) AS c, a.t_orders AS t_curve, a.attr_orders_target AS attr_t),
    STRUCT('revenue', a.has_revenue,
           IF(a.period_type = 'gate', a.thr_revenue, a.t_revenue),
           IF(a.period_type = 'gate', a.thr_revenue * SAFE_DIVIDE(a.ct_revenue, a.t_revenue), a.ct_revenue),
           a.c_revenue, a.t_revenue, a.attr_revenue_target),
    STRUCT('new_customers', a.has_new,
           IF(a.period_type = 'gate', a.thr_new, a.t_new),
           IF(a.period_type = 'gate', a.thr_new * SAFE_DIVIDE(a.ct_new, a.t_new), a.ct_new),
           CAST(a.c_new AS FLOAT64), a.t_new, a.attr_new_target),
    STRUCT('ad_spend', a.has_spend,
           IF(a.period_type = 'gate', NULL, a.t_spend),
           IF(a.period_type = 'gate', NULL, a.ct_spend),
           a.c_spend, a.t_spend, CAST(NULL AS FLOAT64))
  ]) AS m
  WHERE m.has_target
    AND (a.period_type != 'gate' OR m.t IS NOT NULL
         OR (m.metric = 'orders' AND a.thr_orders IS NULL AND a.thr_revenue IS NULL AND a.thr_new IS NULL))
),
calc AS (
  SELECT l.*,
         l.as_of < l.p_start  AS not_started,
         l.as_of >= l.p_end   AS is_closed,
         l.k * SAFE_DIVIDE(l.t_curve, l.t_orders) AS k_m,
         -- z noise scale (one standard deviation of C - CT)
         CASE l.metric
           WHEN 'revenue'  THEN SQRT(l.phi * l.ct_orders * (1 + l.cv * l.cv)) * l.aov_plan
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
              WHEN 'revenue'       THEN (c.t_orders - c.ct_orders) * c.pf_orders
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
         AND (mer_cap_pct IS NULL OR 100 * SAFE_DIVIDE(c_spend, c_revenue) <= mer_cap_pct), 'met', 'missed')
    WHEN c >= t THEN 'met' ELSE 'missed'
  END                                                        AS result,
  is_preliminary AND NOT not_started                         AS is_preliminary,
  mer_cap_pct,
  ROUND(100 * SAFE_DIVIDE(t_spend, t_revenue), 2)            AS mer_plan_pct,
  IF(not_started, NULL, ROUND(100 * SAFE_DIVIDE(c_spend, c_revenue), 2)) AS mer_actual_pct,
  aov_plan,
  CAST(NULL AS FLOAT64)                                      AS attributed_orders,
  attr_t                                                     AS attributed_target
FROM final;

-- Materialised table read by the dashboard (one cheap scan instead of the view chain;
-- pp2 measured mart_daily_kpis at ~430 MB per query). Refresh hourly: one CALL rebuilds
-- the daily curve (272) and then this table.
CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_plan_pacing`()
BEGIN
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
                       AND target_new_customers IS NULL AND mer_cap_pct IS NULL THEN 'no numeric threshold'
                  WHEN level = 'Month' AND (target_revenue IS NULL OR target_orders IS NULL) THEN 'no revenue or orders target'
                END)
  FROM p
  WHERE status NOT IN ('rejected', 'on hold')
    AND ((start_date IS NULL AND level != 'Checkpoint') OR end_date IS NULL
      OR (level = 'Promo' AND mechanic IS NULL)
      OR (level = 'Checkpoint' AND target_orders IS NULL AND target_revenue IS NULL
          AND target_new_customers IS NULL AND mer_cap_pct IS NULL)
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
