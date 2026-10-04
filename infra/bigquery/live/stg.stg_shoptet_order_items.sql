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
    AND LOWER(statusName) NOT IN ('storno', 'cancelled', 'zrušeno')
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
