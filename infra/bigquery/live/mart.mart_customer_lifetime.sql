CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_lifetime` AS
WITH all_orders AS (
  SELECT
    client_id,
    customer_key,
    order_date,
    revenue      AS order_revenue,
    gross_profit AS order_margin,
    currency
  FROM `oneeighty-warehouse.stg.stg_customer_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
    AND customer_key IS NOT NULL
),
with_first_date AS (
  -- Tag each order with the customer's first_order_date so we can compute Y1 windows
  SELECT *,
    MIN(order_date) OVER (PARTITION BY client_id, customer_key, currency) AS customer_first_order_date
  FROM all_orders
)
SELECT
  client_id,
  customer_key AS customer_email,
  currency,
  -- Lifetime metrics (all orders within the 60-month data window)
  COUNT(*)                                          AS total_orders,
  SUM(order_revenue)                                AS lifetime_revenue,
  SUM(order_margin)                                 AS lifetime_gross_profit,
  -- Y1 metrics (orders within 365 days of first order, same maturity per customer)
  COUNTIF(DATE_DIFF(order_date, customer_first_order_date, DAY) <= 365)             AS y1_orders,
  SUM(CASE WHEN DATE_DIFF(order_date, customer_first_order_date, DAY) <= 365
           THEN order_revenue END)                                                  AS y1_revenue,
  SUM(CASE WHEN DATE_DIFF(order_date, customer_first_order_date, DAY) <= 365
           THEN order_margin END)                                                   AS y1_gross_profit,
  -- Maturity flag, TRUE only when customer has had a full Y1 window
  DATE_DIFF(CURRENT_DATE(), MIN(order_date), DAY) >= 365                            AS is_y1_complete,
  -- Identifying info
  MIN(order_date)                                                                   AS first_order_date,
  MAX(order_date)                                                                   AS last_order_date,
  DATE_DIFF(MAX(order_date), MIN(order_date), DAY)                                  AS days_active,
  COUNT(*) > 1                                                                      AS is_returning,
  -- Derived
  SAFE_DIVIDE(SUM(order_revenue), COUNT(*))                                         AS aov,
  SAFE_DIVIDE(SUM(order_margin),  COUNT(*))                                         AS avg_margin_per_order
FROM with_first_date
GROUP BY client_id, customer_key, currency;
