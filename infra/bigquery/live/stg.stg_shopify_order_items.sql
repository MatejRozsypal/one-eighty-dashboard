CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shopify_order_items` AS
WITH prod AS (
  SELECT client_id,
    -- SKU normalisation, per client. Dobias's catalogue carries a 'DD-' prefix
    -- that its order lines omit. Venev renumbered its SKUs by appending 'A' at
    -- some point in 2023: the catalogue holds only '102A', while every 2022-23
    -- order line says '102'. Without folding the two together, 36.6% of Venev's
    -- revenue -- its best-selling product across its two best years -- matches no
    -- product row and silently carries no cost, which showed up as a 99.9% CM1
    -- for 2022. Scoped by client so one shop's numbering quirk cannot merge
    -- another's genuinely distinct SKUs.
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
