CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_customer_orders` AS
WITH order_costs AS (
  SELECT platform, client_id, order_id, SUM(line_cost) AS order_cogs
  FROM `oneeighty-warehouse.stg.stg_customer_order_items`
  WHERE platform IN ('shopify', 'woocommerce')
  GROUP BY platform, client_id, order_id
)
SELECT
  'shopify'                                         AS platform,
  o.client_id,
  o.order_id,
  o.order_date,
  o.currency,
  o.currency_original                               AS market_currency,
  o.customer_id                                     AS platform_customer_id,
  o.customer_email,
  NULLIF(LOWER(TRIM(o.customer_email)), '')         AS customer_key,
  o.is_returning_customer,
  o.subtotal_price + COALESCE(o.total_shipping, 0)  AS revenue,
  o.subtotal_price                                  AS net_sales,
  COALESCE(o.total_shipping, 0)                     AS shipping,
  c.order_cogs                                      AS cogs,
  CASE WHEN c.order_cogs IS NULL THEN NULL
       ELSE o.subtotal_price - c.order_cogs END     AS gross_profit,
  o.shipping_country
FROM `oneeighty-warehouse.stg.stg_shopify_orders` o
LEFT JOIN order_costs c
  ON c.platform = 'shopify' AND c.client_id = o.client_id AND c.order_id = o.order_id

UNION ALL

-- Shoptet: revenue is VAT inclusive in the customer marts (as live); margin
-- comes from the order, cost is what mart_daily_kpis derives from it.
SELECT
  'shoptet'                                         AS platform,
  client_id,
  order_code                                        AS order_id,
  order_date,
  'CZK'                                             AS currency,
  currency                                          AS market_currency,
  CAST(NULL AS STRING)                              AS platform_customer_id,
  email                                             AS customer_email,
  NULLIF(LOWER(TRIM(email)), '')                    AS customer_key,
  is_returning_customer,
  total_with_vat_czk                                AS revenue,
  product_revenue_czk                               AS net_sales,
  CAST(NULL AS NUMERIC)                             AS shipping,
  product_revenue_czk - margin_czk                  AS cogs,
  margin_czk                                        AS gross_profit,
  CAST(NULL AS STRING)                              AS shipping_country
FROM `oneeighty-warehouse.stg.stg_shoptet_orders`

UNION ALL

-- WooCommerce: amounts read by name from stg_woo_orders, so the stg definition
-- (incl. the 228 fee-line discounts in subtotal_price and net_revenue) is the
-- single source and Customers matches Snapshot.
SELECT
  'woocommerce'                                     AS platform,
  o.client_id,
  o.order_id,
  o.order_date,
  o.currency,
  o.currency_original                               AS market_currency,
  o.customer_id                                     AS platform_customer_id,
  o.customer_email,
  NULLIF(LOWER(TRIM(o.customer_email)), '')         AS customer_key,
  o.is_returning_customer,
  o.net_revenue                                     AS revenue,
  o.subtotal_price                                  AS net_sales,
  COALESCE(o.total_shipping, 0)                     AS shipping,
  c.order_cogs                                      AS cogs,
  -- NULL, never 0, when no line carries a cost: a 0 would read as 100% margin.
  CASE WHEN c.order_cogs IS NULL THEN NULL
       ELSE o.subtotal_price - c.order_cogs END     AS gross_profit,
  o.shipping_country
FROM `oneeighty-warehouse.stg.stg_woo_orders` o
LEFT JOIN order_costs c
  ON c.platform = 'woocommerce' AND c.client_id = o.client_id AND c.order_id = o.order_id;
