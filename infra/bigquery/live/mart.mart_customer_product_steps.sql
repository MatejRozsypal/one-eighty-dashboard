CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_product_steps` AS
WITH shopify_orders AS (
  SELECT client_id, order_id AS order_key, order_date,
         COALESCE(customer_id, LOWER(customer_email)) AS customer_key
  FROM `oneeighty-warehouse.stg.stg_shopify_orders`
  WHERE COALESCE(customer_id, customer_email) IS NOT NULL
),
shopify_anchor AS (
  SELECT o.client_id, o.customer_key, o.order_key, o.order_date,
         ARRAY_AGG(i.item_name ORDER BY i.revenue DESC, i.item_name LIMIT 1)[OFFSET(0)] AS product
  FROM shopify_orders o
  JOIN `oneeighty-warehouse.stg.stg_shopify_order_items` i
    ON i.order_id = o.order_key AND i.client_id = o.client_id
  WHERE i.item_name IS NOT NULL
  GROUP BY 1,2,3,4
),
shoptet_orders AS (
  SELECT client_id, order_code AS order_key, order_date, LOWER(email) AS customer_key
  FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
  WHERE email IS NOT NULL AND email != ''
),
shoptet_anchor AS (
  SELECT o.client_id, o.customer_key, o.order_key, o.order_date,
         ARRAY_AGG(i.item_name ORDER BY i.revenue_czk DESC, i.item_name LIMIT 1)[OFFSET(0)] AS product
  FROM shoptet_orders o
  JOIN `oneeighty-warehouse.stg.stg_shoptet_order_items` i
    ON i.order_code = o.order_key AND i.client_id = o.client_id
  WHERE i.item_name IS NOT NULL
  GROUP BY 1,2,3,4
),
combined AS (
  SELECT * FROM shopify_anchor
  UNION ALL
  SELECT * FROM shoptet_anchor
)
SELECT client_id, customer_key, order_key, order_date, product,
  ROW_NUMBER() OVER (PARTITION BY client_id, customer_key ORDER BY order_date, order_key) AS step,
  COUNT(*) OVER (PARTITION BY client_id, customer_key) AS lifetime_orders,
  MIN(order_date) OVER (PARTITION BY client_id, customer_key) AS first_order_date
FROM combined;
