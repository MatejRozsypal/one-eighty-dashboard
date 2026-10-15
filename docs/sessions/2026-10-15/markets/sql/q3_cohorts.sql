-- Q3: cohort retention and GP per customer at 90/180/365 days, complete cohorts only
WITH o AS (
  SELECT client_id, customer_key, order_id, order_date, revenue, gross_profit, cogs,
    CASE
      WHEN NULLIF(shipping_country, '') IS NOT NULL THEN shipping_country
      WHEN market_currency = 'CZK' THEN 'CZ'
      WHEN market_currency = 'EUR' AND client_id IN ('manami', 'rawbark') THEN 'SK'
      WHEN market_currency = 'CAD' THEN 'CA'
      WHEN market_currency = 'USD' THEN 'US'
      ELSE 'UNKNOWN' END AS market_raw
  FROM `oneeighty-warehouse.stg.stg_customer_orders`
  WHERE customer_key IS NOT NULL
),
f AS (
  SELECT client_id, customer_key,
         ARRAY_AGG(STRUCT(order_date, market_raw) ORDER BY order_date, order_id LIMIT 1)[OFFSET(0)] AS fo
  FROM o GROUP BY 1, 2
),
c AS (
  SELECT f.client_id, f.customer_key, f.fo.order_date AS first_date,
    CASE WHEN f.client_id = 'dobias' AND f.fo.market_raw NOT IN ('US','CA') THEN 'OTHER'
         WHEN f.client_id != 'dobias' AND f.fo.market_raw NOT IN ('CZ','SK') THEN 'OTHER'
         ELSE f.fo.market_raw END AS market
  FROM f
),
h AS (
  SELECT 90 AS hz, DATE '2025-07-17' AS w0, DATE '2026-07-16' AS w1 UNION ALL
  SELECT 180, DATE '2025-04-18', DATE '2026-04-17' UNION ALL
  SELECT 365, DATE '2024-10-15', DATE '2025-10-14'
),
per_cust AS (
  SELECT c.client_id, c.market, h.hz, c.customer_key,
         COUNT(o.order_id) AS n_orders, SUM(o.revenue) AS rev, SUM(o.gross_profit) AS gp,
         LOGICAL_AND(o.cogs IS NOT NULL) AS all_costed
  FROM c
  JOIN h ON c.first_date BETWEEN h.w0 AND h.w1
  JOIN o ON o.client_id = c.client_id AND o.customer_key = c.customer_key
        AND o.order_date >= c.first_date AND o.order_date < DATE_ADD(c.first_date, INTERVAL h.hz DAY)
  GROUP BY 1, 2, 3, 4
)
SELECT client_id, market, hz,
  COUNT(*) AS cohort_customers,
  ROUND(AVG(n_orders), 3) AS orders_per_cust,
  ROUND(100 * COUNTIF(n_orders >= 2) / COUNT(*), 1) AS repeat_rate_pct,
  ROUND(AVG(rev), 1) AS rev_per_cust,
  ROUND(SAFE_DIVIDE(SUM(IF(all_costed, gp, NULL)), COUNTIF(all_costed)), 1) AS gp_per_cust,
  ROUND(100 * COUNTIF(all_costed) / COUNT(*), 1) AS pct_cust_fully_costed
FROM per_cust
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3
