CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_lifetime` AS
WITH shopify_order_costs AS (
  SELECT client_id, order_id, SUM(line_cost) AS order_cogs
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_id
),
all_orders AS (
  -- Manami via Shoptet (CZK)
  SELECT
    client_id,
    LOWER(email) AS customer_key,
    order_date,
    total_with_vat_czk AS order_revenue,
    margin_czk         AS order_margin,
    'CZK'              AS currency
  FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
    AND email IS NOT NULL AND email != ''

  UNION ALL

  -- Dobias via Shopify
  SELECT
    o.client_id,
    LOWER(o.customer_email) AS customer_key,
    o.order_date,
    o.subtotal_price + COALESCE(o.total_shipping, 0) AS order_revenue,
    CASE WHEN c.order_cogs IS NULL THEN NULL
         ELSE o.subtotal_price - c.order_cogs END AS order_margin,
    o.currency
  FROM `oneeighty-warehouse.stg.stg_shopify_orders` o
  LEFT JOIN shopify_order_costs c USING (client_id, order_id)
  WHERE o.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
    AND o.customer_email IS NOT NULL AND o.customer_email != ''
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
  -- Lifetime metrics (all orders within our 36-month data window)
  COUNT(*)                                          AS total_orders,
  SUM(order_revenue)                                AS lifetime_revenue,
  SUM(order_margin)                                 AS lifetime_gross_profit,
  -- Y1 metrics (orders within 365 days of first order - same maturity per customer)
  COUNTIF(DATE_DIFF(order_date, customer_first_order_date, DAY) <= 365)             AS y1_orders,
  SUM(CASE WHEN DATE_DIFF(order_date, customer_first_order_date, DAY) <= 365
           THEN order_revenue END)                                                  AS y1_revenue,
  SUM(CASE WHEN DATE_DIFF(order_date, customer_first_order_date, DAY) <= 365
           THEN order_margin END)                                                   AS y1_gross_profit,
  -- Maturity flag - TRUE only when customer has had a full Y1 window
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
