-- 217_venev_sku_normalisation.sql
-- =============================================================================
-- Folds Venev's two SKU spellings together so historical orders find their cost.
--
-- Venev renumbered its SKUs during 2023 by appending 'A'. The live catalogue
-- holds only the new form ('102A'), while every 2022 and 2023 order line carries
-- the old one ('102'). The join in stg_shopify_order_items matched on the SKU as
-- written, so those lines found no product row, took a NULL cost, and were
-- silently dropped from COGS.
--
-- The damage was concentrated exactly where it hurts: SKU 102 alone is 36.6% of
-- Venev's lifetime revenue, and it is the old spelling that dominates its two
-- best years. COGS coverage sat at 50.7% of revenue and 2022 reported a **99.9%
-- CM1** -- EUR 62,672 of revenue against EUR 85 of cost. Nothing errored; the
-- dashboard would simply have shown a wildly profitable first year.
--
-- After the fix: coverage 88.9%, and CM1 lands at 68-80% across the years. That
-- reconciles independently with the client's own price list, whose COGS margins
-- run 15-27% of the ex-VAT price, i.e. a 73-85% gross margin.
--
-- The rule is scoped to `venev`. Stripping a trailing letter globally would risk
-- merging genuinely distinct SKUs in another shop's numbering; Dobias keeps its
-- own existing rule (its catalogue prefixes 'DD-' where its order lines do not),
-- and its coverage is unchanged at 96.5%.
--
-- The remaining 11.1% is bundles -- 'SET pack' (104/104A), 'VENEV pack'
-- (105/105A) and three no-SKU bundle lines. Their cost cannot be derived without
-- knowing what they contain, so they carry NULL, not zero, and are excluded from
-- margin rather than counted as free goods.
--
-- Supersedes the stg_shopify_order_items statement in 216.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shopify_order_items` AS
WITH prod AS (
  SELECT client_id,
    CASE WHEN client_id = 'venev'
         THEN REGEXP_REPLACE(TRIM(UPPER(sku)), r'A$', '')
         ELSE TRIM(UPPER(REGEXP_REPLACE(sku, r'^DD-', ''))) END AS norm_sku,
    MAX(cost)        AS cost,
    ANY_VALUE(title) AS product_title
  FROM `oneeighty-warehouse.stg.stg_shopify_products`
  WHERE sku IS NOT NULL AND sku != ''
  GROUP BY client_id, norm_sku
)
SELECT
  o.client_id, o.order_id, o.order_date,
  o.currency_original, o.currency, o.fx_rate, o.net_factor, o.store_origin,
  JSON_VALUE(li, '$.sku')                                            AS sku,
  COALESCE(prod.product_title, JSON_VALUE(li, '$.title'), 'Unknown')  AS item_name,
  JSON_VALUE(li, '$.title')                                          AS line_item_title,
  CASE
    WHEN o.client_id = 'dobias' AND REGEXP_CONTAINS(
      COALESCE(prod.product_title, JSON_VALUE(li, '$.title'), ''), r' H\+'
    ) THEN 'human'
    WHEN o.client_id = 'dobias' THEN 'canine'
    ELSE NULL
  END                                                                AS product_line,
  CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC)                      AS quantity,
  CAST(JSON_VALUE(li, '$.price') AS NUMERIC)                         AS unit_price_original,
  COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0)    AS line_discount_original,
  CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC) * CAST(JSON_VALUE(li, '$.price') AS NUMERIC)
    - COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0)  AS revenue_original,
  CAST(JSON_VALUE(li, '$.price') AS NUMERIC) * o.fx_rate * o.net_factor AS unit_price,
  COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0) * o.fx_rate * o.net_factor AS line_discount,
  (CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC) * CAST(JSON_VALUE(li, '$.price') AS NUMERIC)
    - COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0)) * o.fx_rate * o.net_factor AS revenue,
  prod.cost                                                          AS unit_cost,
  CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC) * prod.cost           AS line_cost,
  (CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC) * CAST(JSON_VALUE(li, '$.price') AS NUMERIC)
    - COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0)) * o.fx_rate * o.net_factor
    - CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC) * prod.cost      AS margin
FROM `oneeighty-warehouse.stg.stg_shopify_orders` o,
  UNNEST(JSON_QUERY_ARRAY(o.line_items)) AS li
LEFT JOIN prod
  ON prod.client_id = o.client_id
  AND JSON_VALUE(li, '$.sku') IS NOT NULL AND JSON_VALUE(li, '$.sku') != ''
  AND prod.norm_sku = CASE WHEN o.client_id = 'venev'
        THEN REGEXP_REPLACE(TRIM(UPPER(JSON_VALUE(li, '$.sku'))), r'A$', '')
        ELSE TRIM(UPPER(REGEXP_REPLACE(JSON_VALUE(li, '$.sku'), r'^DD-', ''))) END;
