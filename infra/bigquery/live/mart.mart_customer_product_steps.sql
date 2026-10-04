CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_product_steps` AS
WITH orders AS (
  SELECT
    platform,
    client_id,
    order_id AS order_key,
    order_date,
    -- Shopify keeps its live identity (customer id first). Shoptet and Woo use
    -- the email key.
    CASE WHEN platform = 'shopify'
         THEN COALESCE(platform_customer_id, LOWER(customer_email))
         ELSE customer_key END AS customer_key
  FROM `oneeighty-warehouse.stg.stg_customer_orders`
),
anchor AS (
  -- The order's product is its highest-revenue line.
  SELECT o.client_id, o.customer_key, o.order_key, o.order_date,
         ARRAY_AGG(i.product_name ORDER BY i.revenue DESC, i.product_name LIMIT 1)[OFFSET(0)] AS product
  FROM orders o
  JOIN `oneeighty-warehouse.stg.stg_customer_order_items` i
    ON  i.platform  = o.platform
    AND i.client_id = o.client_id
    AND i.order_id  = o.order_key
  WHERE o.customer_key IS NOT NULL
    AND i.product_name IS NOT NULL
  GROUP BY 1, 2, 3, 4
)
SELECT client_id, customer_key, order_key, order_date, product,
  ROW_NUMBER() OVER (PARTITION BY client_id, customer_key ORDER BY order_date, order_key) AS step,
  COUNT(*) OVER (PARTITION BY client_id, customer_key) AS lifetime_orders,
  MIN(order_date) OVER (PARTITION BY client_id, customer_key) AS first_order_date
FROM anchor;
