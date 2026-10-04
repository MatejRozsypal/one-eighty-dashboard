CREATE TABLE `oneeighty-warehouse.ref.product_costs`
(
  client_id STRING NOT NULL,
  sku STRING NOT NULL,
  cost NUMERIC NOT NULL,
  currency STRING NOT NULL,
  effective_from DATE NOT NULL,
  note STRING,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  product_id STRING,
  variation_id STRING
)
OPTIONS(
  description="RECORD ONLY -- not read by any view. Shopify's InventoryItem.cost is authoritative for Venev as of 2026-08-03, when these costs were written into the store. This table keeps what Shopify cannot: the original CZK figures from the client's price list, the EUR conversion rate they were frozen at (24.205, CNB August 2026), and the note that SKU 110A's mapping to 'VENEV Magnetic head covers' is an unconfirmed assumption. Consult it when the koruna moves and the EUR costs in Shopify need restating."
);
