CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_order_gaps` AS
WITH all_orders AS (
  SELECT client_id, LOWER(customer_email) AS customer_key, order_date, currency
  FROM `oneeighty-warehouse.stg.stg_shopify_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH)
    AND customer_email IS NOT NULL AND customer_email != ''
  UNION ALL
  SELECT client_id, LOWER(email) AS customer_key, order_date, 'CZK' AS currency
  FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH)
    AND email IS NOT NULL AND email != ''
),
sequenced AS (
  SELECT client_id, currency, customer_key, order_date,
    LAG(order_date) OVER (PARTITION BY client_id, customer_key, currency ORDER BY order_date) AS prev_order_date,
    ROW_NUMBER() OVER (PARTITION BY client_id, customer_key, currency ORDER BY order_date) AS order_seq
  FROM all_orders
)
SELECT client_id, currency,
  DATE_DIFF(order_date, prev_order_date, DAY) AS gap_days,
  order_seq, order_date AS gap_end_date
FROM sequenced
WHERE prev_order_date IS NOT NULL;
