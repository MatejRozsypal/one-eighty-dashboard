-- 216_shopify_tax_inclusive.sql
-- =============================================================================
-- Takes VAT out of revenue for shops that price tax-inclusive.
--
-- THE PROBLEM
--
-- PROJECT_LOG defines revenue as "net sales + shipping -- what the customer pays
-- us, ex-tax", and the marts implement it as `subtotal_price + total_shipping`.
-- That is only ex-tax if the shop adds tax on top of its prices.
--
--   Dobias (US):  subtotal + shipping = 33,288,512, total_price = 34,438,285.
--                 Tax sits OUTSIDE subtotal. Revenue is ex-tax. Correct.
--   Venev  (CZ):  subtotal + shipping = 162,873, total_price = 162,872.
--                 Identical -- tax is INSIDE subtotal. Revenue includes VAT.
--
-- Confirmed at the source rather than inferred: the Shopify Admin API reports
-- `shop.taxesIncluded = true` for Venev. So EUR 16,175 of its EUR 162,872 of
-- reported revenue is VAT it collected on the state's behalf, and gross margin
-- and CM1 are overstated on top of that, because COGS is recorded ex-VAT and was
-- being subtracted from a VAT-inclusive figure.
--
-- Manami has the same condition and is NOT fixed here: Shoptet does not break
-- tax out in its payload, so there is nothing to subtract. That limitation is
-- already recorded in the brief; this migration does not make it worse.
--
-- THE DEFLATOR
--
-- Shopify reports one `total_tax` covering both goods and shipping (Venev has
-- `taxShipping = true`). Splitting it per component is unnecessary, because when
-- the same rate applies to both, the ex-tax share is identical for each:
--
--     tax_on_subtotal / subtotal  ==  total_tax / (subtotal + shipping)
--
-- so a single factor deflates everything consistently:
--
--     net_factor = 1 - total_tax / (subtotal + shipping)
--
-- For Venev this averages ~0.90, i.e. an effective 11% rather than the headline
-- 21%. That is expected, not a bug: cross-border EU sales and B2B reverse-charge
-- orders carry little or no Czech VAT, and the factor is computed per order from
-- the tax actually recorded rather than from an assumed rate.
--
-- WHERE IT IS APPLIED
--
-- To `subtotal_price` and `total_shipping` in stg, so all twelve mart views that
-- read them become correct without being edited -- the same single-point
-- reasoning as migration 215. The audit columns keep the gross figures:
--
--     subtotal_price_original / total_shipping_original   as Shopify reported
--     total_price / total_tax                             unchanged, gross
--     mart's gross_revenue_incl_tax and tax_collected     therefore unchanged
--
-- Line-item economics get the same factor. Line prices in the JSON are
-- VAT-inclusive for a tax-inclusive shop, while `unit_cost` comes from the
-- product catalogue and is ex-VAT, so leaving lines gross would overstate margin
-- exactly where the mart claims to measure it.
--
-- Dobias is untouched: taxes_included = FALSE gives net_factor = 1.
-- =============================================================================

ALTER TABLE `oneeighty-warehouse.ref.clients`
  ADD COLUMN IF NOT EXISTS taxes_included BOOL
    OPTIONS (description = "TRUE when the shop's displayed prices already contain tax (Shopify shop.taxesIncluded). Determines whether revenue must be deflated to reach the ex-tax definition. NULL is treated as FALSE.");

-- venev  TRUE  -- Shopify Admin API shop.taxesIncluded, checked 2026-08-03
-- dobias FALSE -- US store, tax added at checkout; subtotal+shipping < total_price
-- manami TRUE  -- Czech prices include VAT, but Shoptet exposes no tax field to
--                 subtract, so nothing downstream can act on it yet
UPDATE `oneeighty-warehouse.ref.clients`
SET taxes_included = CASE client_id
                       WHEN 'venev'  THEN TRUE
                       WHEN 'dobias' THEN FALSE
                       WHEN 'manami' THEN TRUE
                     END,
    updated_at     = CURRENT_TIMESTAMP()
