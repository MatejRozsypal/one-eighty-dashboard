CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shopify_customers` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, customer_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_shopify_customers`
  WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;
