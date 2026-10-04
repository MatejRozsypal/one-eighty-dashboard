-- =============================================================================
-- 229_customer_marts_woo.sql
-- =============================================================================
-- Purpose
--   WooCommerce clients (ethia, rawbark) get the customer marts that drive
--   Customers, Cohorts, Repurchase, Repeat timing and Time between orders.
--   Two new stg union views carry one row per order (and per order line) for
--   Shopify, Shoptet and WooCommerce with shared column names. The customer
--   marts are repointed at them, so a platform is added in one place, not in
--   eight.
--
-- Based on
--   LIVE definitions read from INFORMATION_SCHEMA.VIEWS on 2026-10-04 (the repo
--   DDL has drifted; nothing here is based on 208, 210, 212 or 213):
--   mart.mart_customer_lifetime, mart_customer_cohort_grid,
--   mart_customer_payback, mart_customer_product_steps, mart_customer_daily,
--   mart_customer_market_daily, mart_order_gaps, stg.stg_woo_orders,
--   stg.stg_woo_order_items.
--   Not redeployed, they follow by name: mart_customer_cohorts (reads
--   lifetime), mart_first_product_repeat and mart_product_journey (read
--   product_steps).
--
-- Affected clients
--   ethia, rawbark: new rows in every mart below.
--   manami, dobias, venev: no change (zero-diff regression, see below).
--
-- Per-platform behaviour that is kept exactly as it was
--   * Shoptet revenue in the customer marts stays total_with_vat_czk (VAT
--     included) and gross profit stays margin_czk. Shoptet market stays the
--     order currency (market_kind = 'currency').
--   * Shopify revenue stays subtotal_price + shipping, gross profit stays
--     subtotal_price - SUM(line_cost), NULL when the order has no costed line.
--   * Shopify identity in mart_customer_product_steps stays
--     COALESCE(customer_id, LOWER(customer_email)), with no date window.
--   * mart_customer_daily and mart_customer_market_daily still exclude Shoptet
--     (manami). Adding it is a separate, logged P2 item: Shoptet revenue is VAT
--     inclusive and has no shipping split, so it is not a trivial add.
--   * Windows: 60 months everywhere, 24 months in mart_order_gaps, none in
--     mart_customer_product_steps (as live).
--
-- One harmonisation (zero rows affected today)
--   The live marts built the email key two ways: LOWER(email) in lifetime,
--   order_gaps and Shoptet product steps; LOWER(TRIM(email)) in cohort_grid
--   and payback. All marts now use stg_customer_orders.customer_key =
--   NULLIF(LOWER(TRIM(email)), ''). On 2026-10-04 no Shopify, Shoptet or Woo
--   email has leading or trailing whitespace, so the outputs are identical;
--   the regression below proves it. If such an email ever appears it is now
--   merged with its trimmed twin instead of becoming a second customer.
--
-- WooCommerce specifics
--   * Identity: LOWER(TRIM(customer_email)); orders without an email are
--     excluded from per-customer marts (none today), as for Shopify.
--   * revenue   = stg_woo_orders.net_revenue, net_sales = stg_woo_orders.
--     subtotal_price, both read by name. After 228 both carry the fee-line
--     discounts, so Customers matches Snapshot (mart_daily_kpis uses the same
--     two columns). revenue = net_sales + shipping - net part of refunds, the
--     same split mart_orders and mart_daily_kpis use for Woo.
--   * gross_profit = net_sales - SUM(stg_woo_order_items.line_cost), the
--     Shopify and mart_orders definition. NULL, never 0, when the order has no
--     costed line (rawbark today: no cost data, so NULL, not a fake 100%
--     margin).
--   * Market = shipping_country (stg carries billing_country there).
--   * Currency = client currency (stg already converts EUR orders to CZK; an
--     order with no FX rate keeps NULL revenue and still counts as an order).
--   * Product key = COALESCE(NULLIF(sku, ''), product_id, item_name), with
--     product_id '0' or '' treated as missing (37 ethia lines of deleted
--     bundles carry product_id 0). Display label per key = its shortest line
--     name (Woo variation names are "Parent - attribute", so the shortest is
--     usually the parent product), ties by name.
--   * Payback: a Woo customer with no costed order in the window has NULL
--     gross profit (never 0). Shopify and Shoptet keep the live "uncosted order
--     adds 0" behaviour byte for byte.
--
-- Regression (mart_qa.wp4_* and wp4_w3_* candidates, 2026-10-04; queries and
-- full results in qa/229_regression.sql)
--   * manami, dobias, venev: 0 diff rows both directions in lifetime,
--     cohort_grid, payback, daily, market_daily, order_gaps and (snapshot
--     compare) product_steps. mart_customer_cohorts: 0 diff on every non-float
--     column; its two ROUND(AVG(INT64), 2) columns flip by 0.01 at exact half
--     values in prod itself (FLOAT64 summation order, unchanged definition).
--   * ethia, rawbark: lifetime orders = stg orders with email (1,805 / 50,008),
--     customers = distinct emails (1,256 / 14,485), first orders 2025-03-02 /
--     2022-10-01, cohort grid month 0 = cohort size, 90-day returning share =
--     stg (50.2% / 87.0%), mart_customer_daily = mart_daily_kpis on every day.
--     Same checks pass on top of the WP3 (228) candidates.
--   * Determinism: 5 runs, identical fingerprints for every candidate view.
--
-- Deploy order (owner OK required; do not run piecemeal)
--   0. 228_woo_fee_lines_cogs_null.sql (WP3) first.
--   1. stg.stg_customer_order_items
--   2. stg.stg_customer_orders            (reads 1)
--   3. mart.mart_customer_lifetime        (mart_customer_cohorts follows)
--   4. mart.mart_customer_cohort_grid
--   5. mart.mart_customer_payback
--   6. mart.mart_customer_product_steps   (first_product_repeat, product_journey follow)
--   7. mart.mart_customer_daily
--   8. mart.mart_customer_market_daily
--   9. mart.mart_order_gaps
--   228_woo_fee_lines_cogs_null.sql (WP3) deploys BEFORE this file. These
--   views read stg_woo_orders.subtotal_price / net_revenue and
--   stg_woo_order_items.revenue / line_cost by name, so they take the 228
--   definitions without any edit here. They also run correctly on the pre-228
--   stg (then without the fee-line discounts).
-- =============================================================================


