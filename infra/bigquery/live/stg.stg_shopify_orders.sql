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
  subtotal_price  AS subtotal_price_original,
  total_shipping  AS total_shipping_original,
  total_tax       AS total_tax_original,
  total_discounts AS total_discounts_original,
  total_price     AS total_price_original,
  total_refunded  AS total_refunded_original,
  subtotal_price  * fx_rate * net_factor AS subtotal_price,
  total_shipping  * fx_rate * net_factor AS total_shipping,
  total_discounts * fx_rate * net_factor AS total_discounts,
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
