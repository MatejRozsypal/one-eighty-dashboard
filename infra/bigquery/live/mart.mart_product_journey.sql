CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_product_journey` AS
WITH stepped AS (
  SELECT client_id, customer_key, step, product,
         LEAD(product) OVER (PARTITION BY client_id, customer_key ORDER BY step) AS next_product
  FROM `oneeighty-warehouse.mart.mart_customer_product_steps`
)
SELECT client_id, step AS from_step, product AS from_product,
       next_product AS to_product, COUNT(*) AS customers
FROM stepped
WHERE next_product IS NOT NULL
GROUP BY 1,2,3,4;
