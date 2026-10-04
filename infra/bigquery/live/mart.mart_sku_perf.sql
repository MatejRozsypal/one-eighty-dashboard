CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_sku_perf` AS
SELECT
  client_id,
  order_date AS date,
  item_name  AS sku_name,
  variant,
  CAST(NULL AS STRING) AS product_line,  -- Shoptet doesn't have line concept
  SUM(quantity)        AS units_sold,
  SUM(revenue_czk)     AS revenue,
  SUM(cost_czk)        AS cost,
  SUM(margin_czk)      AS margin,
  SAFE_DIVIDE(SUM(margin_czk), SUM(revenue_czk)) * 100 AS margin_pct,
  'CZK' AS currency
FROM `oneeighty-warehouse.stg.stg_shoptet_order_items`
WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
GROUP BY client_id, order_date, item_name, variant
UNION ALL
SELECT
  client_id,
  order_date AS date,
  item_name  AS sku_name,
  sku        AS variant,
  product_line,
  SUM(quantity)  AS units_sold,
  SUM(revenue)   AS revenue,
  SUM(line_cost) AS cost,
  SUM(margin)    AS margin,
  SAFE_DIVIDE(SUM(margin), SUM(revenue)) * 100 AS margin_pct,
  currency
FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
GROUP BY client_id, order_date, item_name, sku, product_line, currency
UNION ALL
SELECT
  client_id,
  order_date AS date,
  item_name  AS sku_name,
  COALESCE(
    NULLIF(sku, ''),
    NULLIF(NULLIF(variation_id, ''), '0'),
    NULLIF(product_id, '')
  ) AS variant,
  CAST(NULL AS STRING) AS product_line,
  SUM(quantity)  AS units_sold,
  SUM(revenue)   AS revenue,
  SUM(line_cost) AS cost,
  SUM(margin)    AS margin,
  SAFE_DIVIDE(SUM(margin), SUM(revenue)) * 100 AS margin_pct,
  currency
FROM `oneeighty-warehouse.stg.stg_woo_order_items`
WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
GROUP BY client_id, order_date, item_name, variant, currency;
