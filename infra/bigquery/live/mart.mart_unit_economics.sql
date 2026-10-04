CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_unit_economics` AS
WITH shopify AS (
  SELECT
    i.client_id,
    i.order_date AS date,
    o.currency,
    IF(o.is_returning_customer, 'returning', 'new') AS segment,
    i.order_id,
    i.quantity,
    i.revenue + COALESCE(i.line_discount, 0) AS gross_retail,
    COALESCE(i.line_discount, 0)             AS discounts,
    i.revenue                                AS net_sales,
    i.line_cost                              AS cogs
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items` i
  JOIN `oneeighty-warehouse.stg.stg_shopify_orders` o
    ON i.client_id = o.client_id AND i.order_id = o.order_id
  WHERE i.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
    AND o.is_returning_customer IS NOT NULL
),
shoptet AS (
  SELECT
    i.client_id,
    i.order_date AS date,
    'CZK' AS currency,
    IF(o.is_returning_customer, 'returning', 'new') AS segment,
    i.order_code AS order_id,
    i.quantity,
    i.revenue_czk                AS gross_retail,
    CAST(NULL AS NUMERIC)        AS discounts,
    i.revenue_czk                AS net_sales,
    i.cost_czk                   AS cogs
  FROM `oneeighty-warehouse.stg.stg_shoptet_order_items` i
  JOIN `oneeighty-warehouse.stg.stg_shoptet_orders` o
    ON i.client_id = o.client_id AND i.order_code = o.order_code
  WHERE i.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
    AND o.is_returning_customer IS NOT NULL
),
-- WooCommerce mirrors the Shopify branch exactly: stg_woo_order_items already
-- exposes revenue as the post-discount, ex-VAT line total and line_discount as
-- the difference from the pre-discount subtotal, so gross_retail reconstructs
-- the same way.
woocommerce AS (
  SELECT
    i.client_id,
    i.order_date AS date,
    o.currency,
    IF(o.is_returning_customer, 'returning', 'new') AS segment,
    i.order_id,
    i.quantity,
    i.revenue + COALESCE(i.line_discount, 0) AS gross_retail,
    COALESCE(i.line_discount, 0)             AS discounts,
    i.revenue                                AS net_sales,
    i.line_cost                              AS cogs
  FROM `oneeighty-warehouse.stg.stg_woo_order_items` i
  JOIN `oneeighty-warehouse.stg.stg_woo_orders` o
    ON i.client_id = o.client_id AND i.order_id = o.order_id
  WHERE i.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
    AND o.is_returning_customer IS NOT NULL
),
lines AS (
  SELECT * FROM shopify
  UNION ALL SELECT * FROM shoptet
  UNION ALL SELECT * FROM woocommerce
)
SELECT
  client_id, date, currency, segment,
  COUNT(DISTINCT order_id) AS orders,
  SUM(quantity)            AS units,
  SUM(gross_retail)        AS gross_retail,
  SUM(discounts)           AS discounts,
  SUM(net_sales)           AS net_sales,
  SUM(cogs)                AS cogs,
  SUM(net_sales) - SUM(cogs) AS gross_profit
FROM lines
GROUP BY client_id, date, currency, segment;
