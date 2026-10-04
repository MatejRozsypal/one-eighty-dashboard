CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_cohort_grid` AS
WITH shopify_costs AS (
  SELECT client_id, order_id, SUM(line_cost) AS order_cogs
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_id
),
orders AS (
  SELECT
    client_id,
    LOWER(TRIM(email))                       AS customer_key,
    order_date,
    order_code                               AS order_id,
    total_with_vat_czk                       AS revenue,
    margin_czk                               AS gross_profit,
    'CZK'                                    AS currency,
    currency                                 AS market,
    'currency'                               AS market_kind
  FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
    AND email IS NOT NULL AND TRIM(email) != ''
  UNION ALL
  SELECT
    o.client_id,
    LOWER(TRIM(o.customer_email))            AS customer_key,
    o.order_date,
    o.order_id,
    o.subtotal_price + COALESCE(o.total_shipping, 0) AS revenue,
    CASE WHEN c.order_cogs IS NULL THEN NULL
         ELSE o.subtotal_price - c.order_cogs END    AS gross_profit,
    o.currency,
    COALESCE(NULLIF(o.shipping_country, ''), 'Unknown') AS market,
    'country'                                AS market_kind
  FROM `oneeighty-warehouse.stg.stg_shopify_orders` o
  LEFT JOIN shopify_costs c USING (client_id, order_id)
  WHERE o.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
    AND o.customer_email IS NOT NULL AND TRIM(o.customer_email) != ''
),
first_orders AS (
  SELECT
    client_id,
    customer_key,
    DATE_TRUNC(MIN(order_date), MONTH) AS cohort_month,
    ARRAY_AGG(market      ORDER BY order_date, order_id LIMIT 1)[OFFSET(0)] AS market,
    ARRAY_AGG(market_kind ORDER BY order_date, order_id LIMIT 1)[OFFSET(0)] AS market_kind,
    ARRAY_AGG(currency    ORDER BY order_date, order_id LIMIT 1)[OFFSET(0)] AS currency
  FROM orders
  GROUP BY client_id, customer_key
),
cohort_sizes AS (
  SELECT client_id, cohort_month, market, market_kind, currency,
         COUNT(*) AS cohort_customers
  FROM first_orders
  GROUP BY 1, 2, 3, 4, 5
),
activity AS (
  SELECT
    f.client_id,
    f.cohort_month,
    f.market,
    f.market_kind,
    f.currency,
    DATE_DIFF(DATE_TRUNC(o.order_date, MONTH), f.cohort_month, MONTH) AS month_offset,
    COUNT(DISTINCT o.customer_key) AS active_customers,
    COUNT(DISTINCT o.order_id)     AS orders,
    SUM(o.revenue)                 AS revenue,
    SUM(o.gross_profit)            AS gross_profit
  FROM orders o
  JOIN first_orders f
    ON o.client_id = f.client_id AND o.customer_key = f.customer_key
  GROUP BY 1, 2, 3, 4, 5, 6
)
SELECT
  a.client_id,
  a.cohort_month,
  a.market,
  a.market_kind,
  a.currency,
  a.month_offset,
  s.cohort_customers,
  a.active_customers,
  a.orders,
  a.revenue,
  a.gross_profit,
  DATE_ADD(a.cohort_month, INTERVAL a.month_offset MONTH)
    <= DATE_TRUNC(CURRENT_DATE(), MONTH) AS is_elapsed
FROM activity a
JOIN cohort_sizes s
  ON  a.client_id    = s.client_id
  AND a.cohort_month = s.cohort_month
  AND a.market       = s.market
WHERE a.month_offset >= 0;
