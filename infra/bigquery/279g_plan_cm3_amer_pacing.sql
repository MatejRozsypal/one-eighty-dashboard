-- =============================================================================
-- 279g_plan_cm3_amer_pacing.sql
-- Promo pacing, package ca1, part 2 of 3: CM3 and aMER as plan metrics for day, week,
-- month, quarter, promo and checkpoint rows of mart.plan_pacing.
--
-- Definitions (METRICS.md, the mart definitions, so the numbers equal Snapshot, P&L and
-- Reports for clients without per-order rates in Settings, which is Ethia and Manami today)
--   cm3   revenue - cogs - fulfillment_cost - paid_spend, from mart.mart_daily_kpis.
--         n/a (NULL), never 0, when any elapsed day of the period has revenue without cost
--         data (RawBark today). Additive.
--   amer  SUM(new_customer_revenue) / SUM(paid_spend), from mart.mart_daily_kpis. A ratio,
--         never pre-divided per day: every period carries numerator and denominator.
--         n/a when a day in the period has missing spend (mart rule 235).
--
-- Targets (ClickUp only, two fields read by 279f; no seed, no constants here)
--   Month / Quarter `Target CM3`, `Target aMER`. A month without a Month task gets the
--   quarter's CM3 remainder (seasonal share, like revenue, not floored at 0) and the
--   quarter's aMER (a ratio is inherited, never split).
--   Daily CM3 curve: cm3_d = (T_cm3 + T_spend) x revenue_share_d - spend_d (gross margin on
--   the revenue curve minus the flat spend plan; sums to T_cm3). Backtest in raw/12.
--   Daily aMER: numerator = aMER x planned spend of the day, denominator = planned spend
--   (1 a day without Ad budget). Period target = SUM(num) / SUM(den).
--
-- Pacing
--   cm3   pace = C / CT when CT > 0 (else n/a). z = (C - CT) / sd, sd = gross margin noise of
--         the expected orders. Status: off_track z <= -1.645 and gap < -10 % of |T|; behind
--         z <= -1 and gap < -3 %; ahead z >= 1.645 and gap > +10 %; else on_track.
--         Projection = C + (GM still planned) x shrunk revenue pace - spend still planned.
--   amer  ct = plan ratio to date, c = actual ratio to date, pace = c / ct. z on the
--         numerator: (num - ct x spend) / sd(new customer revenue). Status thresholds as for
--         orders. Projection = (num + plan ratio of the rest x shrunk pace x spend to come)
--         / (spend + spend to come), spend to come = plan, else run-rate. Quarter = own
--         ratio (never a sum of month ratios). required_ratio = ratio needed on the spend to
--         come. trailing_7d_ratio = aMER of the 7 days ending as_of (the scale rule).
--         ratio_den_actual is the paid spend the ratio is computed on; the page always
--         shows it next to the figure, so "2.70x" is never read without its spend.
--   Checkpoint (period_type 'gate') floors, both measured over the task's own Start..Due
--   (the dates are the window; a different window is a different checkpoint task):
--     cm3   Target CM3 = floor; the floor gets the target's component curve, status as
--           above against it; condition_met = C >= floor.
--     amer  Target aMER = floor. A ratio on trivial spend is noise, so the floor only
--           counts once the window has carried AMER_MIN_SPEND_SHARE = 50 % of the Ad budget
--           the plan put in it (plan_targets_daily ad_spend over Start..Due, so a window
--           crossing months pro rates itself). DERIVED, never entered: the two hand-written
--           minimums of the Ethia gates were 59 % and 95 % of their windows' planned spend,
--           so half is below both and never stricter than the intent, while a verdict on
--           less than half the planned spend carries about 1.4x the sampling error and is
--           not worth acting on. No Ad budget in the window (every Manami month today):
--           min_spend is NULL, the floor is judged on the ratio alone and plan_checks logs
--           `amer_no_budget`. Status: below the floor = behind, significantly below =
--           off_track, a window whose actual + planned spend cannot reach min_spend =
--           behind; too early below 30 % of the planned spend.
--           condition_met = ratio >= floor AND window spend >= min_spend.
--     result (whole checkpoint, every row) adds both conditions; n/a when one of them is
--     not measurable.
--
-- Change (CREATE OR REPLACE, columns and metrics APPENDED; every existing metric row and
-- column computes as before: QA EXCEPT DISTINCT both ways = 0 rows, raw/12 section 4)
--   mart.plan_actuals_daily_v    + kpi_revenue, new_customer_revenue, new_customer_orders,
--                                  paid_spend, cm3, is_cm3_measured, is_spend_missing
--                                  (reads mart.mart_daily_kpis: about +450 MB per hourly run,
--                                  about 320 GB a month; switch to mart.rpt_kpis_daily once
--                                  its hourly refresh is live, one line in CTE kpi)
--   mart.plan_actuals_monthly_v  + cm3, new_customer_revenue, paid_spend, amer
--   mart.plan_targets            + metrics 'cm3', 'amer'
--   mart.plan_targets_daily_v    + metrics 'cm3', 'amer'; + columns ratio_den_daily, target_ratio
--   mart.plan_pacing_v           + metrics 'cm3', 'amer'; + columns ratio_num_actual,
--                                  ratio_den_actual, ratio_num_target_to_date,
--                                  ratio_den_target_to_date, ratio_num_target, ratio_den_target,
--                                  trailing_7d_ratio, required_ratio, min_spend,
--                                  condition_met, is_measured
--   mart.plan_checks             + quarter CM3 vs months (0.5 % tolerance), quarter aMER vs
--                                  months, aMER floor without an Ad budget, CM3 target
--                                  without cost data; Checkpoint threshold check knows the
--                                  two new fields
--   Procedures unchanged.
--
-- Based on live views read 2026-10-07 (normalised md5 equal to the repo files): 279b
--   plan_actuals_daily_v / plan_actuals_monthly_v, 279c plan_targets / plan_targets_daily_v /
--   plan_checks, 279d plan_pacing_v; mart.mart_daily_kpis (235, 234).
-- Affected clients: ethia, manami (new metric rows; CM3 and aMER targets n/a until the
--   ClickUp fields exist). Clients without COGS: CM3 n/a.
-- QA copies: mart_qa.ca1_* (raw/12).
-- Deploy order: 279f, then this file (it ends with CALL mart.sp_refresh_plan_pacing()).
-- =============================================================================