-- 1. Order lines, all shop platforms --------------------------------------------
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


-- 2. Orders, all shop platforms -------------------------------------------------
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


-- 3. Customer lifetime ----------------------------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_lifetime` AS
WITH all_orders AS (
  SELECT
    client_id,
    customer_key,
    order_date,
    revenue      AS order_revenue,
    gross_profit AS order_margin,
    currency
  FROM `oneeighty-warehouse.stg.stg_customer_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
    AND customer_key IS NOT NULL
),
with_first_date AS (
  -- Tag each order with the customer's first_order_date so we can compute Y1 windows
  SELECT *,
    MIN(order_date) OVER (PARTITION BY client_id, customer_key, currency) AS customer_first_order_date
  FROM all_orders
)
SELECT
  client_id,
  customer_key AS customer_email,
  currency,
  -- Lifetime metrics (all orders within the 60-month data window)
  COUNT(*)                                          AS total_orders,
  SUM(order_revenue)                                AS lifetime_revenue,
  SUM(order_margin)                                 AS lifetime_gross_profit,
  -- Y1 metrics (orders within 365 days of first order, same maturity per customer)
  COUNTIF(DATE_DIFF(order_date, customer_first_order_date, DAY) <= 365)             AS y1_orders,
  SUM(CASE WHEN DATE_DIFF(order_date, customer_first_order_date, DAY) <= 365
           THEN order_revenue END)                                                  AS y1_revenue,
  SUM(CASE WHEN DATE_DIFF(order_date, customer_first_order_date, DAY) <= 365
           THEN order_margin END)                                                   AS y1_gross_profit,
  -- Maturity flag, TRUE only when customer has had a full Y1 window
  DATE_DIFF(CURRENT_DATE(), MIN(order_date), DAY) >= 365                            AS is_y1_complete,
  -- Identifying info
  MIN(order_date)                                                                   AS first_order_date,
  MAX(order_date)                                                                   AS last_order_date,
  DATE_DIFF(MAX(order_date), MIN(order_date), DAY)                                  AS days_active,
  COUNT(*) > 1                                                                      AS is_returning,
  -- Derived
  SAFE_DIVIDE(SUM(order_revenue), COUNT(*))                                         AS aov,
  SAFE_DIVIDE(SUM(order_margin),  COUNT(*))                                         AS avg_margin_per_order
FROM with_first_date
GROUP BY client_id, customer_key, currency;


