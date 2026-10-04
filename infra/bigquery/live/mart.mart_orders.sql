CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_orders` AS
WITH shopify_order_costs AS (
  SELECT client_id, order_id, SUM(line_cost) AS order_cogs
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_id
),
woo_order_costs AS (
  SELECT client_id, order_id, SUM(line_cost) AS order_cogs
  FROM `oneeighty-warehouse.stg.stg_woo_order_items`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_id
)
SELECT
  'shopify'                                    AS platform,
  o.client_id,
  o.order_date                                 AS date,
  o.order_id,
  o.order_number,
  o.currency,
  o.currency_original                          AS market_currency,
  o.customer_email,
  o.shipping_country,
  o.shipping_province,
  o.subtotal_price + COALESCE(o.total_shipping, 0) AS revenue,
  o.subtotal_price                             AS net_sales,
  COALESCE(o.total_shipping, 0)                AS shipping_revenue,
  COALESCE(o.total_tax, 0)                     AS tax_collected,
  o.total_price                                AS gross_revenue_incl_tax,
  o.total_discounts,
  CASE WHEN c.order_cogs IS NULL THEN NULL
       ELSE o.subtotal_price - c.order_cogs END AS order_margin,
  o.financial_status,
  o.fulfillment_status,
  o.source_name,
  o.is_returning_customer,
  o.cancelled_at,
  o.processed_at
FROM `oneeighty-warehouse.stg.stg_shopify_orders` o
LEFT JOIN shopify_order_costs c USING (client_id, order_id)
WHERE o.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)

UNION ALL

SELECT
  'shoptet'                    AS platform,
  client_id,
  order_date                   AS date,
  order_code                   AS order_id,
  order_code                   AS order_number,
  'CZK'                        AS currency,
  currency                     AS market_currency,
  email                        AS customer_email,
  CAST(NULL AS STRING)         AS shipping_country,
  CAST(NULL AS STRING)         AS shipping_province,
  total_with_vat_czk           AS revenue,
  product_revenue_czk          AS net_sales,
  CAST(NULL AS NUMERIC)        AS shipping_revenue,
  CAST(NULL AS NUMERIC)        AS tax_collected,
  total_with_vat_czk           AS gross_revenue_incl_tax,
  CAST(NULL AS NUMERIC)        AS total_discounts,
  margin_czk                   AS order_margin,
  status                       AS financial_status,
  CAST(NULL AS STRING)         AS fulfillment_status,
  source                       AS source_name,
  is_returning_customer,
  CAST(NULL AS TIMESTAMP)      AS cancelled_at,
  CAST(NULL AS TIMESTAMP)      AS processed_at
FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)

UNION ALL

-- WooCommerce. `revenue` carries the contract's A (goods after discount, plus
-- shipping the customer paid, less the net part of any refund), as the handoff
-- specifies for this branch. That is a slightly tighter definition than the
-- Shopify branch above, which does not deduct refunds -- worth knowing before
-- comparing `revenue` across platforms in one chart.
SELECT
  'woocommerce'                AS platform,
  o.client_id,
  o.order_date                 AS date,
  o.order_id,
  o.order_number,
  o.currency,
  o.currency_original          AS market_currency,
  o.customer_email,
  o.shipping_country,
  CAST(NULL AS STRING)         AS shipping_province,
  o.net_revenue                AS revenue,
  o.subtotal_price             AS net_sales,
  COALESCE(o.total_shipping, 0) AS shipping_revenue,
  COALESCE(o.total_tax, 0)     AS tax_collected,
  o.total_price                AS gross_revenue_incl_tax,
  o.total_discounts,
  -- NULL, never 0, when the cost imprint is missing: a 0 would read as a 100%
  -- margin order.
  CASE WHEN c.order_cogs IS NULL THEN NULL
       ELSE o.subtotal_price - c.order_cogs END AS order_margin,
  o.financial_status,
  CAST(NULL AS STRING)         AS fulfillment_status,
  o.source_name,
  o.is_returning_customer,
  CAST(NULL AS TIMESTAMP)      AS cancelled_at,
  o.date_paid_gmt              AS processed_at
FROM `oneeighty-warehouse.stg.stg_woo_orders` o
LEFT JOIN woo_order_costs c USING (client_id, order_id)
WHERE o.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);