-- =============================================================================
-- 1. mart.plan_actuals_daily_v (279b + mart CM3, new customer revenue, paid spend)
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_actuals_daily_v` AS
WITH
clients AS (
  SELECT client_id, currency, timezone, shop_platform, meta_currency
  FROM `oneeighty-warehouse.ref.clients`
),
params AS (                  -- evergreen coupon codes, never a campaign window
  SELECT c.client_id, IFNULL(p.evergreen_codes, r'^$') AS evergreen_codes
  FROM clients c
  LEFT JOIN UNNEST([
    STRUCT('ethia' AS client_id, r'^(MUJPRVNI|PRVNINAKUP10|ZNOVU10)$' AS evergreen_codes)
  ]) p ON p.client_id = c.client_id
),
o AS (SELECT * FROM `oneeighty-warehouse.mart.plan_orders`),   -- snapshot of plan_orders_v
bounds AS (
  SELECT o.client_id, MIN(o.order_date) AS first_date,
         LEAST(DATE_SUB(CURRENT_DATE(ANY_VALUE(c.timezone)), INTERVAL 1 DAY),
               DATE_SUB(DATE(MAX(o.ingested_at), ANY_VALUE(c.timezone)), INTERVAL 1 DAY)) AS as_of
  FROM o JOIN clients c ON c.client_id = o.client_id
  GROUP BY o.client_id
),
day_orders AS (
  SELECT client_id, order_date AS date,
         COUNT(*)                         AS orders,
         SUM(net_revenue)                 AS revenue,
         COUNTIF(is_new_customer)         AS new_customers,
         SUM(units)                       AS units
  FROM o GROUP BY 1, 2
),
code_windows AS (           -- campaign code: 5+ orders within at most 45 days
  SELECT o.client_id, code, MIN(o.order_date) AS s, MAX(o.order_date) AS e
  FROM o JOIN params p ON p.client_id = o.client_id, UNNEST(o.coupon_codes) AS code
  WHERE NOT REGEXP_CONTAINS(code, p.evergreen_codes)
  GROUP BY 1, 2
  HAVING COUNT(DISTINCT o.order_id) >= 5 AND DATE_DIFF(MAX(o.order_date), MIN(o.order_date), DAY) <= 45
),
code_days AS (
  SELECT DISTINCT client_id, d AS date FROM code_windows, UNNEST(GENERATE_DATE_ARRAY(s, e)) AS d
),
spend AS (
  SELECT m.client_id, m.date_start AS date,
         SUM(m.spend * IF(c.meta_currency = c.currency, NUMERIC '1', fx.rate)) AS meta_spend
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` m
  JOIN clients c ON c.client_id = m.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
    ON  fx.month_start   = DATE_TRUNC(m.date_start, MONTH)
    AND fx.from_currency = c.meta_currency
    AND fx.to_currency   = c.currency
  GROUP BY 1, 2
),
-- 279f/g: CM3, new customer revenue and paid spend taken from mart.mart_daily_kpis as is,
-- so plan CM3 and aMER equal the Snapshot, P&L and Reports numbers (METRICS.md: CM3 =
-- revenue - cogs - fulfillment_cost - paid_spend; aMER = new_customer_revenue / paid_spend).
-- Note: mart revenue includes shipping ex VAT; the plan revenue metric does not (279b).
kpi AS (
  SELECT k.client_id, k.date,
         CAST(k.revenue AS FLOAT64)              AS kpi_revenue,
         CAST(k.new_customer_revenue AS FLOAT64) AS new_customer_revenue,
         k.new_customer_orders,
         CAST(k.paid_spend AS FLOAT64)           AS paid_spend,
         CAST(k.cm3 AS FLOAT64)                  AS cm3,
         k.cogs IS NOT NULL                      AS has_cogs
  FROM `oneeighty-warehouse.mart.mart_daily_kpis` k   -- read once (a view, ~450 MB)
  JOIN clients c ON c.client_id = k.client_id
)
SELECT
  b.client_id,
  c.shop_platform                                AS platform,
  c.currency,
  d                                              AS date,
  IFNULL(x.orders, 0)                            AS orders,
  CAST(IFNULL(x.revenue, 0) AS FLOAT64)          AS revenue,
  IFNULL(x.new_customers, 0)                     AS new_customers,
  CAST(IFNULL(x.units, 0) AS FLOAT64)            AS units,
  CAST(IFNULL(s.meta_spend, 0) AS FLOAT64)       AS meta_spend,
  cd.date IS NOT NULL                            AS is_code_window,
  b.as_of,
  -- 279g (appended). A day without a mart row had no orders and no ad spend.
  IFNULL(k.kpi_revenue, 0)                       AS kpi_revenue,
  IFNULL(k.new_customer_revenue, 0)              AS new_customer_revenue,
  IFNULL(k.new_customer_orders, 0)               AS new_customer_orders,
  IF(k.client_id IS NULL, 0, k.paid_spend)       AS paid_spend,      -- NULL = spend missing (mart rule 235)
  -- client with cost data = any costed day (same rule as migration 234); NULL = no cost data
  IF(k.client_id IS NULL,
     IF(IFNULL(LOGICAL_OR(k.has_cogs) OVER (PARTITION BY b.client_id), FALSE), 0, NULL), k.cm3) AS cm3,
  IF(k.client_id IS NULL,
     IFNULL(LOGICAL_OR(k.has_cogs) OVER (PARTITION BY b.client_id), FALSE), k.cm3 IS NOT NULL) AS is_cm3_measured,
  k.client_id IS NOT NULL AND k.paid_spend IS NULL AS is_spend_missing
