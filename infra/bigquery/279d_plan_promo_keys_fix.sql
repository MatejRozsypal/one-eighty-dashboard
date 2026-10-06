-- =============================================================================
-- 279d_plan_promo_keys_fix.sql
-- Promo pacing (package pp1): fixes found live after 277 + 279a-c.
--
-- 1. Promo attribution was empty for every Manami promo. Cause: mart.plan_promo_orders_v
--    and plan_promo_perf_v took the promo list ONLY from ref.plan_promo_keys (pp2's
--    curated keys, 16 Ethia rows). SKU matching itself works: Manami line keys carry the
--    Shoptet item code exactly as entered in ClickUp ('524', '551/NEZ', '203/5 M').
--    Now keys = ref.plan_promo_keys (wins for its task_ids) UNION every other Promo task
--    of mart.plan_input: Coupon codes, SKUs, UTM campaign split on commas; a promo with
--    none of them is store-wide (window match). Gift lines (unit price < 1) still match
--    SKU keys as gift_sku. Ethia: every Ethia promo is in ref keys, so unchanged.
-- 2. mart.plan_pacing_v: every metric gets an actuals row for day, week, month, quarter and
--    promo periods even without a target (target, curve, pace, projection, status and
--    result NULL; actual_to_date filled; closed / not_started still set). Gates unchanged.
--    Ethia: all its periods have all four targets, so unchanged.
--
-- Change: CREATE OR REPLACE VIEW mart.plan_promo_orders_v, plan_promo_perf_v,
--   plan_pacing_v (live 279c definitions + the two edits), then CALL
--   mart.sp_refresh_plan_pacing() (procedure unchanged).
-- Based on: 279c as deployed 2026-10-06.
-- Affected clients: manami (new promo orders, new metric rows); ethia unchanged
--   (regression in raw/06 section 13).
-- Deploy order: after 279c. Single file.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_promo_orders_v` AS
WITH
ref_keys AS (               -- curated keys (pp2), win for their task_ids
  SELECT
    k.client_id, k.task_id, k.phase, k.mechanic, k.source, k.is_storewide,
    IFNULL(k.is_test, FALSE) AS is_test,
    k.window_start, k.window_end,
    k.coupon_codes, k.skus, k.gift_skus, k.utm_campaigns, k.clickup_status
  FROM `oneeighty-warehouse.ref.plan_promo_keys` k
),
plan_keys AS (              -- every other Promo task of mart.plan_input (all clients)
  SELECT
    p.client_id, p.task_id,
    REGEXP_EXTRACT(p.name, r'^(F[0-9]+) ') AS phase,
    p.mechanic, 'clickup' AS source,
    -- nothing to match on (no codes, SKUs, UTM): the promo is the whole store in the window
    p.coupon_codes IS NULL AND p.skus IS NULL AND p.utm_campaign IS NULL AS is_storewide,
    FALSE AS is_test,
    p.start_date AS window_start, p.end_date AS window_end,
    ARRAY(SELECT TRIM(x) FROM UNNEST(SPLIT(IFNULL(p.coupon_codes, ''), ',')) x WHERE TRIM(x) != '') AS coupon_codes,
    ARRAY(SELECT TRIM(x) FROM UNNEST(SPLIT(IFNULL(p.skus, ''), ',')) x WHERE TRIM(x) != '')         AS skus,
    ARRAY<STRING>[]                                                                                 AS gift_skus,
    ARRAY(SELECT TRIM(x) FROM UNNEST(SPLIT(IFNULL(p.utm_campaign, ''), ',')) x WHERE TRIM(x) != '') AS utm_campaigns,
    p.status AS clickup_status
  FROM `oneeighty-warehouse.mart.plan_input` p
  WHERE p.level = 'Promo'
    AND NOT EXISTS (SELECT 1 FROM ref_keys r WHERE r.client_id = p.client_id AND r.task_id = p.task_id)
),
keys AS (
  SELECT
    k.client_id, k.task_id, k.phase, k.mechanic, k.source, k.is_storewide, k.is_test,
    k.window_start, k.window_end,
    DATE_DIFF(k.window_end, k.window_start, DAY) + 1 AS window_days,
    ARRAY(SELECT UPPER(TRIM(x)) FROM UNNEST(k.coupon_codes) x WHERE TRIM(x) != '') AS coupon_keys,
    ARRAY(SELECT UPPER(TRIM(x)) FROM UNNEST(k.skus) x WHERE TRIM(x) != '') AS sku_keys,
    ARRAY(SELECT UPPER(TRIM(x)) FROM UNNEST(k.gift_skus) x WHERE TRIM(x) != '') AS gift_keys,
    ARRAY(SELECT LOWER(REPLACE(TRIM(x), '+', ' ')) FROM UNNEST(k.utm_campaigns) x WHERE TRIM(x) != '') AS utm_keys
  FROM (SELECT * FROM ref_keys UNION ALL SELECT * FROM plan_keys) k
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


CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_promo_perf_v` AS
WITH
ref_keys AS (
  SELECT k.client_id, k.task_id, k.phase, k.mechanic, k.source, k.clickup_status,
         k.window_start, k.window_end, k.mer_cap_pct
  FROM `oneeighty-warehouse.ref.plan_promo_keys` k
),
plan_keys AS (
  SELECT p.client_id, p.task_id, REGEXP_EXTRACT(p.name, r'^(F[0-9]+) ') AS phase, p.mechanic,
         'clickup' AS source, p.status AS clickup_status, p.start_date AS window_start,
         p.end_date AS window_end, p.mer_cap_pct
  FROM `oneeighty-warehouse.mart.plan_input` p
  WHERE p.level = 'Promo'
    AND NOT EXISTS (SELECT 1 FROM ref_keys r WHERE r.client_id = p.client_id AND r.task_id = p.task_id)
),
keys AS (
  SELECT
    k.client_id, k.task_id, k.phase, k.mechanic, k.source, k.clickup_status,
    k.window_start, k.window_end,
    DATE_DIFF(k.window_end, k.window_start, DAY) + 1 AS window_days,
    k.mer_cap_pct,
    CURRENT_DATE(c.timezone) AS today
  FROM (SELECT * FROM ref_keys UNION ALL SELECT * FROM plan_keys) k
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
           CAST(a.c_units AS FLOAT64), a.t_orders_eff, CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64))
  ]) AS m
  WHERE (a.period_type != 'gate' AND m.metric != 'units')
     OR (a.period_type = 'gate' AND m.has_target
         AND (m.t IS NOT NULL
              OR (m.metric = 'orders' AND a.thr_orders IS NULL AND a.thr_revenue IS NULL AND a.thr_new IS NULL
                  AND a.thr_units IS NULL)))
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

CALL `oneeighty-warehouse.mart.sp_refresh_plan_pacing`();
