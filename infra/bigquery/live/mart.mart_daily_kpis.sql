CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_daily_kpis` AS
WITH client_ccy AS (
  SELECT client_id, currency AS client_currency, meta_currency, gads_currency
  FROM `oneeighty-warehouse.ref.clients`
),
shopify_orders_daily AS (
  SELECT
    client_id, order_date AS date, currency,
    SUM(subtotal_price + COALESCE(total_shipping, 0)) AS revenue,
    SUM(IF(is_returning_customer IS FALSE, subtotal_price + COALESCE(total_shipping, 0), 0)) AS new_customer_revenue,
    SUM(IF(is_returning_customer IS TRUE,  subtotal_price + COALESCE(total_shipping, 0), 0)) AS returning_customer_revenue,
    SUM(subtotal_price)              AS net_sales,
    SUM(IF(is_returning_customer IS FALSE, subtotal_price, 0)) AS new_customer_net_sales,
    SUM(IF(is_returning_customer IS TRUE,  subtotal_price, 0)) AS returning_customer_net_sales,
    SUM(COALESCE(total_shipping, 0)) AS shipping_revenue,
    SUM(COALESCE(total_tax, 0))      AS tax_collected,
    SUM(total_price)                 AS gross_revenue_incl_tax,
    COUNT(DISTINCT order_id)         AS orders,
    COUNT(DISTINCT customer_email)   AS unique_customers,
    COUNTIF(is_returning_customer IS FALSE) AS new_customer_orders,
    COUNTIF(is_returning_customer IS TRUE)  AS returning_customer_orders
  FROM `oneeighty-warehouse.stg.stg_shopify_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_date, currency
),
shopify_cogs_daily AS (
  SELECT client_id, order_date AS date, currency, SUM(line_cost) AS cogs
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_date, currency
),
woo_orders_daily AS (
  SELECT
    client_id, order_date AS date, currency,
    SUM(net_revenue) AS revenue,
    SUM(IF(is_returning_customer IS FALSE, net_revenue, 0)) AS new_customer_revenue,
    SUM(IF(is_returning_customer IS TRUE,  net_revenue, 0)) AS returning_customer_revenue,
    SUM(subtotal_price)              AS net_sales,
    SUM(IF(is_returning_customer IS FALSE, subtotal_price, 0)) AS new_customer_net_sales,
    SUM(IF(is_returning_customer IS TRUE,  subtotal_price, 0)) AS returning_customer_net_sales,
    SUM(COALESCE(total_shipping, 0)) AS shipping_revenue,
    SUM(COALESCE(total_tax, 0))      AS tax_collected,
    SUM(total_price)                 AS gross_revenue_incl_tax,
    SUM(fulfillment_variable)        AS fulfillment_cost,
    COUNT(DISTINCT order_id)         AS orders,
    COUNT(DISTINCT customer_email)   AS unique_customers,
    COUNTIF(is_returning_customer IS FALSE) AS new_customer_orders,
    COUNTIF(is_returning_customer IS TRUE)  AS returning_customer_orders
  FROM `oneeighty-warehouse.stg.stg_woo_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_date, currency
),
woo_cogs_daily AS (
  SELECT client_id, order_date AS date, currency, SUM(line_cost) AS cogs
  FROM `oneeighty-warehouse.stg.stg_woo_order_items`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_date, currency
),
shop_daily AS (
  SELECT
    o.client_id, o.date, o.currency,
    o.revenue, o.new_customer_revenue, o.returning_customer_revenue,
    o.net_sales, o.new_customer_net_sales, o.returning_customer_net_sales,
    o.shipping_revenue, o.tax_collected, o.gross_revenue_incl_tax,
    COALESCE(c.cogs, 0) AS cogs,
    CAST(0 AS NUMERIC)  AS fulfillment_cost,
    o.orders, o.unique_customers, o.new_customer_orders, o.returning_customer_orders
  FROM shopify_orders_daily o
  LEFT JOIN shopify_cogs_daily c USING (client_id, date, currency)

  UNION ALL

  SELECT
    client_id, order_date AS date, 'CZK' AS currency,
    SUM(total_with_vat_czk)            AS revenue,
    SUM(IF(is_returning_customer IS FALSE, total_with_vat_czk, 0)) AS new_customer_revenue,
    SUM(IF(is_returning_customer IS TRUE,  total_with_vat_czk, 0)) AS returning_customer_revenue,
    SUM(product_revenue_czk)           AS net_sales,
    SUM(IF(is_returning_customer IS FALSE, product_revenue_czk, 0)) AS new_customer_net_sales,
    SUM(IF(is_returning_customer IS TRUE,  product_revenue_czk, 0)) AS returning_customer_net_sales,
    CAST(NULL AS NUMERIC)              AS shipping_revenue,
    CAST(NULL AS NUMERIC)              AS tax_collected,
    SUM(total_with_vat_czk)            AS gross_revenue_incl_tax,
    SUM(product_revenue_czk) - SUM(margin_czk) AS cogs,
    CAST(0 AS NUMERIC)                 AS fulfillment_cost,
    COUNT(DISTINCT order_code)         AS orders,
    COUNT(DISTINCT email)              AS unique_customers,
    COUNTIF(is_returning_customer IS FALSE) AS new_customer_orders,
    COUNTIF(is_returning_customer IS TRUE)  AS returning_customer_orders
  FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_date

  UNION ALL

  SELECT
    o.client_id, o.date, o.currency,
    o.revenue, o.new_customer_revenue, o.returning_customer_revenue,
    o.net_sales, o.new_customer_net_sales, o.returning_customer_net_sales,
    o.shipping_revenue, o.tax_collected, o.gross_revenue_incl_tax,
    c.cogs              AS cogs,
    o.fulfillment_cost,
    o.orders, o.unique_customers, o.new_customer_orders, o.returning_customer_orders
  FROM woo_orders_daily o
  LEFT JOIN woo_cogs_daily c USING (client_id, date, currency)
),
meta_rows AS (
  SELECT
    m.client_id, m.date_start AS date, c.client_currency AS currency,
    IF(c.meta_currency = c.client_currency, NUMERIC '1', r.rate) AS fx,
    m.spend, m.purchase_value, m.purchases, m.impressions, m.clicks, m.reach
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` m
  JOIN client_ccy c ON c.client_id = m.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` r
    ON  r.month_start   = DATE_TRUNC(m.date_start, MONTH)
    AND r.from_currency = c.meta_currency
    AND r.to_currency   = c.client_currency
  WHERE m.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
),
meta_daily AS (
  SELECT client_id, date, currency,
    SUM(spend * fx) AS meta_spend, SUM(purchase_value * fx) AS meta_revenue,
    SUM(purchases) AS meta_purchases, SUM(impressions) AS meta_impressions,
    SUM(clicks) AS meta_clicks, SUM(reach) AS meta_reach
  FROM meta_rows GROUP BY client_id, date, currency
),
google_rows AS (
  SELECT
    g.client_id, g.date_start AS date, c.client_currency AS currency,
    CAST(IF(c.gads_currency = c.client_currency, NUMERIC '1', r.rate) AS FLOAT64) AS fx,
    g.spend, g.purchase_value, g.purchases, g.impressions, g.clicks
  FROM `oneeighty-warehouse.stg.stg_google_ads_campaign_insights` g
  JOIN client_ccy c ON c.client_id = g.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` r
    ON  r.month_start   = DATE_TRUNC(g.date_start, MONTH)
    AND r.from_currency = c.gads_currency
    AND r.to_currency   = c.client_currency
  WHERE g.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
),
google_daily AS (
  SELECT client_id, date, currency,
    SUM(spend * fx) AS google_spend, SUM(purchase_value * fx) AS google_revenue,
    SUM(purchases) AS google_purchases, SUM(impressions) AS google_impressions,
    SUM(clicks) AS google_clicks
  FROM google_rows GROUP BY client_id, date, currency
),
paid_daily AS (
  SELECT
    COALESCE(m.client_id, g.client_id) AS client_id,
    COALESCE(m.date,      g.date)      AS date,
    COALESCE(m.currency,  g.currency)  AS currency,
    m.meta_spend, m.meta_revenue, m.meta_purchases, m.meta_impressions, m.meta_clicks, m.meta_reach,
    g.google_spend, g.google_revenue, g.google_purchases, g.google_impressions, g.google_clicks,
    COALESCE(m.meta_spend, 0) + CAST(COALESCE(g.google_spend, 0) AS NUMERIC) AS paid_spend
  FROM meta_daily m
  FULL OUTER JOIN google_daily g
    ON m.client_id = g.client_id AND m.date = g.date AND m.currency = g.currency
),
-- Clients that have cost data: at least one shop day with a non-NULL cogs.
-- Shopify and Shoptet always have one (cogs is coalesced to 0 or computed);
-- a Woo client has one only when some line is costed (migration 228), so
-- RawBark is absent here until its cost list is loaded.
client_cost_data AS (
  SELECT DISTINCT client_id
  FROM shop_daily
  WHERE cogs IS NOT NULL
)
SELECT
  COALESCE(s.client_id, p.client_id) AS client_id,
  COALESCE(s.date,      p.date)      AS date,
  COALESCE(s.currency,  p.currency)  AS currency,
  s.revenue, s.new_customer_revenue, s.returning_customer_revenue,
  s.net_sales, s.new_customer_net_sales, s.returning_customer_net_sales,
  s.shipping_revenue, s.tax_collected, s.gross_revenue_incl_tax,
  s.cogs,
  s.orders, s.unique_customers, s.new_customer_orders, s.returning_customer_orders,
  p.meta_spend, p.meta_revenue, p.meta_purchases, p.meta_impressions, p.meta_clicks, p.meta_reach,
  p.google_spend, p.google_revenue, p.google_purchases, p.google_impressions, p.google_clicks,
  p.paid_spend,
  CAST(0 AS NUMERIC) AS cm1_other_costs,
  COALESCE(s.fulfillment_cost, 0) AS fulfillment_cost,
  -- Day with paid spend and no shop row at all (s.client_id IS NULL) for a client
  -- with cost data: no orders means revenue 0, COGS 0, fulfilment 0, so the day
  -- costs exactly its paid spend. Without a cost-data client (RawBark) it stays NULL.
  IF(s.client_id IS NULL AND k.client_id IS NOT NULL,
     CAST(0 AS NUMERIC),
     s.revenue - s.cogs - 0)                                      AS cm1,
  IF(s.client_id IS NULL AND k.client_id IS NOT NULL,
     CAST(0 AS NUMERIC) - COALESCE(s.fulfillment_cost, 0),
     s.revenue - s.cogs - 0 - COALESCE(s.fulfillment_cost, 0))    AS cm2,
  IF(s.client_id IS NULL AND k.client_id IS NOT NULL,
     CAST(0 AS NUMERIC) - COALESCE(s.fulfillment_cost, 0) - COALESCE(p.paid_spend, 0),
     s.revenue - s.cogs - 0 - COALESCE(s.fulfillment_cost, 0) - COALESCE(p.paid_spend, 0)) AS cm3
FROM shop_daily s
FULL OUTER JOIN paid_daily p
  ON s.client_id = p.client_id AND s.date = p.date AND s.currency = p.currency
LEFT JOIN client_cost_data k
  ON k.client_id = COALESCE(s.client_id, p.client_id);