WHERE client_id IN ('manami', 'dobias', 'venev');

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shopify_orders` AS
WITH client_ccy AS (
  SELECT client_id,
         currency AS client_currency,
         COALESCE(taxes_included, FALSE) AS taxes_included
  FROM `oneeighty-warehouse.ref.clients`
),
deduped AS (
  SELECT * EXCEPT(rn, is_returning_customer, order_date)
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, order_id ORDER BY ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_shopify_orders`
    WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
      AND cancelled_at IS NULL
  ) WHERE rn = 1
),
joined AS (
  SELECT
    d.*,
    c.client_currency,
    DATE(d.processed_at) AS order_date_raw_processed,
    IF(d.currency = c.client_currency, CAST(1.0 AS NUMERIC), fx.rate) AS fx_rate,
    -- 1 for a tax-exclusive shop, and for any order with no tax recorded.
    -- COALESCE keeps a NULL tax from wiping out the whole order's revenue.
    IF(c.taxes_included,
       1 - COALESCE(SAFE_DIVIDE(d.total_tax, d.subtotal_price + COALESCE(d.total_shipping, 0)), 0),
       CAST(1.0 AS NUMERIC)) AS net_factor
  FROM deduped d
  JOIN client_ccy c
    ON c.client_id = d.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
    ON  fx.from_currency = d.currency
    AND fx.to_currency   = c.client_currency
    AND fx.month_start   = DATE_TRUNC(DATE(d.processed_at), MONTH)
)
SELECT
  client_id, ingested_at, ingest_source, order_id, order_number,
  order_date_raw_processed AS order_date,
  DATE(created_at)         AS order_created_date,
  created_at, updated_at, processed_at,
  currency        AS currency_original,
  client_currency AS currency,
  fx_rate,
  net_factor,
  CASE WHEN source_name = 'Matrixify App' THEN 'canada_migrated' ELSE 'us_native' END AS store_origin,
  presentment_currency,
  -- Audit columns: exactly what Shopify reported, gross of tax.
  subtotal_price  AS subtotal_price_original,
  total_shipping  AS total_shipping_original,
  total_tax       AS total_tax_original,
  total_discounts AS total_discounts_original,
  total_price     AS total_price_original,
  total_refunded  AS total_refunded_original,
  -- Primary columns: client currency, and ex-tax where the shop prices inclusive.
  subtotal_price  * fx_rate * net_factor AS subtotal_price,
  total_shipping  * fx_rate * net_factor AS total_shipping,
  total_discounts * fx_rate * net_factor AS total_discounts,
  -- Tax and the gross total stay gross — they ARE the tax and the gross total.
  total_tax       * fx_rate AS total_tax,
  total_price     * fx_rate AS total_price,
  total_refunded  * fx_rate AS total_refunded,
  customer_id, customer_email, shipping_country, shipping_province,
  UPPER(financial_status)               AS financial_status,
  NULLIF(UPPER(fulfillment_status), '') AS fulfillment_status,
  cancelled_at, source_name,
  payload_json, line_items,
  CASE
    WHEN customer_email IS NULL OR TRIM(customer_email) = '' THEN CAST(NULL AS BOOL)
    ELSE ROW_NUMBER() OVER (
      PARTITION BY client_id, LOWER(TRIM(customer_email))
      ORDER BY processed_at, order_id
    ) > 1
  END AS is_returning_customer
FROM joined;

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shopify_order_items` AS
WITH prod AS (
  SELECT client_id,
    TRIM(UPPER(REGEXP_REPLACE(sku, r'^DD-', ''))) AS norm_sku,
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
  -- Native-currency, gross-of-tax line economics (audit)
  CAST(JSON_VALUE(li, '$.price') AS NUMERIC)                         AS unit_price_original,
  COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0)    AS line_discount_original,
  CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC) * CAST(JSON_VALUE(li, '$.price') AS NUMERIC)
    - COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0)  AS revenue_original,
  -- Client currency, ex-tax (PRIMARY)
  CAST(JSON_VALUE(li, '$.price') AS NUMERIC) * o.fx_rate * o.net_factor AS unit_price,
  COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0) * o.fx_rate * o.net_factor AS line_discount,
  (CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC) * CAST(JSON_VALUE(li, '$.price') AS NUMERIC)
    - COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0)) * o.fx_rate * o.net_factor AS revenue,
  -- Catalogue cost is already ex-tax and in the shop's currency, so neither
  -- factor applies. Margin is therefore ex-tax revenue minus ex-tax cost.
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
  AND prod.norm_sku = TRIM(UPPER(REGEXP_REPLACE(JSON_VALUE(li, '$.sku'), r'^DD-', '')));
