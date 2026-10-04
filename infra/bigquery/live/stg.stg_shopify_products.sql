CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shopify_products` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, product_id, variant_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_shopify_products`
  WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;
