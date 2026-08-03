-- 214_stg_shopify_client_currency.sql
-- =============================================================================
-- Makes stg_shopify_orders / stg_shopify_order_items currency-agnostic.
--
-- WHY
--
-- These views were written around one fact about one client: Dobias's Canadian
-- store was merged into a USD store in March 2026, so historical CAD orders
-- needed converting. The implementation baked "USD" in as the destination:
--
--     'USD' AS currency,
--     CASE WHEN currency = 'USD' THEN subtotal_price
--          WHEN currency = 'CAD' AND fx_rate_lookup IS NOT NULL
--          THEN subtotal_price * fx_rate_lookup END AS subtotal_price
--
-- For a EUR order neither branch matches, so **every money column comes back
-- NULL** — and the row is still labelled 'USD'. Venev's 4,167 EUR orders landed
-- in raw correctly and then vanished into a USD-labelled row with no revenue.
-- Nothing errored: `mart_daily_kpis` showed venev / USD / revenue NULL.
--
-- WHAT CHANGES
--
-- The destination currency comes from `ref.clients.currency` instead of being
-- the literal 'USD', and conversion is a multiplication by a factor that is
-- 1 when the order is already in the client's currency. That is the same
-- expression for all three cases, so there is no branch left to forget:
--
--     IF(order currency = client currency, 1, fx.rate)
--
-- A missing rate leaves the factor NULL and the money columns NULL — visible
-- absence rather than an unconverted figure wearing the wrong currency label.
--
-- Dobias is unaffected: client currency is USD, USD orders take the identity
-- branch, CAD orders still convert at the CAD->USD monthly rate.
--
-- `fx_rate_to_usd` is renamed `fx_rate`, which is what it now is. Its only
-- consumer is stg_shopify_order_items, rewritten below in the same migration.
-- `currency_original` (consumed by 209's mart_orders) is unchanged.
--
-- Also exposes `total_refunded` (added to raw for the Venev backfill). NULL
-- means the export predates the field, NOT that nothing was refunded — the
-- marts must not COALESCE it to zero.
--
-- Supersedes the two Shopify stg statements in 200_create_stg_views.sql.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shopify_orders` AS
WITH client_ccy AS (
  SELECT client_id, currency AS client_currency
  FROM `oneeighty-warehouse.ref.clients`
),
deduped AS (
  SELECT * EXCEPT(rn, is_returning_customer, order_date)
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, order_id ORDER BY ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_shopify_orders`
    WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  ) WHERE rn = 1
),
joined AS (
  SELECT
    d.*,
    c.client_currency,
    DATE(d.processed_at) AS order_date_raw_processed,
    -- One expression for all three cases: already in the client's currency,
    -- convertible, or unconvertible (NULL). The old CASE had a branch per
    -- currency pair and silently produced NULL for any pair nobody foresaw.
    IF(d.currency = c.client_currency, CAST(1.0 AS NUMERIC), fx.rate) AS fx_rate
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
  CASE WHEN source_name = 'Matrixify App' THEN 'canada_migrated' ELSE 'us_native' END AS store_origin,
  presentment_currency,
  subtotal_price  AS subtotal_price_original,
  total_shipping  AS total_shipping_original,
  total_tax       AS total_tax_original,
  total_discounts AS total_discounts_original,
  total_price     AS total_price_original,
  total_refunded  AS total_refunded_original,
  subtotal_price  * fx_rate AS subtotal_price,
  total_shipping  * fx_rate AS total_shipping,
  total_tax       * fx_rate AS total_tax,
  total_discounts * fx_rate AS total_discounts,
  total_price     * fx_rate AS total_price,
  total_refunded  * fx_rate AS total_refunded,
  customer_id, customer_email, shipping_country, shipping_province,
  financial_status, fulfillment_status, cancelled_at, source_name,
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
  o.currency_original, o.currency, o.fx_rate, o.store_origin,
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
  -- Native-currency line economics (audit)
  CAST(JSON_VALUE(li, '$.price') AS NUMERIC)                         AS unit_price_original,
  COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0)    AS line_discount_original,
  CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC) * CAST(JSON_VALUE(li, '$.price') AS NUMERIC)
    - COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0)  AS revenue_original,
  -- Converted into the client's currency (PRIMARY)
  CAST(JSON_VALUE(li, '$.price') AS NUMERIC) * o.fx_rate             AS unit_price,
  COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0) * o.fx_rate AS line_discount,
  (CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC) * CAST(JSON_VALUE(li, '$.price') AS NUMERIC)
    - COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0)) * o.fx_rate AS revenue,
  -- Product cost is recorded in the shop's own currency, which IS the client's
  -- currency, so it needs no conversion — unlike the order amounts above, which
  -- may have arrived from a differently-denominated legacy store.
  prod.cost                                                          AS unit_cost,
  CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC) * prod.cost           AS line_cost,
  (CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC) * CAST(JSON_VALUE(li, '$.price') AS NUMERIC)
    - COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0)) * o.fx_rate
    - CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC) * prod.cost      AS margin
FROM `oneeighty-warehouse.stg.stg_shopify_orders` o,
  UNNEST(JSON_QUERY_ARRAY(o.line_items)) AS li
LEFT JOIN prod
  ON prod.client_id = o.client_id
  AND JSON_VALUE(li, '$.sku') IS NOT NULL AND JSON_VALUE(li, '$.sku') != ''
  AND prod.norm_sku = TRIM(UPPER(REGEXP_REPLACE(JSON_VALUE(li, '$.sku'), r'^DD-', '')));
