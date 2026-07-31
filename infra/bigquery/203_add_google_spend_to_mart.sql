-- 203_add_google_spend_to_mart.sql
-- =============================================================================
-- Rewrites mart_daily_kpis to include Google Ads spend and a real paid_spend.
-- Changes vs 300_create_mart_views.sql:
--   + google_daily CTE (from stg_google_ads_campaign_insights)
--   + meta_daily and google_daily merged into paid_daily (one FULL OUTER JOIN)
--   + new columns: google_spend, google_revenue, google_purchases, paid_spend
--   * cm3 now subtracts ALL paid media (meta + google), not just meta
--
-- DEPLOY PREREQ: 202_stg_google_ads.sql must be deployed first (which needs the
-- DTS transfer landed — see runbook 17). Until then, leave 300's mart_daily_kpis
-- in place; this file supersedes that one statement once Google data exists.
--
-- Backward-compatible: meta_spend / meta_revenue / etc. keep their names, so
-- existing Looker fields keep working. paid_spend is additive.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_daily_kpis` AS
WITH shopify_orders_daily AS (
  SELECT
    client_id,
    order_date                       AS date,
    currency,
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
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  GROUP BY client_id, order_date, currency
),
shopify_cogs_daily AS (
  SELECT client_id, order_date AS date, currency, SUM(line_cost) AS cogs
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  GROUP BY client_id, order_date, currency
),
shop_daily AS (
  -- Shopify branch
  SELECT
    o.client_id, o.date, o.currency,
    o.revenue, o.new_customer_revenue, o.returning_customer_revenue,
    o.net_sales, o.new_customer_net_sales, o.returning_customer_net_sales,
    o.shipping_revenue, o.tax_collected, o.gross_revenue_incl_tax,
    COALESCE(c.cogs, 0) AS cogs,
    o.orders, o.unique_customers, o.new_customer_orders, o.returning_customer_orders
  FROM shopify_orders_daily o
  LEFT JOIN shopify_cogs_daily c USING (client_id, date, currency)

  UNION ALL

  -- Shoptet branch (Manami)
  SELECT
    client_id,
    order_date AS date,
    'CZK'      AS currency,
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
    COUNT(DISTINCT order_code)         AS orders,
    COUNT(DISTINCT email)              AS unique_customers,
    COUNTIF(is_returning_customer IS FALSE) AS new_customer_orders,
    COUNTIF(is_returning_customer IS TRUE)  AS returning_customer_orders
  FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  GROUP BY client_id, order_date
),
meta_daily AS (
  SELECT
    client_id,
    date_start AS date,
    CASE WHEN client_id='manami' THEN 'CZK'
         WHEN client_id='dobias' THEN 'USD' ELSE 'UNKNOWN' END AS currency,
    SUM(spend)          AS meta_spend,
    SUM(purchase_value) AS meta_revenue,
    SUM(purchases)      AS meta_purchases,
    SUM(impressions)    AS meta_impressions,
    SUM(clicks)         AS meta_clicks,
    SUM(reach)          AS meta_reach
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights`
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  GROUP BY client_id, date_start
),
google_daily AS (
  SELECT
    client_id,
    date_start AS date,
    CASE WHEN client_id='manami' THEN 'CZK'
         WHEN client_id='dobias' THEN 'USD' ELSE 'UNKNOWN' END AS currency,
    SUM(spend)          AS google_spend,
    SUM(purchase_value) AS google_revenue,
    SUM(purchases)      AS google_purchases,
    SUM(impressions)    AS google_impressions,
    SUM(clicks)         AS google_clicks
  FROM `oneeighty-warehouse.stg.stg_google_ads_campaign_insights`
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  GROUP BY client_id, date, currency
),
paid_daily AS (
  -- Merge the two paid channels into one row per client/date/currency.
  SELECT
    COALESCE(m.client_id, g.client_id) AS client_id,
    COALESCE(m.date,      g.date)      AS date,
    COALESCE(m.currency,  g.currency)  AS currency,
    m.meta_spend, m.meta_revenue, m.meta_purchases, m.meta_impressions, m.meta_clicks, m.meta_reach,
    g.google_spend, g.google_revenue, g.google_purchases, g.google_impressions, g.google_clicks,
    COALESCE(m.meta_spend, 0) + COALESCE(g.google_spend, 0) AS paid_spend
  FROM meta_daily m
  FULL OUTER JOIN google_daily g
    ON m.client_id = g.client_id AND m.date = g.date AND m.currency = g.currency
)
SELECT
  COALESCE(s.client_id, p.client_id) AS client_id,
  COALESCE(s.date,      p.date)      AS date,
  COALESCE(s.currency,  p.currency)  AS currency,

  -- Revenue components
  s.revenue,
  s.new_customer_revenue,
  s.returning_customer_revenue,
  s.net_sales,
  s.new_customer_net_sales,
  s.returning_customer_net_sales,
  s.shipping_revenue,
  s.tax_collected,
  s.gross_revenue_incl_tax,

  -- Cost
  s.cogs,

  -- Orders
  s.orders, s.unique_customers, s.new_customer_orders, s.returning_customer_orders,

  -- Meta (unchanged names)
  p.meta_spend, p.meta_revenue, p.meta_purchases, p.meta_impressions, p.meta_clicks, p.meta_reach,

  -- Google (new)
  p.google_spend, p.google_revenue, p.google_purchases, p.google_impressions, p.google_clicks,

  -- Total paid media (NEW — denominator for MER / aMER / CAC)
  p.paid_spend,

  -- Variable cost placeholders
  CAST(0 AS NUMERIC) AS cm1_other_costs,
  CAST(0 AS NUMERIC) AS fulfillment_cost,

  -- CM stack — CM3 now nets ALL paid media, not just Meta
  s.revenue - s.cogs - 0                                                       AS cm1,
  s.revenue - s.cogs - 0 - 0                                                   AS cm2,
  s.revenue - s.cogs - 0 - 0 - COALESCE(p.paid_spend, 0)                       AS cm3

FROM shop_daily s
FULL OUTER JOIN paid_daily p
  ON s.client_id = p.client_id
 AND s.date      = p.date
 AND s.currency  = p.currency;
