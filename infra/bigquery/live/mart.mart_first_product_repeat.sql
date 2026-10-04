CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_first_product_repeat` AS
WITH first_orders AS (
  SELECT client_id, customer_key, product AS first_product, lifetime_orders, first_order_date
  FROM `oneeighty-warehouse.mart.mart_customer_product_steps`
  WHERE step = 1
)
SELECT client_id, first_product,
       COUNT(*) AS customers,
       COUNTIF(lifetime_orders >= 2) AS repeaters,
       AVG(lifetime_orders) AS avg_lifetime_orders,
       MIN(first_order_date) AS earliest_first_order,
       MAX(first_order_date) AS latest_first_order
FROM first_orders
WHERE first_order_date < DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
GROUP BY 1,2;
