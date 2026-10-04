CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_customer_order_items` AS
WITH woo_lines AS (
  SELECT
    client_id,
    order_id,
    order_date,
    line_item_id,
    item_name,
    COALESCE(NULLIF(sku, ''), NULLIF(NULLIF(product_id, ''), '0'), item_name) AS product_key,
    revenue,
    line_cost
  FROM `oneeighty-warehouse.stg.stg_woo_order_items`
),
woo_labels AS (
  SELECT
    client_id,
    product_key,
    ARRAY_AGG(item_name ORDER BY LENGTH(item_name), item_name LIMIT 1)[OFFSET(0)] AS product_name
  FROM woo_lines
  WHERE item_name IS NOT NULL
  GROUP BY client_id, product_key
)
-- Shopify: amounts in reporting currency. Product identity is the item name,
-- which is what the journey marts have always grouped by.
SELECT
  'shopify'              AS platform,
  client_id,
  order_id,
  order_date,
  CAST(NULL AS STRING)   AS line_id,
  item_name,
  item_name              AS product_key,
  item_name              AS product_name,
  revenue,
  line_cost
FROM `oneeighty-warehouse.stg.stg_shopify_order_items`

UNION ALL

-- Shoptet: CZK columns, keyed by order_code.
SELECT
  'shoptet'              AS platform,
  client_id,
  order_code             AS order_id,
  order_date,
  item_key               AS line_id,
  item_name,
  item_name              AS product_key,
  item_name              AS product_name,
  revenue_czk            AS revenue,
  cost_czk               AS line_cost
FROM `oneeighty-warehouse.stg.stg_shoptet_order_items`

UNION ALL

-- WooCommerce: product key per the W3 spec, labelled with one stable name.
SELECT
  'woocommerce'          AS platform,
  w.client_id,
  w.order_id,
  w.order_date,
  w.line_item_id         AS line_id,
  w.item_name,
  w.product_key,
  l.product_name,
  w.revenue,
  w.line_cost
FROM woo_lines w
LEFT JOIN woo_labels l
  ON l.client_id = w.client_id AND l.product_key = w.product_key;
