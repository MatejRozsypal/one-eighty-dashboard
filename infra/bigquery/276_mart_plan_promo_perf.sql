-- =============================================================================
-- 276_mart_plan_promo_perf.sql
-- Promo performance per day and per promo: attributed orders against the whole store in the
-- same window, and window store MER against the promo's MER cap. Package PP2 of
-- projects/promo-pacing (raw/03-clickup-bq-model.md sections 4.5 and 5.5).
--
-- Change (additive, nothing existing is modified)
--   NEW VIEW mart.plan_promo_perf. Two grains in one view, told apart by `grain`:
--     'day'    one row per promo and day of its window (date = the day)
--     'total'  one row per promo (date NULL), window totals plus coupon_late follow-up
--   Targets are not here: they come from mart.plan_targets (PP1) by task_id.
--
-- Columns
--   keys        client_id, task_id, phase, mechanic, source, clickup_status, grain, date,
--               day_index (1-based, NULL on total), window_start, window_end, window_days,
--               is_complete (window_end < today in the client time zone; on day rows:
--               date < today)
--   attributed  (non-exclusive, in window: every promo counts its own matches)
--               attr_orders, attr_revenue, attr_new_customers, attr_units (promo_units),
--               attr_gift_units, attr_code_orders / attr_no_code_orders (test arms),
--               attr_discounted_orders (window matches with has_mechanic)
--   primary     (exclusive portfolio view, is_primary) prim_orders, prim_revenue
--   late        (total only) late_orders, late_revenue: coupon_late matches after the window
--   store       store_orders, store_revenue, store_new_customers: all orders of the client
--               in the window, same base as the bridge (stg.stg_woo_orders, total_price > 0,
--               net revenue = subtotal - refunds, ex VAT)
--   shares      attr_share_orders, attr_share_revenue, prim_share_orders (0 to 1, NULL when
--               the store has no orders)
--   MER         meta_spend, kpi_net_sales (mart.mart_daily_kpis over the window),
--               store_mer_pct = 100 * meta_spend / kpi_net_sales, mer_cap_pct,
--               mer_over_cap (NULL without cap)
--
-- Based on the live views stg.stg_woo_orders and mart.mart_daily_kpis (2026-10-06) and on
-- mart.plan_promo_orders (275), ref.plan_promo_keys (274), ref.clients.
-- Affected clients: none (new view). Rows only for clients present in ref.plan_promo_keys.
-- Regression: new object. Backtest: qa/275_276_backtest.sql, mart_qa.pp2_plan_promo_perf.
-- Cost: about 430 MB per full read for Ethia (2026-10-06): mart.mart_daily_kpis is a view and
-- costs about 300 MB even when filtered to one client; bridge 70 MB, stg orders 2 MB. If the
-- Plan page reads this often, materialize it (hourly table) like rpt_kpis_daily (253).
--
-- Backtest result (mart_qa, 2026-10-06): exclusive view never exceeds the store (0 of 262
-- promo days), attributed <= store on every promo day, MER from mart_daily_kpis equal to
-- meta_spend / net_sales. Numbers per promo in raw/07-pp2-report.md.
--
-- Deploy order: 274, 275, 276 (this).
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_promo_perf` AS
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
store_day AS (
  SELECT o.client_id, o.order_date AS date,
    COUNT(*) AS store_orders,
    SUM(o.subtotal_price - IFNULL(o.total_refunded, 0)) AS store_revenue,
    COUNTIF(NOT o.is_returning_customer) AS store_new_customers
  FROM `oneeighty-warehouse.stg.stg_woo_orders` o
  JOIN span s ON s.client_id = o.client_id AND o.order_date BETWEEN s.d0 AND s.d1
  WHERE o.total_price > 0
  GROUP BY 1, 2
),
kpi_day AS (
  SELECT k.client_id, k.date, k.meta_spend, k.net_sales AS kpi_net_sales
  FROM `oneeighty-warehouse.mart.mart_daily_kpis` k
  JOIN span s ON s.client_id = k.client_id AND k.date BETWEEN s.d0 AND s.d1
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