FROM bounds b
JOIN clients c ON c.client_id = b.client_id,
UNNEST(GENERATE_DATE_ARRAY(b.first_date, b.as_of)) AS d
LEFT JOIN day_orders x ON x.client_id = b.client_id AND x.date = d
LEFT JOIN spend s      ON s.client_id = b.client_id AND s.date = d
LEFT JOIN code_days cd ON cd.client_id = b.client_id AND cd.date = d
LEFT JOIN kpi k        ON k.client_id = b.client_id AND k.date = d;

-- Rebuild the actuals tables so the views below can reference the new columns.
CALL `oneeighty-warehouse.mart.sp_refresh_plan_actuals`();

-- =============================================================================
-- 2. mart.plan_actuals_monthly_v (279b + CM3, aMER)
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_actuals_monthly_v` AS
SELECT
  client_id, ANY_VALUE(platform) AS platform, ANY_VALUE(currency) AS currency,
  month_start,
  LAST_DAY(month_start)                           AS month_end,
  COUNT(*)                                        AS days_with_data,
  SUM(orders)                                     AS orders,
  SUM(revenue)                                    AS revenue,
  SUM(new_customers)                              AS new_customers,
  SUM(units)                                      AS units,
  SUM(meta_spend)                                 AS meta_spend,
  SAFE_DIVIDE(SUM(revenue), SUM(orders))          AS aov,
  ROUND(100 * SAFE_DIVIDE(SUM(meta_spend), SUM(revenue)), 2) AS mer_pct,
  COUNTIF(is_code_window)                         AS code_window_days,
  ANY_VALUE(as_of) >= LAST_DAY(month_start)       AS is_closed,
  ANY_VALUE(as_of)                                AS as_of,
  -- 279g (appended): mart definitions; n/a (NULL) when a day lacks cost data or spend
  IF(LOGICAL_AND(is_cm3_measured), SUM(cm3), NULL) AS cm3,
  SUM(new_customer_revenue)                       AS new_customer_revenue,
  IF(LOGICAL_OR(is_spend_missing), NULL, SUM(paid_spend)) AS paid_spend,
  IF(LOGICAL_OR(is_spend_missing), NULL,
     SAFE_DIVIDE(SUM(new_customer_revenue), NULLIF(SUM(paid_spend), 0))) AS amer
FROM (
  SELECT *, DATE_TRUNC(date, MONTH) AS month_start
  FROM `oneeighty-warehouse.mart.plan_actuals_daily`
  WHERE date >= DATE_SUB(DATE_TRUNC(as_of, MONTH), INTERVAL 36 MONTH))
GROUP BY client_id, month_start;

-- =============================================================================
-- 3. mart.plan_targets (279c + cm3, amer)
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
               target_new_customers, orig_target_new_customers, ad_budget, orig_ad_budget,
               target_cm3, orig_target_cm3, target_amer, orig_target_amer
        FROM mon
        UNION ALL
        SELECT client_id, task_id, level, CAST(NULL AS DATE), name, version, version_original, mer_cap_pct,
               target_revenue, orig_target_revenue, target_orders, orig_target_orders,
               target_new_customers, orig_target_new_customers, ad_budget, orig_ad_budget,
               target_cm3, orig_target_cm3, target_amer, orig_target_amer
        FROM qtr) t,
  UNNEST([
    STRUCT('revenue' AS metric, CAST(t.target_revenue AS FLOAT64) AS v, CAST(t.orig_target_revenue AS FLOAT64) AS v0),
    STRUCT('orders', CAST(t.target_orders AS FLOAT64), CAST(t.orig_target_orders AS FLOAT64)),
    STRUCT('new_customers', CAST(t.target_new_customers AS FLOAT64), CAST(t.orig_target_new_customers AS FLOAT64)),
    STRUCT('ad_spend', CAST(t.ad_budget AS FLOAT64), CAST(t.orig_ad_budget AS FLOAT64)),
    -- 279g: CM3 (money, additive) and aMER (a ratio: never summed or split, see q_remainder)
    STRUCT('cm3', CAST(t.target_cm3 AS FLOAT64), CAST(t.orig_target_cm3 AS FLOAT64)),
    STRUCT('amer', t.target_amer, t.orig_target_amer)
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
         -- 279g: aMER is a ratio, a month without a Month task inherits the quarter's ratio;
         -- CM3 may be negative, so its remainder is not floored at 0
         CASE q.metric WHEN 'amer' THEN q.v
                       WHEN 'cm3'  THEN q.v - IFNULL(e.v, 0)
                       ELSE GREATEST(q.v  - IFNULL(e.v, 0), 0) END  AS rem,
         CASE q.metric WHEN 'amer' THEN q.v0
                       WHEN 'cm3'  THEN q.v0 - IFNULL(e.v0, 0)
                       ELSE GREATEST(q.v0 - IFNULL(e.v0, 0), 0) END AS rem0
  FROM metric_rows q
  LEFT JOIN explicit_q e
    ON e.client_id = q.client_id AND e.quarter_task_id = q.task_id AND e.metric = q.metric
  WHERE q.level = 'Quarter'
),
split AS (
  SELECT s.client_id, s.month_start, r.metric,
         r.rem  * CASE r.metric WHEN 'amer' THEN 1.0 WHEN 'ad_spend' THEN s.share_days ELSE s.share_season END AS v,
         r.rem0 * CASE r.metric WHEN 'amer' THEN 1.0 WHEN 'ad_spend' THEN s.share_days ELSE s.share_season END AS v0,
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

-- =============================================================================
-- 4. mart.plan_targets_daily_v (279c + CM3 and aMER curves)
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
   AND t.metric NOT IN ('cm3', 'amer')
),
td AS (
  SELECT wm.*,
         weight / SUM(weight) OVER mo                AS share_of_month,
         target_month * weight / SUM(weight) OVER mo AS target_daily,
         -- curve without the promo multiplier, same normaliser (baseline for lift)
         target_month * weight / IFNULL(promo_mult, 1.0) / SUM(weight) OVER mo AS baseline_daily
  FROM wm
  WINDOW mo AS (PARTITION BY client_id, metric, month_start)
),
-- 279g: CM3 and aMER curves.
--   CM3 = gross margin (revenue - cogs - fulfilment) minus paid spend. Gross margin follows
--   the revenue curve, spend follows the ad spend curve (flat in the month), so
--     cm3_d = (T_cm3 + T_spend) x revenue_share_d - spend_d,  sum over the month = T_cm3.
--   Without an Ad budget the month's CM3 simply follows the revenue curve.
--   Backtest (raw/12 section 3): with the payday curve this equals "CM3 follows revenue" on
--   history (Ethia 7.6 % vs 7.6 %, Manami 5.9 % vs 5.9 % mean abs cumulative error of
--   monthly CM3); with the real daily spend the component form errs 0.7 %, so the shape of
--   CM3 is gross margin on the revenue curve minus spend, and it reacts to the budget plan.
--   aMER is a ratio, target_daily carries its NUMERATOR (planned new customer revenue =
--   aMER x planned spend of the day) and ratio_den_daily the DENOMINATOR (planned spend; 1 a
--   day without an Ad budget), so any period's target ratio = SUM(num) / SUM(den).
spend_m AS (
  SELECT client_id, month_start, target_value AS t_spend_month
  FROM `oneeighty-warehouse.mart.plan_targets` WHERE metric = 'ad_spend'
),
wx AS (
  SELECT w.*, t.metric, t.target_value AS tv, t.task_id AS month_task_id,
         t.period_label AS month_label, t.mer_cap_pct AS month_mer_cap_pct,
         t.source AS month_source, t.quarter_task_id,
         sm.t_spend_month,
         DATE_DIFF(LAST_DAY(w.month_start), w.month_start, DAY) + 1 AS days_m,
         w.w_orders / SUM(w.w_orders) OVER (PARTITION BY w.client_id, w.month_start, t.metric) AS share_rev
  FROM w
  JOIN `oneeighty-warehouse.mart.plan_targets` t
    ON t.client_id = w.client_id AND t.month_start = w.month_start AND t.metric IN ('cm3', 'amer')
  LEFT JOIN spend_m sm ON sm.client_id = w.client_id AND sm.month_start = w.month_start
),
wx2 AS (
  SELECT wx.*,
         IFNULL(t_spend_month, 0) / days_m                                   AS spend_d,
         IF(IFNULL(t_spend_month, 0) > 0, t_spend_month / days_m, 1.0)       AS den_d
  FROM wx
),
td_x AS (
  SELECT
    client_id, month_start, date, is_payday, payday_factor_month, fit_from, fit_to, f_pay_day,
    promo_mult, promo_task_id, overlapping_promo_task_ids, f_cal, w_orders,
    metric,
    IF(metric = 'cm3', tv, tv * SUM(den_d) OVER mo)                        AS target_month,
    month_task_id, month_label, month_mer_cap_pct, month_source, quarter_task_id,
    IF(metric = 'cm3', w_orders, den_d)                                     AS weight,
    IF(metric = 'cm3', share_rev, den_d / SUM(den_d) OVER mo)               AS share_of_month,
    IF(metric = 'cm3', (tv + IFNULL(t_spend_month, 0)) * share_rev - spend_d,
                       tv * den_d)                                          AS target_daily,
    IF(metric = 'cm3', (tv + IFNULL(t_spend_month, 0)) * share_rev / IFNULL(promo_mult, 1.0) - spend_d,
                       NULL)                                                AS baseline_daily,
    IF(metric = 'amer', den_d, NULL)                                        AS ratio_den_daily,
    IF(metric = 'amer', tv, NULL)                                           AS target_ratio
  FROM wx2
  WINDOW mo AS (PARTITION BY client_id, metric, month_start)
),
td_all AS (
  SELECT client_id, month_start, date, is_payday, payday_factor_month, fit_from, fit_to, f_pay_day,
         promo_mult, promo_task_id, overlapping_promo_task_ids, f_cal, w_orders, metric, target_month,
         month_task_id, month_label, month_mer_cap_pct, month_source, quarter_task_id, weight,
         share_of_month, target_daily, baseline_daily,
         CAST(NULL AS FLOAT64) AS ratio_den_daily, CAST(NULL AS FLOAT64) AS target_ratio
  FROM td
  UNION ALL
  SELECT client_id, month_start, date, is_payday, payday_factor_month, fit_from, fit_to, f_pay_day,
         promo_mult, promo_task_id, overlapping_promo_task_ids, f_cal, w_orders, metric, target_month,
         month_task_id, month_label, month_mer_cap_pct, month_source, quarter_task_id, weight,
         share_of_month, target_daily, baseline_daily, ratio_den_daily, target_ratio
  FROM td_x
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
  IF(metric = 'ad_spend', target_daily, baseline_daily)           AS baseline_daily,  -- cm3: own baseline, amer: NULL
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
  quarter_task_id,
  ratio_den_daily,        -- 279g: aMER denominator (planned spend, or 1 a day without Ad budget)
  target_ratio            -- 279g: aMER target of the month
FROM td_all;

CALL `oneeighty-warehouse.mart.sp_refresh_plan_targets_daily`();

-- =============================================================================
-- 5. mart.plan_pacing_v (279d + cm3, amer)
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
-- one row per client x day with targets, wide
tr7 AS (                     -- 279g: aMER over the 7 days ending as_of (scale rule reading)
  SELECT a.client_id,
         IF(COUNTIF(a.is_spend_missing) > 0, NULL,
            SAFE_DIVIDE(SUM(a.ncr), NULLIF(SUM(a.paid), 0))) AS amer_7d
  FROM act a JOIN as_of x USING (client_id)
  WHERE a.d BETWEEN DATE_SUB(x.as_of, INTERVAL 6 DAY) AND x.as_of
  GROUP BY 1
),
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
         CAST(NULL AS FLOAT64) AS thr_cm3, CAST(NULL AS FLOAT64) AS thr_amer
  FROM base
  UNION ALL
  SELECT DISTINCT client_id, 'week', FORMAT_DATE('%G-W%V', date), FORMAT_DATE('Week %V %G', date),
         DATE_TRUNC(date, ISOWEEK), DATE_ADD(DATE_TRUNC(date, ISOWEEK), INTERVAL 6 DAY),
         CAST(NULL AS STRING), CAST(NULL AS STRING), CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64)
  FROM base
  UNION ALL
  SELECT client_id, 'month', FORMAT_DATE('%Y-%m', month_start), ANY_VALUE(month_label),
         month_start, LAST_DAY(month_start), ANY_VALUE(month_task_id), 'approved', ANY_VALUE(month_mer_cap_pct),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64)
  FROM td
  GROUP BY client_id, month_start
  UNION ALL
  SELECT client_id, 'quarter', FORMAT_DATE('%Y-Q%Q', start_date), name, start_date, end_date,
         task_id, status, mer_cap_pct, CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64)
  FROM plan WHERE level = 'Quarter' AND is_valid
  UNION ALL
  SELECT client_id, 'promo', task_id, name, start_date, end_date, task_id, status, mer_cap_pct,
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64),
         CAST(target_orders AS FLOAT64), CAST(target_new_customers AS FLOAT64), CAST(target_revenue AS FLOAT64),
         CAST(NULL AS FLOAT64),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64)
  FROM plan WHERE level = 'Promo' AND (is_valid OR status = 'planning') AND end_date IS NOT NULL
  UNION ALL
  SELECT client_id, 'gate', task_id, name,
         COALESCE(start_date, DATE_TRUNC(end_date, QUARTER)),
         end_date,
         task_id, status, mer_cap_pct,
         CAST(target_orders AS FLOAT64), CAST(target_revenue AS FLOAT64), CAST(target_new_customers AS FLOAT64),
         CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64),
         IF(skus IS NOT NULL, CAST(target_units AS FLOAT64), NULL),
         -- 279g: CM3 and aMER floors, both over the task's own Start..Due
         CAST(target_cm3 AS FLOAT64), target_amer
  FROM plan WHERE level = 'Checkpoint' AND is_valid AND end_date IS NOT NULL
),
agg AS (
  SELECT p.client_id, p.period_type, p.period_id, p.period_label, p.p_start, p.p_end, p.task_id,
         p.plan_status, p.mer_cap_pct, p.thr_orders, p.thr_revenue, p.thr_new,
         p.attr_orders_target, p.attr_new_target, p.attr_revenue_target, p.thr_units,
         p.thr_cm3, p.thr_amer,
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
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
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
         -- 279g. Qualifying spend of an aMER floor, DERIVED from the Ad budget the plan put
         -- in the window (plan_targets_daily ad_spend over Start..Due, so a window that
         -- crosses months pro rates itself). AMER_MIN_SPEND_SHARE of it: a floor judged on a
         -- fraction of the planned spend is noise, not a verdict. NULL when the covering
         -- month has no Ad budget, and then the floor is judged on the ratio alone.
         IF(a.period_type = 'gate' AND a.thr_amer IS NOT NULL AND a.t_spend > 0,
            0.5 * a.t_spend, NULL)                                              AS min_spend,
         t7.amer_7d,
         x.aov_new_hist, x.gm_rate_hist
  FROM agg2b a
  LEFT JOIN gate_units gu ON a.period_type = 'gate' AND gu.client_id = a.client_id AND gu.task_id = a.task_id
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
    -- 279g: aMER, a ratio. t / ct / c are ratios; agg c_ncr / c_paid carry the parts.
    STRUCT('amer', IF(a.period_type = 'gate', a.thr_amer IS NOT NULL, a.has_amer),
           IF(a.period_type = 'gate', a.thr_amer, SAFE_DIVIDE(a.t_anum, a.t_aden)),
           IF(a.period_type = 'gate', a.thr_amer, SAFE_DIVIDE(a.ct_anum, a.ct_aden)),
           IF(a.n_spend_missing > 0, NULL, SAFE_DIVIDE(a.c_ncr, NULLIF(a.c_paid, 0))),
           SAFE_DIVIDE(a.t_anum, a.t_aden), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64))
  ]) AS m
  WHERE (a.period_type != 'gate' AND m.metric != 'units')
     OR (a.period_type = 'gate' AND m.has_target
         AND (m.t IS NOT NULL
              OR (m.metric = 'orders' AND a.thr_orders IS NULL AND a.thr_revenue IS NULL AND a.thr_new IS NULL
                  AND a.thr_units IS NULL AND a.thr_cm3 IS NULL AND a.thr_amer IS NULL)))
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
           -- 279g: CM3 noise = gross margin noise of the expected orders to date
           WHEN 'cm3'  THEN SQRT(l.phi * l.ct_orders_eff * (1 + l.cv * l.cv)) * l.aov_plan * l.gm_rate_hist
           -- 279g: aMER noise on the numerator: new customer revenue expected on the actual spend
           WHEN 'amer' THEN SQRT(l.phi * GREATEST(SAFE_DIVIDE(l.ct * l.c_paid, l.aov_new_hist), 0)
                                 * (1 + l.cv * l.cv)) * l.aov_new_hist
           ELSE SQRT(l.phi * l.ct)
         END AS sd
  FROM lng l
),
calc2 AS (
  SELECT c.*,
         IF(c.metric = 'cm3' AND NOT c.ct > 0, NULL, SAFE_DIVIDE(c.c, c.ct)) AS pace,
         IF(c.metric = 'amer', SAFE_DIVIDE(c.c_ncr - c.ct * c.c_paid, c.sd),
            SAFE_DIVIDE(c.c - c.ct, c.sd)) AS z,
         CASE
           WHEN c.t IS NULL THEN NULL
           WHEN c.is_closed THEN c.c
           WHEN c.not_started THEN IF(c.metric = 'amer', c.t_curve, c.t)
           -- 279g CM3: gross margin to come at the shrunk revenue pace, minus the planned
           -- spend to come: C + (GM_T - GM_CT) x pf - (S_T - S_CT), GM = CM3 + spend
           WHEN c.metric = 'cm3' THEN
             c.c + ((c.t + c.t_spend) - (c.ct + c.ct_spend))
                   * SAFE_DIVIDE(c.c + c.c_spend + c.k * c.aov_plan * c.gm_rate_hist,
                                 c.ct + c.ct_spend + c.k * c.aov_plan * c.gm_rate_hist)
                 - (c.t_spend - c.ct_spend)
           -- 279g aMER: (num to date + plan ratio of the rest x shrunk pace x spend to come)
           --            / (spend to date + spend to come); spend to come = plan, else run-rate
           WHEN c.metric = 'amer' THEN
             SAFE_DIVIDE(
               c.c_ncr + IFNULL(SAFE_DIVIDE(c.t_anum - c.ct_anum, NULLIF(c.t_aden - c.ct_aden, 0)), c.t_curve)
                         * SAFE_DIVIDE(c.c_ncr + c.k * c.aov_new_hist, c.ct * c.c_paid + c.k * c.aov_new_hist)
                         * IF(c.t_spend > 0, c.t_spend - c.ct_spend,
                              SAFE_DIVIDE(c.c_paid, c.days_elapsed) * (c.days_total - c.days_elapsed)),
               c.c_paid + IF(c.t_spend > 0, c.t_spend - c.ct_spend,
                            SAFE_DIVIDE(c.c_paid, c.days_elapsed) * (c.days_total - c.days_elapsed)))
           ELSE c.c + (c.t - c.ct) * SAFE_DIVIDE(c.c + c.k_m, c.ct + c.k_m)
         END AS proj,
         -- 279g: spend still to come in the period (plan, else run-rate)
         IF(c.metric = 'amer' AND NOT c.is_closed,
            IF(c.t_spend > 0, c.t_spend - c.ct_spend,
               SAFE_DIVIDE(c.c_paid, c.days_elapsed) * (c.days_total - c.days_elapsed)), NULL) AS spend_rest,
         -- remaining orders expected (for the cone)
         IF(c.is_closed OR c.t IS NULL, 0,
            CASE c.metric
              WHEN 'orders'        THEN (c.t - c.ct) * SAFE_DIVIDE(c.c + c.k_m, c.ct + c.k_m)
              WHEN 'new_customers' THEN (c.t - c.ct) * SAFE_DIVIDE(c.c + c.k_m, c.ct + c.k_m)
              WHEN 'revenue'       THEN (c.t_orders_eff - c.ct_orders_eff) * c.pf_orders
            END) AS rem_units,
         CASE
           WHEN c.period_type IN ('month', 'quarter') THEN c.days_elapsed < 5
           -- 279g: an aMER or CM3 window is too early below 30 % of its planned spend / curve
           WHEN c.metric = 'amer' AND c.period_type IN ('promo', 'gate') THEN
             c.c_paid < 0.3 * COALESCE(NULLIF(c.t_spend, 0), c.c_paid + 1)
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
    -- off track; a window that will not reach its derived qualifying spend is behind
    WHEN metric = 'amer' AND period_type = 'gate' AND t IS NOT NULL THEN
      CASE
        WHEN is_too_early OR c IS NULL THEN 'on_track'
        WHEN min_spend IS NOT NULL AND c_paid + IFNULL(spend_rest, 0) < min_spend THEN 'behind'
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
                                   OR (thr_amer IS NOT NULL AND n_spend_missing > 0)) THEN NULL
    WHEN period_type = 'gate' THEN
      IF(c_orders >= IFNULL(thr_orders, 0) AND c_revenue >= IFNULL(thr_revenue, 0)
         AND c_new >= IFNULL(thr_new, 0)
         AND c_units >= IFNULL(thr_units, 0)
         AND (mer_cap_pct IS NULL OR 100 * SAFE_DIVIDE(c_spend, c_revenue) <= mer_cap_pct)
         -- 279g
         AND (thr_cm3 IS NULL OR c_cm3_eff >= thr_cm3)
         AND (thr_amer IS NULL OR (IFNULL(SAFE_DIVIDE(c_ncr, NULLIF(c_paid, 0)), 0) >= thr_amer
                                   AND c_paid >= IFNULL(min_spend, 0))), 'met', 'missed')
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
  IF(period_type = 'promo', bt, NULL)                        AS baseline_total,
  IF(period_type = 'promo' AND NOT not_started, bct, NULL)   AS baseline_to_date,
  IF(period_type = 'promo' AND NOT not_started,
     ROUND(100 * (SAFE_DIVIDE(c, bct) - 1), 2), NULL)        AS lift_vs_baseline_pct,
  -- 279g (appended; NULL on the rows of the other metrics)
  IF(metric = 'amer' AND NOT not_started, c_ncr, NULL)       AS ratio_num_actual,
  -- the paid spend the ratio is computed on: always shown next to an aMER figure
  IF(metric = 'amer' AND NOT not_started, c_paid, NULL)      AS ratio_den_actual,
  IF(metric = 'amer', ct_anum, NULL)                         AS ratio_num_target_to_date,
  IF(metric = 'amer', ct_aden, NULL)                         AS ratio_den_target_to_date,
  IF(metric = 'amer', t_anum, NULL)                          AS ratio_num_target,
  IF(metric = 'amer', t_aden, NULL)                          AS ratio_den_target,
  IF(metric = 'amer' AND period_type != 'day' AND NOT not_started AND NOT is_closed,
     amer_7d, NULL)                                          AS trailing_7d_ratio,
  IF(metric = 'amer' AND t IS NOT NULL AND NOT is_closed AND NOT not_started AND spend_rest > 0,
     SAFE_DIVIDE(t * (c_paid + spend_rest) - c_ncr, spend_rest), NULL) AS required_ratio,
  IF(metric = 'amer', min_spend, NULL)                       AS min_spend,
  IF(period_type = 'gate' AND t IS NOT NULL AND NOT not_started AND c IS NOT NULL,
     c >= t AND (metric != 'amer' OR min_spend IS NULL OR c_paid >= min_spend), NULL) AS condition_met,
  CASE metric
    WHEN 'cm3'  THEN n_cm3_unmeasured = 0
    WHEN 'amer' THEN n_spend_missing = 0
    ELSE TRUE
  END                                                        AS is_measured
FROM final;

-- =============================================================================
-- 6. mart.plan_checks (279c + CM3 and aMER checks)
-- =============================================================================
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
                                   WHEN 'ad_spend' THEN CAST(qq.ad_budget AS FLOAT64)
                                   WHEN 'cm3' THEN CAST(qq.target_cm3 AS FLOAT64) END) AS qv
    FROM `oneeighty-warehouse.mart.plan_targets` t
    JOIN v qq ON qq.task_id = t.quarter_task_id AND qq.client_id = t.client_id
    GROUP BY 1, 2, 3) m
    ON m.quarter_task_id = q.task_id AND m.client_id = q.client_id
  -- 279g: CM3 targets are typed rounded to thousands, tolerance 0.5 % of the quarter
  WHERE m.qv IS NOT NULL AND ABS(m.qv - m.mv) > IF(m.metric = 'cm3', GREATEST(0.01, 0.005 * ABS(m.qv)), 0.01)
),
amer_q_vs_m AS (             -- 279g: quarter aMER vs the spend-weighted aMER of its months
  SELECT q.client_id, 'warning', 'quarter_month_mismatch', q.task_id,
         FORMAT('%s amer: quarter %.2f vs months %.2f (weighted by Ad budget)', q.name, q.target_amer, m.w_amer)
  FROM v q
  JOIN (
    SELECT a.quarter_task_id, a.client_id,
           SAFE_DIVIDE(SUM(a.target_value * s.target_value), SUM(s.target_value)) AS w_amer
    FROM `oneeighty-warehouse.mart.plan_targets` a
    JOIN `oneeighty-warehouse.mart.plan_targets` s
      ON s.client_id = a.client_id AND s.month_start = a.month_start AND s.metric = 'ad_spend'
    WHERE a.metric = 'amer' AND a.source = 'month_task'
    GROUP BY 1, 2) m
    ON m.quarter_task_id = q.task_id AND m.client_id = q.client_id
  WHERE q.level = 'Quarter' AND q.target_amer IS NOT NULL AND ABS(q.target_amer - m.w_amer) > 0.05
),
amer_without_budget AS (     -- 279g: an aMER floor the plan cannot qualify on spend
  SELECT p.client_id, 'info', 'amer_no_budget', p.task_id,
         FORMAT('%s: aMER floor without an Ad budget in the window, judged on the ratio alone', p.name)
  FROM p
  WHERE p.level = 'Checkpoint' AND p.target_amer IS NOT NULL
    AND p.status NOT IN ('rejected', 'on hold')
    AND NOT EXISTS (SELECT 1 FROM `oneeighty-warehouse.mart.plan_targets_daily` t
                    WHERE t.client_id = p.client_id AND t.metric = 'ad_spend'
                      AND t.date BETWEEN p.start_date AND p.end_date AND t.target_daily > 0)
),
cm3_without_cost_data AS (   -- 279g: a CM3 target the data cannot measure (shows n/a)
  SELECT p.client_id, 'warning', 'not_measured', p.task_id,
         FORMAT('%s: Target CM3 set, but the shop has no cost data (CM3 shows n/a)', p.name)
  FROM p
  JOIN (SELECT client_id, LOGICAL_OR(is_cm3_measured) AS any_cost
        FROM `oneeighty-warehouse.mart.plan_actuals_daily` GROUP BY 1) a
    ON a.client_id = p.client_id
  WHERE p.target_cm3 IS NOT NULL AND NOT a.any_cost AND p.status NOT IN ('rejected', 'on hold')
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
                       AND target_units IS NULL AND target_cm3 IS NULL AND target_amer IS NULL THEN 'no numeric threshold'
                  WHEN level = 'Checkpoint' AND target_units IS NOT NULL AND skus IS NULL
                       THEN 'Target units without SKUs (not measurable)'
                  WHEN level = 'Month' AND (target_revenue IS NULL OR target_orders IS NULL) THEN 'no revenue or orders target'
                END)
  FROM p
  WHERE status NOT IN ('rejected', 'on hold')
    AND ((start_date IS NULL AND level != 'Checkpoint') OR end_date IS NULL
      OR (level = 'Promo' AND mechanic IS NULL)
      OR (level = 'Checkpoint' AND target_orders IS NULL AND target_revenue IS NULL
          AND target_new_customers IS NULL AND mer_cap_pct IS NULL AND target_units IS NULL
          AND target_cm3 IS NULL AND target_amer IS NULL)
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
UNION ALL SELECT * FROM gate_above_curve
UNION ALL SELECT * FROM amer_q_vs_m
UNION ALL SELECT * FROM amer_without_budget
UNION ALL SELECT * FROM cm3_without_cost_data;

CALL `oneeighty-warehouse.mart.sp_refresh_plan_pacing`();
