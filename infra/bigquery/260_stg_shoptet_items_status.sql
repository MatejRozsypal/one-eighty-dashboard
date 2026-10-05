-- =============================================================================
-- 260_stg_shoptet_items_status.sql
-- Purpose: item-level status parity with the order level. stg.stg_shoptet_order_items
--   filtered cancelled orders by exact match on ('storno','cancelled','zrušeno'), which
--   never matches Shoptet's real status 'Stornována'. stg.stg_shoptet_orders already
--   uses NOT LIKE '%storno%'. Result: 128 cancelled Manami orders (227 lines, about
--   130k CZK) sat in the item-level views.
-- Change: status filter only, now identical to stg_shoptet_orders:
--   LOWER(statusName) NOT LIKE '%storno%' AND LOWER(statusName) NOT IN ('cancelled','zrušeno').
-- Based on: infra/bigquery/live/stg.stg_shoptet_order_items.sql (live 2026-10-05,
--   md5 of the definition e1a2e2ef9293b0f4974dfca1c3bfd858).
-- Affected clients: manami (the only Shoptet client). It moves item-level numbers
--   people know: mart_product_perf, mart_sku_perf, mart_unit_economics (Products, SKU,
--   Unit economics pages) and the Repurchase item marts. stg_shoptet_orders,
--   stg_customer_orders and all customer and KPI marts are unchanged (0 and 0).
-- Regression: qa/260_regression.sql (design 2.5, WR2). Results recorded there.
-- Deploy order: after 259 (separately approved). Rollback: previous live text in
--   scratchpad/rollback (stg.stg_shoptet_order_items.pre260.sql).
-- Design ref: retention design 2.4 (renumbered from 258).
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shoptet_order_items` AS
WITH base AS (
  SELECT * EXCEPT(rn),
    IF(COALESCE(itemTotalPurchasePriceCZK, 0) = 0 AND itemTotalPriceWithVatCZK > 0,
       ROUND(itemTotalPriceWithVatCZK / 1.21 * 0.35, 2), NULL) AS imputed_cost_czk
  FROM (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY client_id, itemKey ORDER BY ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_shoptet_order_items`
    WHERE orderDate >= '2020-01-01'
  )
  WHERE rn = 1
    -- Same rule as stg.stg_shoptet_orders: substring match on 'storno', because the
    -- real Shoptet status is 'Stornována' and an exact list never fired. 128 cancelled
    -- orders (227 lines) leaked into the item-level views.
    AND LOWER(statusName) NOT LIKE '%storno%'
    AND LOWER(statusName) NOT IN ('cancelled', 'zrušeno')
)
SELECT
  client_id,
  itemKey AS item_key,
  orderCode AS order_code,
  orderDate AS order_date,
  statusName AS status,
  email,
  currency,
  exchangeRate AS exchange_rate,
  itemName AS item_name,
  itemCode AS item_code,
  itemVariantName AS variant,
  itemManufacturer AS manufacturer,
  itemEan AS ean,
  itemAmount AS quantity,
  itemTotalPriceWithVat AS revenue,
  itemTotalPriceWithVatCZK AS revenue_czk,
  IF(imputed_cost_czk IS NULL, itemTotalPurchasePrice,
     imputed_cost_czk / IF(currency = 'CZK', NUMERIC '1', exchangeRate)) AS cost,
  COALESCE(imputed_cost_czk, itemTotalPurchasePriceCZK) AS cost_czk,
  IF(imputed_cost_czk IS NULL, itemMargin,
     itemMargin - imputed_cost_czk / IF(currency = 'CZK', NUMERIC '1', exchangeRate)) AS margin,
  IF(imputed_cost_czk IS NULL, itemMarginCZK, itemMarginCZK - imputed_cost_czk) AS margin_czk,
  IF(imputed_cost_czk IS NULL, itemMarginPercent,
     ROUND(SAFE_DIVIDE(itemMarginCZK - imputed_cost_czk, itemTotalPriceWithVatCZK) * 100, 2)) AS margin_pct,
  itemDiscountPercent AS discount_pct,
  sourceName AS source,
  ingested_at,
  itemTotalPurchasePriceCZK AS cost_czk_raw,
  imputed_cost_czk IS NOT NULL AS cost_is_imputed
FROM base;