-- 4. Cohort grid ----------------------------------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_cohort_grid` AS
WITH orders AS (
  SELECT
    client_id,
    customer_key,
    order_date,
    order_id,
    revenue,
    gross_profit,
    currency,
    -- Shoptet orders carry no address, so its market is the order currency.
    CASE WHEN platform = 'shoptet' THEN market_currency
         ELSE COALESCE(NULLIF(shipping_country, ''), 'Unknown') END AS market,
    CASE WHEN platform = 'shoptet' THEN 'currency' ELSE 'country' END AS market_kind
  FROM `oneeighty-warehouse.stg.stg_customer_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
    AND customer_key IS NOT NULL
),
first_orders AS (
  SELECT
    client_id,
    customer_key,
    DATE_TRUNC(MIN(order_date), MONTH) AS cohort_month,
    ARRAY_AGG(market      ORDER BY order_date, order_id LIMIT 1)[OFFSET(0)] AS market,
    ARRAY_AGG(market_kind ORDER BY order_date, order_id LIMIT 1)[OFFSET(0)] AS market_kind,
    ARRAY_AGG(currency    ORDER BY order_date, order_id LIMIT 1)[OFFSET(0)] AS currency
  FROM orders
  GROUP BY client_id, customer_key
),
cohort_sizes AS (
  SELECT client_id, cohort_month, market, market_kind, currency,
         COUNT(*) AS cohort_customers
  FROM first_orders
  GROUP BY 1, 2, 3, 4, 5
),
activity AS (
  SELECT
    f.client_id,
    f.cohort_month,
    f.market,
    f.market_kind,
    f.currency,
    DATE_DIFF(DATE_TRUNC(o.order_date, MONTH), f.cohort_month, MONTH) AS month_offset,
    COUNT(DISTINCT o.customer_key) AS active_customers,
    COUNT(DISTINCT o.order_id)     AS orders,
    SUM(o.revenue)                 AS revenue,
    SUM(o.gross_profit)            AS gross_profit
  FROM orders o
  JOIN first_orders f
    ON o.client_id = f.client_id AND o.customer_key = f.customer_key
  GROUP BY 1, 2, 3, 4, 5, 6
)
SELECT
  a.client_id,
  a.cohort_month,
  a.market,
  a.market_kind,
  a.currency,
  a.month_offset,
  s.cohort_customers,
  a.active_customers,
  a.orders,
  a.revenue,
  a.gross_profit,
  DATE_ADD(a.cohort_month, INTERVAL a.month_offset MONTH)
    <= DATE_TRUNC(CURRENT_DATE(), MONTH) AS is_elapsed
FROM activity a
JOIN cohort_sizes s
  ON  a.client_id    = s.client_id
  AND a.cohort_month = s.cohort_month
  AND a.market       = s.market
WHERE a.month_offset >= 0;


-- 5. Payback --------------------------------------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_payback` AS
WITH orders AS (
  SELECT platform, client_id, customer_key, order_date, gross_profit, currency
  FROM `oneeighty-warehouse.stg.stg_customer_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
    AND customer_key IS NOT NULL
),
first_order AS (
  SELECT client_id, customer_key, MIN(order_date) AS first_order_date,
         ANY_VALUE(currency) AS currency
  FROM orders GROUP BY 1, 2
),
per_customer AS (
  SELECT
    f.client_id,
    f.customer_key,
    f.currency,
    f.first_order_date,
    DATE_ADD(f.first_order_date, INTERVAL 30 DAY) < CURRENT_DATE() AS d30_complete,
    DATE_ADD(f.first_order_date, INTERVAL 90 DAY) < CURRENT_DATE() AS d90_complete,
    -- WooCommerce: a customer with no costed order in the window has NULL
    -- gross profit, never 0 (rawbark has no cost data at all). Shopify and
    -- Shoptet keep the live behaviour (an uncosted order adds 0) byte for byte;
    -- that latent zero is logged as a separate item, not changed here.
    IF(LOGICAL_AND(o.platform = 'woocommerce')
         AND COUNTIF(o.order_date <= DATE_ADD(f.first_order_date, INTERVAL 30 DAY)
                     AND o.gross_profit IS NOT NULL) = 0,
       NULL,
       SUM(IF(o.order_date <= DATE_ADD(f.first_order_date, INTERVAL 30 DAY), o.gross_profit, 0))) AS gp_30,
    IF(LOGICAL_AND(o.platform = 'woocommerce')
         AND COUNTIF(o.order_date <= DATE_ADD(f.first_order_date, INTERVAL 90 DAY)
                     AND o.gross_profit IS NOT NULL) = 0,
       NULL,
       SUM(IF(o.order_date <= DATE_ADD(f.first_order_date, INTERVAL 90 DAY), o.gross_profit, 0))) AS gp_90
  FROM first_order f
  JOIN orders o ON o.client_id = f.client_id AND o.customer_key = f.customer_key
  -- customer_key MUST be in this grouping. Without it the CTE groups by cohort
  -- DATE, the outer COUNTIF then counts dates instead of customers, and every
  -- per-customer average is inflated by roughly the number of customers per
  -- day. Manami read 2,607 CZK of 30-day gross profit against a sub-1,000 CZK
  -- AOV before this was caught.
  GROUP BY 1, 2, 3, 4, 5, 6
)
SELECT
  client_id, currency, first_order_date AS cohort_date,
  COUNTIF(d30_complete) AS customers_30d_complete,
  COUNTIF(d90_complete) AS customers_90d_complete,
  SUM(IF(d30_complete, gp_30, NULL)) AS gross_profit_30d,
  SUM(IF(d90_complete, gp_90, NULL)) AS gross_profit_90d,
  SUM(IF(d90_complete, gp_30, NULL)) AS gross_profit_30d_of_90d_cohort
