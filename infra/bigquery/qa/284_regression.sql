-- =============================================================================
-- qa/284_regression.sql
-- Regression for 284_shoptet_market_country.sql.
--
-- Before deploy: run as is, it compares live (stg / mart) with the QA copies
-- (mart_qa.mm1_*). After deploy: the QA copies equal live, so c1 to c4 still
-- read 0 and c5 to c8 are the live numbers.
--
-- Expected (2026-10-15):
--   c1 to c5, c7, c8 = 0.
--   c6 = 6: CZK orders delivered to an SK pickup point (Bratislava, Trencin,
--   Martin, Aug to Sep 2025). Informational: these are SK by delivery
--   location, which is what "shipping country first" means. A sudden jump
--   would mean the postcode parse broke, look at the rows then.
--   Manami last 12 months: 2,244 orders, CZ 1,896 (1,761 pickup postcode,
--   135 currency), SK 348 (318 pickup postcode, 30 currency), 0 NULL.
-- =============================================================================

WITH
c1 AS (  -- original stg_shoptet_orders columns unchanged (both directions)
  SELECT 'c1_stg_shoptet_orig_cols_diff' AS check_name, COUNT(*) AS bad FROM (
    (SELECT * FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
     EXCEPT DISTINCT
     SELECT * EXCEPT(delivery_country_name, pickup_postcode, shipping_country, country_source, storefront_domain)
     FROM `oneeighty-warehouse.mart_qa.mm1_stg_shoptet_orders`)
    UNION ALL
    (SELECT * EXCEPT(delivery_country_name, pickup_postcode, shipping_country, country_source, storefront_domain)
     FROM `oneeighty-warehouse.mart_qa.mm1_stg_shoptet_orders`
     EXCEPT DISTINCT
     SELECT * FROM `oneeighty-warehouse.stg.stg_shoptet_orders`))
),
c2 AS (  -- stg_customer_orders: every row and column equal except Shoptet shipping_country
  SELECT 'c2_stg_customer_orders_diff' AS check_name, COUNT(*) AS bad FROM (
    (SELECT platform, client_id, order_id, order_date, currency, market_currency, platform_customer_id, customer_email,
            customer_key, is_returning_customer, revenue, net_sales, shipping, cogs, gross_profit,
            IF(platform = 'shoptet', NULL, shipping_country) AS sc
     FROM `oneeighty-warehouse.stg.stg_customer_orders`
     EXCEPT DISTINCT
     SELECT platform, client_id, order_id, order_date, currency, market_currency, platform_customer_id, customer_email,
            customer_key, is_returning_customer, revenue, net_sales, shipping, cogs, gross_profit,
            IF(platform = 'shoptet', NULL, shipping_country)
     FROM `oneeighty-warehouse.mart_qa.mm1_stg_customer_orders`)
    UNION ALL
    (SELECT platform, client_id, order_id, order_date, currency, market_currency, platform_customer_id, customer_email,
            customer_key, is_returning_customer, revenue, net_sales, shipping, cogs, gross_profit,
            IF(platform = 'shoptet', NULL, shipping_country)
     FROM `oneeighty-warehouse.mart_qa.mm1_stg_customer_orders`
     EXCEPT DISTINCT
     SELECT platform, client_id, order_id, order_date, currency, market_currency, platform_customer_id, customer_email,
            customer_key, is_returning_customer, revenue, net_sales, shipping, cogs, gross_profit,
            IF(platform = 'shoptet', NULL, shipping_country)
     FROM `oneeighty-warehouse.stg.stg_customer_orders`))
),
c3 AS (  -- row counts equal
  SELECT 'c3_row_count_delta' AS check_name,
    ABS((SELECT COUNT(*) FROM `oneeighty-warehouse.stg.stg_customer_orders`)
      - (SELECT COUNT(*) FROM `oneeighty-warehouse.mart_qa.mm1_stg_customer_orders`)) AS bad
),
c4 AS (  -- Shopify / Woo market rows unchanged in the mart
  SELECT 'c4_market_daily_shopify_woo_diff' AS check_name, COUNT(*) AS bad FROM (
    (SELECT * FROM `oneeighty-warehouse.mart.mart_customer_market_daily`
     EXCEPT DISTINCT SELECT * FROM `oneeighty-warehouse.mart_qa.mm1_mart_customer_market_daily`
       WHERE client_id NOT IN (SELECT DISTINCT client_id FROM `oneeighty-warehouse.stg.stg_shoptet_orders`))
    UNION ALL
    (SELECT * FROM `oneeighty-warehouse.mart_qa.mm1_mart_customer_market_daily`
       WHERE client_id NOT IN (SELECT DISTINCT client_id FROM `oneeighty-warehouse.stg.stg_shoptet_orders`)
     EXCEPT DISTINCT SELECT * FROM `oneeighty-warehouse.mart.mart_customer_market_daily`))
),
c5 AS (  -- Manami last 12 months: NULL market (target < 2 %)
  SELECT 'c5_manami_12m_null_market' AS check_name, COUNTIF(shipping_country IS NULL) AS bad
  FROM `oneeighty-warehouse.mart_qa.mm1_stg_shoptet_orders`
  WHERE client_id = 'manami' AND order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
),
c6 AS (  -- informational: pickup postcode country differs from currency country
  SELECT 'c6_postcode_vs_currency_conflict_info' AS check_name,
    COUNTIF(country_source = 'pickup_postcode'
            AND shipping_country != CASE currency WHEN 'CZK' THEN 'CZ' WHEN 'EUR' THEN 'SK' END) AS bad
  FROM `oneeighty-warehouse.mart_qa.mm1_stg_shoptet_orders`
),
c7 AS (  -- delivery country names present but not mapped (extend the CASE in 284)
  SELECT 'c7_unmapped_delivery_country_name' AS check_name,
    COUNTIF(delivery_country_name IS NOT NULL AND country_source != 'delivery_country') AS bad
  FROM `oneeighty-warehouse.mart_qa.mm1_stg_shoptet_orders`
),
c8 AS (  -- Shoptet in the mart reconciles to stg (orders and revenue, 60 months)
  SELECT 'c8_market_daily_shoptet_vs_stg' AS check_name,
    ABS((SELECT SUM(orders) FROM `oneeighty-warehouse.mart_qa.mm1_mart_customer_market_daily` WHERE client_id = 'manami')
      - (SELECT COUNT(DISTINCT order_id) FROM `oneeighty-warehouse.mart_qa.mm1_stg_customer_orders`
         WHERE client_id = 'manami' AND order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)))
  + CAST(ABS((SELECT SUM(revenue) FROM `oneeighty-warehouse.mart_qa.mm1_mart_customer_market_daily` WHERE client_id = 'manami')
      - (SELECT SUM(revenue) FROM `oneeighty-warehouse.mart_qa.mm1_stg_customer_orders`
         WHERE client_id = 'manami' AND order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH))) AS INT64) AS bad
)
SELECT * FROM c1 UNION ALL SELECT * FROM c2 UNION ALL SELECT * FROM c3 UNION ALL SELECT * FROM c4
UNION ALL SELECT * FROM c5 UNION ALL SELECT * FROM c6 UNION ALL SELECT * FROM c7 UNION ALL SELECT * FROM c8
ORDER BY check_name;

-- Manami market split, last 12 months (the QA table mart_qa.mm1_manami_market_12m)
SELECT * FROM `oneeighty-warehouse.mart_qa.mm1_manami_market_12m` ORDER BY orders DESC;
