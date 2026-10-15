-- =============================================================================
-- 292_mk_market_daily.sql
-- Markets page (v1a, F2): one row per client x day x market with the additive
-- sums the period metrics are built from (P&L matrix, map, leaderboard).
-- Contract: docs/sessions/2026-10-15/markets/CONTRACT.md (mart_qa.mk_market_daily).
--
-- Creates
--   mart.sp_refresh_market_daily()   rebuilds mart.market_daily
--   mart.market_daily                snapshot table (CALL at the end)
--
-- Grain: client_id, date, market. Orders side from mart.market_orders (290),
--   spend side from mart.market_spend_daily (291), FULL JOIN, so a market with
--   spend and no orders (and market 'UNALLOCATED', spend only) has a row.
--   Only sums and counts are stored; ratios (AOV, discount rate, nCAC, MER,
--   aMER, COGS %, first-order GP, GP after ads) are derived in the query layer
--   from these sums over the picked period, never averaged across days.
--
-- NULL rules (never 0 for "not available")
--   gross_sales, discounts, shipping_charged: NULL when no order of the day
--     carries the amount (Shoptet / Manami).
--   refunds: NULL when no order carries it (Dobias, Manami).
--   cogs, gross_profit: sums over costed orders only (as mart_daily_kpis);
--     costed_orders / costed_net_sales say how much is covered, so
--     COGS % = cogs / costed_net_sales. NULL when no order is costed (RawBark).
--   spend_base: 0 when the market had no spend that day but the client has
--     spend data that day, NULL when no spend row exists for the client
--     (before the ad account history starts, I7).
--
-- Additive columns beyond CONTRACT.md (flagged in DATA-BUILD.md):
--   new_customer_net_sales, returning_net_sales (AOV new / returning on net
--   sales, as the audit), new_customer_gross_profit, new_customer_costed_orders
--   (first-order GP per new customer), costed_net_sales (COGS %),
--   meta_spend, google_spend (platform split without a second query).
--
-- Depends on 290, 291. Refresh: mart.sp_refresh_markets() (294).
-- QA copy: infra/bigquery/qa/292_mk_market_daily_qa.sql.
-- =============================================================================

CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_market_daily`()
OPTIONS (description = 'Rebuilds mart.market_daily (client x day x market sums: orders, new and returning, revenue waterfall, COGS / GP on costed orders, discount / COD / zero-shipping counts, paid spend) from mart.market_orders and mart.market_spend_daily. Checks: rows > 0, unique key, order and spend totals equal the source tables. Migration 292. Called by mart.sp_refresh_markets (294).')
BEGIN
  DECLARE new_rows INT64;
  DECLARE dup_rows INT64;
  DECLARE order_gap INT64;
  DECLARE spend_gap FLOAT64;

  SET @@query_label = 'feature:markets-refresh';

  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.market_daily__next`
  CLUSTER BY client_id, market, date
  OPTIONS (description = 'Staging copy for mart.sp_refresh_market_daily. Not for reading.')
  AS
  WITH
  o AS (
    SELECT
      client_id, order_date AS date, market,
      COUNT(*)                                                        AS orders,
      COUNTIF(is_new_customer)                                        AS new_customers,
      COUNTIF(is_new_customer IS FALSE)                               AS returning_orders,
      SUM(gross_sales)                                                AS gross_sales,
      SUM(discounts)                                                  AS discounts,
      SUM(refunds)                                                    AS refunds,
      SUM(net_sales)                                                  AS net_sales,
      SUM(net_revenue)                                                AS net_revenue,
      SUM(IF(is_new_customer, net_revenue, 0))                        AS new_customer_revenue,
      SUM(IF(is_new_customer IS FALSE, net_revenue, 0))               AS returning_revenue,
      SUM(IF(is_new_customer, net_sales, 0))                          AS new_customer_net_sales,
      SUM(IF(is_new_customer IS FALSE, net_sales, 0))                 AS returning_net_sales,
      SUM(cogs)                                                       AS cogs,
      SUM(IF(cogs IS NOT NULL, gross_profit, NULL))                   AS gross_profit,
      COUNTIF(cogs IS NOT NULL)                                       AS costed_orders,
      SUM(IF(cogs IS NOT NULL, net_sales, NULL))                      AS costed_net_sales,
      SUM(IF(is_new_customer AND cogs IS NOT NULL, gross_profit, NULL)) AS new_customer_gross_profit,
      COUNTIF(is_new_customer AND cogs IS NOT NULL)                   AS new_customer_costed_orders,
      COUNTIF(is_discounted)                                          AS discounted_orders,
      COUNTIF(is_cod)                                                 AS cod_orders,
      COUNTIF(is_zero_shipping)                                       AS zero_shipping_orders,
      SUM(shipping_charged)                                           AS shipping_charged
    FROM `oneeighty-warehouse.mart.market_orders`
    GROUP BY client_id, order_date, market
  ),
  s AS (
    SELECT client_id, date, market,
      SUM(spend_base)                       AS spend_base,
      SUM(IF(platform = 'meta', spend_base, 0))   AS meta_spend,
      SUM(IF(platform = 'google', spend_base, 0)) AS google_spend
    FROM `oneeighty-warehouse.mart.market_spend_daily`
    GROUP BY client_id, date, market
  ),
  spend_days AS (        -- days on which the client has any spend row at all
    SELECT DISTINCT client_id, date FROM `oneeighty-warehouse.mart.market_spend_daily`
  )
  SELECT
    COALESCE(o.client_id, s.client_id) AS client_id,
    COALESCE(o.date, s.date)           AS date,
    COALESCE(o.market, s.market)       AS market,
    IFNULL(o.orders, 0)                AS orders,
    IFNULL(o.new_customers, 0)         AS new_customers,
    IFNULL(o.returning_orders, 0)      AS returning_orders,
    o.gross_sales,
    o.discounts,
    o.refunds,
    o.net_sales,
    o.net_revenue,
    o.new_customer_revenue,
    o.returning_revenue,
    o.cogs,
    o.gross_profit,
    IFNULL(o.costed_orders, 0)         AS costed_orders,
    IFNULL(o.discounted_orders, 0)     AS discounted_orders,
    IFNULL(o.cod_orders, 0)            AS cod_orders,
    IFNULL(o.zero_shipping_orders, 0)  AS zero_shipping_orders,
    o.shipping_charged,
    CASE
      WHEN s.spend_base IS NOT NULL THEN s.spend_base
      WHEN sd.client_id IS NOT NULL THEN NUMERIC '0'
    END                                AS spend_base,
    o.new_customer_net_sales,
    o.returning_net_sales,
    o.new_customer_gross_profit,
    IFNULL(o.new_customer_costed_orders, 0) AS new_customer_costed_orders,
    o.costed_net_sales,
    CASE WHEN s.spend_base IS NOT NULL THEN s.meta_spend
         WHEN sd.client_id IS NOT NULL THEN NUMERIC '0' END   AS meta_spend,
    CASE WHEN s.spend_base IS NOT NULL THEN s.google_spend
         WHEN sd.client_id IS NOT NULL THEN NUMERIC '0' END   AS google_spend
  FROM o
  FULL JOIN s
    ON s.client_id = o.client_id AND s.date = o.date AND s.market = o.market
  LEFT JOIN spend_days sd
    ON sd.client_id = COALESCE(o.client_id, s.client_id) AND sd.date = COALESCE(o.date, s.date);

  SET new_rows = (SELECT COUNT(*) FROM `oneeighty-warehouse.mart.market_daily__next`);
  SET dup_rows = (
    SELECT COUNT(*) - COUNT(DISTINCT FORMAT('%s|%t|%s', client_id, date, market))
    FROM `oneeighty-warehouse.mart.market_daily__next`);
  SET order_gap = (
    SELECT ABS((SELECT SUM(orders) FROM `oneeighty-warehouse.mart.market_daily__next`)
             - (SELECT COUNT(*) FROM `oneeighty-warehouse.mart.market_orders`)));
  SET spend_gap = (
    SELECT ABS(CAST((SELECT IFNULL(SUM(spend_base), 0) FROM `oneeighty-warehouse.mart.market_daily__next`)
                  - (SELECT IFNULL(SUM(spend_base), 0) FROM `oneeighty-warehouse.mart.market_spend_daily`) AS FLOAT64)));

  ASSERT new_rows > 0 AS 'market_daily: new build is empty';
  ASSERT dup_rows = 0 AS 'market_daily: duplicate client_id + date + market';
  ASSERT order_gap = 0 AS 'market_daily: order count differs from market_orders';
  ASSERT spend_gap < 1 AS 'market_daily: spend differs from market_spend_daily';

  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.market_daily`
  COPY `oneeighty-warehouse.mart.market_daily__next`;
  ALTER TABLE `oneeighty-warehouse.mart.market_daily`
  SET OPTIONS (description = 'Markets: client x day x market additive sums (orders, new / returning, revenue waterfall, COGS / GP on costed orders, discount, COD and zero-shipping counts, paid spend incl. market UNALLOCATED). Ratios are derived per period in the query layer. Built by mart.sp_refresh_market_daily (migration 292).');
  DROP TABLE `oneeighty-warehouse.mart.market_daily__next`;
END;

CALL `oneeighty-warehouse.mart.sp_refresh_market_daily`();
