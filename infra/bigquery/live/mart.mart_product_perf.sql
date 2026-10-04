CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_product_perf` AS
SELECT
  client_id,
  order_date AS date,
  item_name  AS product_name,
  CAST(NULL AS STRING) AS product_line,
  SUM(quantity)    AS units_sold,
  SUM(revenue_czk) AS revenue,
  SUM(margin_czk)  AS margin,
  'CZK' AS currency
FROM `oneeighty-warehouse.stg.stg_shoptet_order_items`
WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
GROUP BY client_id, order_date, item_name
UNION ALL
SELECT
  client_id,
  order_date AS date,
  item_name  AS product_name,
  product_line,
  SUM(quantity) AS units_sold,
  SUM(revenue)  AS revenue,
  SUM(margin)   AS margin,
  currency
FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
GROUP BY client_id, order_date, item_name, product_line, currency
UNION ALL
SELECT
  client_id,
  order_date AS date,
  item_name  AS product_name,
  CAST(NULL AS STRING) AS product_line,
  SUM(quantity) AS units_sold,
  SUM(revenue)  AS revenue,
  SUM(margin)   AS margin,
  currency
FROM `oneeighty-warehouse.stg.stg_woo_order_items`
WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
GROUP BY client_id, order_date, item_name, currency;
