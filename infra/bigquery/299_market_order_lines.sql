-- =============================================================================
-- 299_market_order_lines.sql
-- Markets > Products: order x product lines with market, for the dashboard.
--
-- Why: /markets/products read stg.stg_customer_order_items and the platform
-- line tables directly, and the dashboard's reader (sa-frontend-reader) has
-- no access to stg (it holds customer emails). This table carries only what
-- the page needs, no customer data, and is rebuilt by the daily Markets
-- refresh (mart.sp_refresh_markets, scheduled query markets_refresh_daily).
--
-- Rule (same as the page's former query): an order's net sales (ex VAT, base
-- currency, from mart.market_orders) are spread over its products by line
-- revenue, so a market's products add up to its net sales on /markets.
-- Units come from the client's platform line table (the shared line view has
-- no quantity), keyed the way stg_customer_order_items keys a product.
--
-- Creates
--   1. mart.sp_refresh_market_order_lines()  builds mart.market_order_lines
--   2. mart.sp_refresh_markets()             now also calls (1) after 290
-- =============================================================================

CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_market_order_lines`()
OPTIONS (description = 'Rebuilds mart.market_order_lines (client x order x product: market, order date, allocated net sales in base currency, units, local currency and fx) from mart.market_orders and the stg line tables. Checks: rows > 0, allocated net sales equal market_orders net sales within 1 unit per client for orders that have lines. Migration 299.')
BEGIN
  DECLARE new_rows INT64;
  DECLARE max_gap FLOAT64;

  SET @@query_label = 'feature:markets-refresh';

  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.market_order_lines__next`
  PARTITION BY DATE_TRUNC(order_date, MONTH)
  CLUSTER BY client_id, market
  OPTIONS (description = 'Staging copy for mart.sp_refresh_market_order_lines. Not for reading.')
  AS
  WITH
  o AS (
    SELECT client_id, order_id, order_date, market, net_sales, currency_local, fx_local_to_base
    FROM `oneeighty-warehouse.mart.market_orders`
  ),
  li AS (
    SELECT client_id, order_id, product_key,
      ANY_VALUE(COALESCE(NULLIF(TRIM(product_name), ''), NULLIF(TRIM(item_name), ''), 'Unnamed')) AS product,
      SUM(revenue) AS rev
    FROM `oneeighty-warehouse.stg.stg_customer_order_items`
    GROUP BY client_id, order_id, product_key
  ),
  u AS (
    SELECT client_id, order_id, item_name AS product_key, SUM(quantity) AS qty
    FROM `oneeighty-warehouse.stg.stg_shopify_order_items` GROUP BY 1, 2, 3
    UNION ALL
    SELECT client_id, order_code, COALESCE(NULLIF(item_code, ''), item_name), SUM(quantity)
    FROM `oneeighty-warehouse.stg.stg_shoptet_order_items` GROUP BY 1, 2, 3
    UNION ALL
    SELECT client_id, order_id, COALESCE(NULLIF(sku, ''), NULLIF(NULLIF(product_id, ''), '0'), item_name), SUM(quantity)
    FROM `oneeighty-warehouse.stg.stg_woo_order_items` GROUP BY 1, 2, 3
  ),
  ot AS (
    SELECT client_id, order_id, SUM(rev) AS order_rev FROM li GROUP BY client_id, order_id
  )
  SELECT
    o.client_id,
    o.order_id,
    o.order_date,
    o.market,
    li.product_key,
    li.product,
    CAST(o.net_sales * SAFE_DIVIDE(li.rev, ot.order_rev) AS NUMERIC) AS net_sales,
    u.qty AS units,
    o.currency_local,
    o.fx_local_to_base
  FROM o
  JOIN li USING (client_id, order_id)
  JOIN ot USING (client_id, order_id)
  LEFT JOIN u USING (client_id, order_id, product_key);

  SET new_rows = (SELECT COUNT(*) FROM `oneeighty-warehouse.mart.market_order_lines__next`);
  SET max_gap = (
    WITH a AS (
      SELECT client_id, SUM(net_sales) AS v FROM `oneeighty-warehouse.mart.market_order_lines__next` GROUP BY 1
    ),
    b AS (
      SELECT o.client_id, SUM(o.net_sales) AS v
      FROM `oneeighty-warehouse.mart.market_orders` o
      WHERE EXISTS (
        SELECT 1 FROM `oneeighty-warehouse.mart.market_order_lines__next` l
        WHERE l.client_id = o.client_id AND l.order_id = o.order_id)
      GROUP BY 1
    )
    SELECT MAX(ABS(CAST(IFNULL(a.v, 0) - IFNULL(b.v, 0) AS FLOAT64))) FROM a FULL JOIN b USING (client_id)
  );

  ASSERT new_rows > 0 AS 'market_order_lines: new build is empty';
  ASSERT max_gap < 1 AS 'market_order_lines: allocated net sales differ from market_orders';

  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.market_order_lines`
  COPY `oneeighty-warehouse.mart.market_order_lines__next`;
  ALTER TABLE `oneeighty-warehouse.mart.market_order_lines`
  SET OPTIONS (description = 'Markets > Products: client x order x product with market, allocated net sales (base currency, ex VAT), units, local currency + fx. No customer data. Built by mart.sp_refresh_market_order_lines (migration 299).');
  DROP TABLE `oneeighty-warehouse.mart.market_order_lines__next`;
END;

CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_markets`()
OPTIONS (description = 'Refreshes every Markets object in dependency order: market_orders (290), market_order_lines (299), market_spend_daily (291), market_daily (292), market_cohorts (293), market_forecast (294). Each step builds beside the live table and swaps only after its checks pass, so a failure leaves the previous version readable. Migrations 294, 299.')
BEGIN
  CALL `oneeighty-warehouse.mart.sp_refresh_market_orders`();
  CALL `oneeighty-warehouse.mart.sp_refresh_market_order_lines`();
  CALL `oneeighty-warehouse.mart.sp_refresh_market_spend`();
  CALL `oneeighty-warehouse.mart.sp_refresh_market_daily`();
  CALL `oneeighty-warehouse.mart.sp_refresh_market_cohorts`();
  CALL `oneeighty-warehouse.mart.sp_refresh_market_forecast`();
END;

CALL `oneeighty-warehouse.mart.sp_refresh_market_order_lines`();