FROM per_customer
GROUP BY 1, 2, 3;


-- 6. Product steps --------------------------------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_product_steps` AS
WITH orders AS (
  SELECT
    platform,
    client_id,
    order_id AS order_key,
    order_date,
    -- Shopify keeps its live identity (customer id first). Shoptet and Woo use
    -- the email key.
    CASE WHEN platform = 'shopify'
         THEN COALESCE(platform_customer_id, LOWER(customer_email))
         ELSE customer_key END AS customer_key
  FROM `oneeighty-warehouse.stg.stg_customer_orders`
),
anchor AS (
  -- The order's product is its highest-revenue line.
  SELECT o.client_id, o.customer_key, o.order_key, o.order_date,
         ARRAY_AGG(i.product_name ORDER BY i.revenue DESC, i.product_name LIMIT 1)[OFFSET(0)] AS product
  FROM orders o
  JOIN `oneeighty-warehouse.stg.stg_customer_order_items` i
    ON  i.platform  = o.platform
    AND i.client_id = o.client_id
    AND i.order_id  = o.order_key
  WHERE o.customer_key IS NOT NULL
    AND i.product_name IS NOT NULL
  GROUP BY 1, 2, 3, 4
)
SELECT client_id, customer_key, order_key, order_date, product,
  ROW_NUMBER() OVER (PARTITION BY client_id, customer_key ORDER BY order_date, order_key) AS step,
  COUNT(*) OVER (PARTITION BY client_id, customer_key) AS lifetime_orders,
  MIN(order_date) OVER (PARTITION BY client_id, customer_key) AS first_order_date
FROM anchor;


-- 7. Customer daily (Shopify + WooCommerce; Shoptet still excluded) -------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_daily` AS
SELECT
  client_id,
  order_date                                                        AS date,
  COUNT(DISTINCT order_id)                                          AS orders,
  COUNTIF(is_returning_customer IS FALSE)                           AS new_customer_orders,
  COUNTIF(is_returning_customer IS TRUE)                            AS returning_customer_orders,
  COUNTIF(is_returning_customer IS NULL)                            AS unknown_orders,
  SUM(revenue)                                                      AS revenue,
  SUM(IF(is_returning_customer IS FALSE, revenue, 0))               AS new_customer_revenue,
  SUM(IF(is_returning_customer IS TRUE,  revenue, 0))               AS returning_customer_revenue,
  SUM(net_sales)                                                    AS net_sales,
  SUM(IF(is_returning_customer IS FALSE, net_sales, 0))             AS new_customer_net_sales,
  SUM(IF(is_returning_customer IS TRUE,  net_sales, 0))             AS returning_customer_net_sales,
  SAFE_DIVIDE(COUNTIF(is_returning_customer IS FALSE),
              COUNT(DISTINCT order_id)) * 100                       AS new_customer_pct,
  SAFE_DIVIDE(SUM(net_sales), COUNT(DISTINCT order_id))             AS aov,
  SAFE_DIVIDE(SUM(IF(is_returning_customer IS FALSE, net_sales, 0)),
              NULLIF(COUNTIF(is_returning_customer IS FALSE), 0))   AS aov_new,
  SAFE_DIVIDE(SUM(IF(is_returning_customer IS TRUE,  net_sales, 0)),
              NULLIF(COUNTIF(is_returning_customer IS TRUE), 0))    AS aov_returning
FROM `oneeighty-warehouse.stg.stg_customer_orders`
WHERE platform IN ('shopify', 'woocommerce')
  AND order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
GROUP BY client_id, order_date;


-- 8. Customer market daily (Shopify + WooCommerce; Shoptet still excluded) ------
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
WHERE platform IN ('shopify', 'woocommerce')
  AND order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
GROUP BY client_id, order_date, shipping_country;


-- 9. Order gaps (24-month window, as live) --------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_order_gaps` AS
WITH all_orders AS (
  SELECT client_id, customer_key, order_date, currency
  FROM `oneeighty-warehouse.stg.stg_customer_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH)
    AND customer_key IS NOT NULL
),
sequenced AS (
  SELECT client_id, currency, customer_key, order_date,
    LAG(order_date) OVER (PARTITION BY client_id, customer_key, currency ORDER BY order_date) AS prev_order_date,
    ROW_NUMBER() OVER (PARTITION BY client_id, customer_key, currency ORDER BY order_date) AS order_seq
  FROM all_orders
)
SELECT client_id, currency,
  DATE_DIFF(order_date, prev_order_date, DAY) AS gap_days,
  order_seq, order_date AS gap_end_date
FROM sequenced
WHERE prev_order_date IS NOT NULL;
