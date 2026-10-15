-- =============================================================================
-- qa/290_294_regression.sql
-- Regression for the Markets marts (290 to 294) against the verified numbers
-- of docs/sessions/2026-10-15/markets/research/data-audit.md (sections 2.1 to
-- 2.5, appendix A1 to A3). Read-only. Run against mart_qa.mk_* (QA) or, after
-- deploy, replace `mart_qa.mk_market_` with `mart.market_`.
-- Expected results and the explanation of every difference:
-- docs/sessions/2026-10-15/markets/DATA-BUILD.md section 4.
-- =============================================================================

-- R1. Period economics per client x market (audit A1 + A2 + A4)
WITH p AS (
  SELECT 'L12M' AS period, DATE '2025-10-15' AS d0, DATE '2026-10-14' AS d1 UNION ALL
  SELECT 'L90', DATE '2026-07-17', DATE '2026-10-14'
)
SELECT client_id, market, period,
  SUM(orders) AS orders,
  SUM(new_customers) AS new_customers,
  ROUND(SUM(net_revenue)) AS net_revenue,
  ROUND(SUM(gross_profit)) AS gross_profit,
  ROUND(SUM(spend_base)) AS spend,
  ROUND(SAFE_DIVIDE(SUM(spend_base), SUM(new_customers)), 1) AS ncac,
  ROUND(SUM(gross_sales)) AS gross_sales,
  ROUND(SUM(discounts)) AS discounts,
  ROUND(SAFE_DIVIDE(SUM(new_customer_gross_profit), SUM(new_customer_costed_orders)), 1) AS first_order_gp,
  ROUND(SAFE_DIVIDE(SUM(new_customer_net_sales), SUM(new_customers)), 1) AS aov_new
FROM `oneeighty-warehouse.mart_qa.mk_market_daily` d
JOIN p ON d.date BETWEEN p.d0 AND p.d1
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- R2. Spend split by allocation (F3 effect)
SELECT client_id, platform, market, allocation,
  ROUND(SUM(IF(date BETWEEN '2025-10-15' AND '2026-10-14', spend_base, 0))) AS l12m,
  ROUND(SUM(IF(date BETWEEN '2026-07-17' AND '2026-10-14', spend_base, 0))) AS l90
FROM `oneeighty-warehouse.mart_qa.mk_market_spend_daily`
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3, 4;

-- R3. Cohort retention at 90 / 180 / 365 d on the audit's day windows (audit A3),
--     with cohort CAC = market spend in the window / cohort customers
WITH h AS (
  SELECT 90 AS hz, DATE '2025-07-17' AS w0, DATE '2026-07-16' AS w1 UNION ALL
  SELECT 180, DATE '2025-04-18', DATE '2026-04-17' UNION ALL
  SELECT 365, DATE '2024-10-15', DATE '2025-10-14'
),
f AS (
  SELECT client_id, customer_key, first_order_market AS m, first_order_date AS d
  FROM `oneeighty-warehouse.mart_qa.mk_market_orders` WHERE is_new_customer
),
pc AS (
  SELECT f.client_id, f.m, h.hz, f.customer_key, COUNT(*) AS n,
    SUM(o.net_revenue) AS rev, SUM(o.gross_profit) AS gp, LOGICAL_AND(o.gross_profit IS NOT NULL) AS costed
  FROM f
  JOIN h ON f.d BETWEEN h.w0 AND h.w1
  JOIN `oneeighty-warehouse.mart_qa.mk_market_orders` o
    ON o.client_id = f.client_id AND o.customer_key = f.customer_key
   AND o.order_date < DATE_ADD(f.d, INTERVAL h.hz DAY)
  GROUP BY 1, 2, 3, 4
),
sp AS (
  SELECT s.client_id, s.market, h.hz, SUM(s.spend_base) AS spend
  FROM `oneeighty-warehouse.mart_qa.mk_market_spend_daily` s
  JOIN h ON s.date BETWEEN h.w0 AND h.w1
  GROUP BY 1, 2, 3
)
SELECT pc.client_id, pc.m AS market, pc.hz,
  COUNT(*) AS cohort_customers,
  ROUND(100 * COUNTIF(n >= 2) / COUNT(*), 1) AS repeat_rate_pct,
  ROUND(AVG(rev), 1) AS rev_per_cust,
  ROUND(SAFE_DIVIDE(SUM(IF(costed, gp, NULL)), COUNTIF(costed)), 1) AS gp_per_cust,
  ROUND(ANY_VALUE(sp.spend) / COUNT(*), 1) AS cohort_cac,
  ROUND(SAFE_DIVIDE(SAFE_DIVIDE(SUM(IF(costed, gp, NULL)), COUNTIF(costed)), ANY_VALUE(sp.spend) / COUNT(*)), 2) AS ltgp_cac
FROM pc
LEFT JOIN sp ON sp.client_id = pc.client_id AND sp.market = pc.m AND sp.hz = pc.hz
WHERE pc.m != 'OTHER'
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- R4. Structural checks (all must return 0)
SELECT 'orders_dup' AS check_name,
  COUNT(*) - COUNT(DISTINCT CONCAT(client_id, '|', order_id)) AS bad
FROM `oneeighty-warehouse.mart_qa.mk_market_orders`
UNION ALL
SELECT 'daily_vs_orders',
  ABS((SELECT SUM(orders) FROM `oneeighty-warehouse.mart_qa.mk_market_daily`)
    - (SELECT COUNT(*) FROM `oneeighty-warehouse.mart_qa.mk_market_orders`))
UNION ALL
SELECT 'cohorts_vs_new',
  ABS((SELECT SUM(customers) FROM `oneeighty-warehouse.mart_qa.mk_market_cohorts`)
    - (SELECT COUNTIF(is_new_customer) FROM `oneeighty-warehouse.mart_qa.mk_market_orders`))
UNION ALL
SELECT 'forecast_outside_band', COUNTIF(method != 'none'
  AND NOT (band_low <= forecast_gp365_per_customer AND forecast_gp365_per_customer <= band_high))
FROM `oneeighty-warehouse.mart_qa.mk_market_forecast`;
