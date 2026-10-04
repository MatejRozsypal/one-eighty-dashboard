-- =============================================================================
-- 234_cm3_zero_order_days.sql
-- CM1 to CM3 on days with paid spend and no orders.
--
-- Problem
--   mart.mart_daily_kpis FULL OUTER JOINs shop days to paid-media days. A day
--   with ad spend and no shop row has revenue and cogs NULL, so cm1, cm2 and
--   cm3 were NULL and SUM(cm3) over a range silently dropped that day's spend.
--   Found by the reporting-suite work (rs1): over the last 90 days CM3 was too
--   high by 4,734.43 CZK for ethia (5 days) and 2,674.33 EUR for venev
--   (38 days); P&L, YoY, Goals and Growth all sum the mart column.
--
-- Rule (only the final SELECT of the view changes)
--   A day with no shop row (s.client_id IS NULL) for a client that has cost
--   data gets cm1 = 0, cm2 = 0 - fulfilment (0), cm3 = -paid_spend.
--   "Client has cost data" = at least one of its shop days has a non-NULL cogs
--   (new CTE client_cost_data). Shopify and Shoptet always qualify; a Woo
--   client qualifies only once a line is costed (migration 228), so RawBark
--   stays NULL on every day (no cost data is not zero). Nothing else changes:
--   revenue, cogs, orders and every other column stay NULL on those rows, and
--   rows that have a shop row are byte for byte as before (including dobias'
--   240 old shop rows with NULL revenue and no spend, which stay NULL: they
--   are a different data gap, not a zero-order day).
--
-- Why this shape
--   The predicate keys on "no shop row", not on "revenue NULL or 0": dobias has
--   240 shop rows (2021-10..2022-05) with orders and cogs but NULL revenue, and
--   a rule on revenue would have turned those into 0. Keying on the client
--   instead of the row keeps the rule data driven: when RawBark costs are
--   loaded it starts applying by itself, with no edit here.
--
-- Dependants (checked against live INFORMATION_SCHEMA.VIEWS 2026-10-04)
--   mart.mart_monthly_kpis   SUM(cm1/cm2/cm3) over the daily view: picks the fix
--                            up with no text change (verified, qa R4).
--   mart.mart_cm3_monthly    NOT affected: monthly grain, it subtracts the whole
--                            month of Meta and Google spend regardless of order
--                            days. (It has no row for a month without orders, a
--                            different, pre-existing property; ref.contracts is
--                            empty today so it returns no rows.)
--   mart.mart_profit_share_monthly  reads mart_cm3_monthly only. Unaffected.
--   stg.stg_customer_orders  reads revenue and cogs of mart_daily_kpis, which do
--                            not change. Unaffected.
--   dashboard goals.ts / pnl.ts (SUM(cm3) on the daily view), growth.ts and
--   yoy.ts (mart_monthly_kpis.cm3): fixed by this migration, no code change.
--
-- Based on the live view definition read from INFORMATION_SCHEMA.VIEWS on
-- 2026-10-04 (mart.mart_daily_kpis md5 563f7c75de0a3ccd77a1bca45a52a4f5, equal
-- to the 228 step 4 body, so 228 is deployed). The body below is that text plus
-- two edits (new CTE client_cost_data; the cm1/cm2/cm3 expressions, the FROM
-- and one LEFT JOIN). md5 of the body below: 9dc5140218469a887bed32050d1bbf0e,
-- equal to the stored text of mart_qa.m234_mart_daily_kpis.
--
-- Affected clients: ethia, venev (last 90 days), manami (17 paid-only days in
-- 2025-05-16..2026-01-22, none in the last 90 days). dobias, rawbark: zero diff.
-- Columns: only cm1, cm2, cm3, and only on rows that had orders NULL and cm NULL.
-- No schema change (34 columns, names, order and types identical).
--
-- Effect, full history (candidate minus prod, SUM(cm3)):
--   ethia -29,572.13 CZK (55 days), manami -6,686.76 CZK (17 days),
--   venev -4,446.55 EUR (84 days). Last 90 days: ethia -4,734.43, venev -2,674.33.
--
-- Regression: qa/234_regression.sql, 2026-10-04, candidates mart_qa.m234_*.
--   R1/R2 diff rows = exactly the paid-only rows, each cm1 0, cm2 0, cm3 -spend,
--   all other columns identical; R3 SUM(cm3) = component formula for every
--   client with cost data (diff 0, was 4,734.43 and 2,674.33), RawBark NULL;
--   R4 monthly mart only cm3 moves; R5 schema identical; R6 synthetic edges.
--
-- Deploy order (owner OK required, prod):
--   step 0  snapshot: CREATE TABLE mart_qa.base_mart_daily_kpis_20261005 AS
--           SELECT * FROM mart.mart_daily_kpis; same for mart_monthly_kpis
--           (qa/234_regression.sql header explains the post-deploy re-run)
--   step 1  mart.mart_daily_kpis (this file's only statement)
--   step 2  re-run qa/234_regression.sql R0 to R5 against prod and the snapshots
--           (mart_monthly_kpis needs no statement, it is a view over step 1)
--   Independent of 228 (already live) and of every other open migration; no
--   other migration rewrites mart_daily_kpis in the 228 to 249 range.
--   Rollback: re-run step 4 of 228_woo_fee_lines_cogs_null.sql (the live text
--   before this migration).
-- =============================================================================

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
