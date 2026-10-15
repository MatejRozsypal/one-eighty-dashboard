-- =============================================================================
-- 284_shoptet_market_country.sql
-- Shoptet orders get a market country, so Manami splits by market like the
-- Shopify and WooCommerce clients (Markets page: P&L, LTGP, nCAC, AOV).
--
-- Why
--   stg_customer_orders hard-coded shipping_country = NULL for Shoptet, and
--   mart_customer_market_daily filtered platform IN ('shopify','woocommerce'),
--   so all 2,244 Manami orders of the last 12 months had no market.
--
-- What the raw data has (verified 2026-10-15)
--   Source: n8n wf_shoptet_bigquery_import, Shoptet CSV order export
--   https://eshop.manami.cz/export/orders.csv?patternId=12 . The transform keeps
--   currencyCode, phone and the shipping item name, and nothing else about
--   location. raw_shoptet_orders and payload_json have no country, zip or
--   address field.
--   What does carry the market:
--     a. currency: 100 % filled (CZK 1,896, EUR 348 in the last 12 months).
--     b. shippingMethod: for pickup-point carriers (GLS, Zasilkovna, Balikovna)
--        the shipping item name ends with the pickup point address and its
--        postcode, e.g. "... | <point>, <street>, Boskovice, 680 01".
--        CZ postcodes start with 1-7, SK postcodes with 0, 8 or 9.
--        2,079 of 2,244 orders have one; the postcode country equals the
--        currency country on all 2,079 (0 conflicts). Over the full history
--        6 CZK orders went to SK pickup points (Bratislava, Trencin, Martin,
--        Aug to Sep 2025): SK by delivery location, so the postcode wins.
--     c. storefront: the export host, eshop.manami.cz (one Shoptet project,
--        one domain; EUR and CZK orders come from the same storefront).
--
-- Market rule (owner): shipping country first, currency as fallback, domain
-- as last fallback. Implemented as
--     shipping_country = COALESCE(
--       delivery country name from payload_json  -- NULL until the export adds it
--       pickup point postcode country            -- the delivery location
--       currency country  (per client: Manami CZK -> CZ, EUR -> SK)
--       storefront domain country (eshop.manami.cz -> CZ))
--   and country_source says which one decided.
--   EUR -> SK for Manami: 346 of 348 EUR orders carry a +421 phone and every
--   EUR order with a pickup postcode has an SK postcode.
--
-- Forward compatible: when the export pattern adds #deliveryCountryName# and
-- the n8n transform copies it into the order object, it lands in payload_json
-- with no raw DDL change, and wins over the postcode.
--
-- Changes
--   1. stg.stg_shoptet_orders: appends delivery_country_name, pickup_postcode,
--      shipping_country, country_source, storefront_domain (end of the column
--      list, nothing existing moves or changes).
--   2. stg.stg_customer_orders: Shoptet shipping_country from (1); appends
--      country_source and storefront_domain to all three branches
--      (Shopify / Woo: 'platform' and NULL).
--   3. mart.mart_customer_market_daily: includes platform 'shoptet'.
--
-- Not changed on purpose (live pages, opt-in later):
--   mart_orders keeps CAST(NULL) shipping_country for Shoptet (the Orders page
--   labels the Shoptet split as currency), mart_customer_cohort_grid keeps
--   market = market_currency for Shoptet. Neither reads the changed column for
--   Shoptet, so their output is identical after this migration.
--
-- Live definitions of all three views equal infra/bigquery/live/*.sql as of
-- 2026-10-15 (checked against INFORMATION_SCHEMA.VIEWS).
-- QA copies: mart_qa.mm1_stg_shoptet_orders, mart_qa.mm1_stg_customer_orders,
--            mart_qa.mm1_mart_customer_market_daily, mart_qa.mm1_manami_market_12m.
-- Regression: infra/bigquery/qa/284_regression.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. stg.stg_shoptet_orders
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shoptet_orders` AS
WITH deduped AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY client_id, code ORDER BY ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_shoptet_orders`
    WHERE orderDate >= '2020-01-01'
  )
  WHERE rn = 1
    -- Substring match: the previous exact-match list ('storno','cancelled','zrušeno')
    -- never fired, because Shoptet's actual status is 'Stornována'. 119 cancelled
    -- orders were counted as real orders (0 revenue each), inflating order counts
    -- and deflating AOV. Substring matching also survives status renames.
    AND LOWER(statusName) NOT LIKE '%storno%'
    AND LOWER(statusName) NOT IN ('cancelled', 'zrušeno')
),
cost_adj AS (
  SELECT client_id, order_code, SUM(cost_czk) AS adj_czk
  FROM `oneeighty-warehouse.stg.stg_shoptet_order_items`
  WHERE cost_is_imputed
  GROUP BY client_id, order_code
),
-- One row per Shoptet client: the storefront the export is pulled from and the
-- country that storefront sells to by default. Move to ref.clients when a
-- second Shoptet client arrives.
storefronts AS (
  SELECT 'manami' AS client_id, 'eshop.manami.cz' AS storefront_domain, 'CZ' AS domain_country
),
-- Transacting currency -> market country, per client (EUR is not SK for
-- every shop, so this is never a global map).
currency_markets AS (
  SELECT * FROM UNNEST([
    STRUCT('manami' AS client_id, 'CZK' AS currency, 'CZ' AS currency_country),
    STRUCT('manami', 'EUR', 'SK')
  ])
),
market AS (
  SELECT
    d.*,
    NULLIF(TRIM(JSON_VALUE(d.payload_json, '$.deliveryCountryName')), '') AS delivery_country_name,
    -- Pickup point postcode at the end of the shipping item name
    -- ("<carrier> - <id> | <point>, <street>, <city>, 680 01").
    REPLACE(REGEXP_EXTRACT(d.shippingMethod, r'\|.*,\s*(\d{3} ?\d{2})\s*$'), ' ', '') AS pickup_postcode
  FROM deduped d
),
market_country AS (
  SELECT
    m.*,
    -- Shoptet exports the country by its name in the shop admin language.
    -- Unmapped names fall through to the next rule and show up in the
    -- 284 regression (check 4), so a new name is never silently wrong.
    CASE LOWER(m.delivery_country_name)
      WHEN 'česká republika'     THEN 'CZ'
      WHEN 'česko'               THEN 'CZ'
      WHEN 'czech republic'      THEN 'CZ'
      WHEN 'czechia'             THEN 'CZ'
      WHEN 'slovensko'           THEN 'SK'
      WHEN 'slovenská republika' THEN 'SK'
      WHEN 'slovakia'            THEN 'SK'
    END AS delivery_country,
    -- CZ postcodes run 100 00 to 799 99, SK postcodes start with 0, 8 or 9.
    CASE
      WHEN m.pickup_postcode IS NULL THEN NULL
      WHEN SUBSTR(m.pickup_postcode, 1, 1) IN ('0', '8', '9') THEN 'SK'
      ELSE 'CZ'
    END AS postcode_country
  FROM market m
)
SELECT
  d.client_id,
  d.code AS order_code,
  d.orderDate AS order_date,
  d.statusName AS status,
  d.sourceName AS source,
  d.email,
  d.currency,
  d.exchangeRate AS exchange_rate,
  d.totalPriceWithVat        AS total_with_vat,
  d.totalPriceWithVatCZK     AS total_with_vat_czk,
  d.productRevenue           AS product_revenue,
  d.productRevenueCZK        AS product_revenue_czk,
  d.totalMargin - COALESCE(a.adj_czk, 0) / IF(d.currency = 'CZK', NUMERIC '1', d.exchangeRate) AS margin,
  d.totalMarginCZK - COALESCE(a.adj_czk, 0) AS margin_czk,
  d.priceToPay               AS price_to_pay,
  d.priceToPayCZK            AS price_to_pay_czk,
  d.shippingMethod  AS shipping_method,
  d.paymentMethod   AS payment_method,
  d.itemCount       AS item_count,
  d.totalQuantity   AS total_quantity,
  CASE
    WHEN d.email IS NULL OR TRIM(d.email) = '' THEN CAST(NULL AS BOOL)
    ELSE ROW_NUMBER() OVER (
      PARTITION BY d.client_id, LOWER(TRIM(d.email))
      ORDER BY d.orderDate, d.code
    ) > 1
  END AS is_returning_customer,
  d.customerOrderCount  AS customer_order_count,
  d.isReturningCustomer AS is_returning_customer_raw,
  d.ingested_at,
  -- Market (284): shipping country first, currency second, storefront last.
  d.delivery_country_name,
  d.pickup_postcode,
  COALESCE(d.delivery_country, d.postcode_country, cm.currency_country, sf.domain_country) AS shipping_country,
  CASE
    WHEN d.delivery_country  IS NOT NULL THEN 'delivery_country'
    WHEN d.postcode_country  IS NOT NULL THEN 'pickup_postcode'
    WHEN cm.currency_country IS NOT NULL THEN 'currency'
    WHEN sf.domain_country   IS NOT NULL THEN 'storefront_domain'
  END AS country_source,
  sf.storefront_domain
FROM market_country d
LEFT JOIN cost_adj a
  ON a.client_id = d.client_id AND a.order_code = d.code
LEFT JOIN currency_markets cm
  ON cm.client_id = d.client_id AND cm.currency = d.currency
LEFT JOIN storefronts sf
  ON sf.client_id = d.client_id;

-- -----------------------------------------------------------------------------
-- 2. stg.stg_customer_orders
-- -----------------------------------------------------------------------------
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
  o.shipping_country,
  'platform'                                        AS country_source,
  CAST(NULL AS STRING)                              AS storefront_domain
FROM `oneeighty-warehouse.stg.stg_shopify_orders` o
LEFT JOIN order_costs c
  ON c.platform = 'shopify' AND c.client_id = o.client_id AND c.order_id = o.order_id

UNION ALL

-- Shoptet: revenue is VAT inclusive in the customer marts (as live); margin
-- comes from the order, cost is what mart_daily_kpis derives from it.
-- shipping_country follows the 284 market rule (see stg_shoptet_orders).
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
  shipping_country,
  country_source,
  storefront_domain
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
  o.shipping_country,
  'platform'                                        AS country_source,
  CAST(NULL AS STRING)                              AS storefront_domain
FROM `oneeighty-warehouse.stg.stg_woo_orders` o
LEFT JOIN order_costs c
  ON c.platform = 'woocommerce' AND c.client_id = o.client_id AND c.order_id = o.order_id;

-- -----------------------------------------------------------------------------
-- 3. mart.mart_customer_market_daily: Shoptet included
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_market_daily` AS
SELECT
  client_id,
  order_date                                                        AS date,
  shipping_country                                                  AS market,
  COUNT(DISTINCT order_id)                                          AS orders,
  COUNTIF(is_returning_customer IS FALSE)                           AS new_customer_orders,
  COUNTIF(is_returning_customer IS TRUE)                            AS returning_customer_orders,
  SUM(revenue)                                                      AS revenue,
  SUM(IF(is_returning_customer IS FALSE, revenue, 0))               AS new_customer_revenue,
  SUM(IF(is_returning_customer IS TRUE,  revenue, 0))               AS returning_customer_revenue,
  SUM(net_sales)                                                    AS net_sales,
  SAFE_DIVIDE(SUM(net_sales), COUNT(DISTINCT order_id))             AS aov,
  SAFE_DIVIDE(COUNTIF(is_returning_customer IS FALSE),
              COUNT(DISTINCT order_id)) * 100                       AS new_customer_pct
FROM `oneeighty-warehouse.stg.stg_customer_orders`
WHERE platform IN ('shopify', 'woocommerce', 'shoptet')
  AND order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
GROUP BY client_id, order_date, shipping_country;
