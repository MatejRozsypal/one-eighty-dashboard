CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_woo_orders` AS
WITH client_ccy AS (
  SELECT client_id, currency AS client_currency
  FROM `oneeighty-warehouse.ref.clients`
),
deduped AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT *,
           ROW_NUMBER() OVER (
             PARTITION BY client_id, order_id
             ORDER BY ingested_at DESC, date_modified_gmt DESC
           ) AS rn
    FROM `oneeighty-warehouse.raw.raw_woo_orders`
    WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  )
  WHERE rn = 1
),
filtered AS (
  SELECT * FROM deduped
  WHERE status IN ('processing', 'completed', 'on-hold')
),
-- Fee lines, ex tax, in the order currency. Negative lines are discounts
-- (loyalty, bundle, paid-from-another-order credits), positive lines are
-- surcharges. When the payload has no fee_lines array, fall back to the signed
-- fees_total.
fees AS (
  SELECT
    f.*,
    IF(JSON_QUERY(f.payload_json, '$.fee_lines') IS NULL,
       LEAST(COALESCE(f.fees_total, 0), 0),
       COALESCE((
         SELECT SUM(SAFE_CAST(JSON_VALUE(fl, '$.total') AS NUMERIC))
         FROM UNNEST(JSON_QUERY_ARRAY(f.payload_json, '$.fee_lines')) AS fl
         WHERE SAFE_CAST(JSON_VALUE(fl, '$.total') AS NUMERIC) < 0
       ), 0)) AS fee_discounts_native,
    IF(JSON_QUERY(f.payload_json, '$.fee_lines') IS NULL,
       GREATEST(COALESCE(f.fees_total, 0), 0),
       COALESCE((
         SELECT SUM(SAFE_CAST(JSON_VALUE(fl, '$.total') AS NUMERIC))
         FROM UNNEST(JSON_QUERY_ARRAY(f.payload_json, '$.fee_lines')) AS fl
         WHERE SAFE_CAST(JSON_VALUE(fl, '$.total') AS NUMERIC) > 0
       ), 0)) AS fee_charges_native
  FROM filtered f
),
joined AS (
  SELECT
    d.*,
    c.client_currency,
    IF(d.currency = c.client_currency, CAST(1.0 AS NUMERIC), fx.rate) AS fx_rate,
    COALESCE(SAFE_DIVIDE(d.total - d.total_tax, NULLIF(d.total, 0)), 1) AS net_ratio
  FROM fees d
  JOIN client_ccy c ON c.client_id = d.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
    ON  fx.from_currency = d.currency
    AND fx.to_currency   = c.client_currency
    AND fx.month_start   = DATE_TRUNC(d.order_date, MONTH)
)
SELECT
  client_id, ingested_at, ingest_source,
  order_id, order_number, order_date,
  date_created_gmt, date_modified_gmt, date_paid_gmt, date_completed_gmt,
  currency        AS currency_original,
  client_currency AS currency,
  fx_rate,
  -- Net sales: goods after coupon AND fee-line discounts, ex tax.
  (subtotal_ex_tax + fee_discounts_native) * fx_rate AS subtotal_price,
  COALESCE(shipping_total, 0)   * fx_rate AS total_shipping,
  (COALESCE(discount_total, 0) + ABS(fee_discounts_native)) * fx_rate AS total_discounts,
  COALESCE(total_tax, 0)        * fx_rate AS total_tax,
  total                         * fx_rate AS total_price,
  COALESCE(refunds_total, 0) * net_ratio * fx_rate AS total_refunded,
  -- Revenue = net sales + shipping - net part of refunds, ex tax. Positive fee
  -- lines (other_charges) are not revenue.
  (subtotal_ex_tax
     + fee_discounts_native
     + COALESCE(shipping_total, 0)
     - COALESCE(refunds_total, 0) * net_ratio) * fx_rate AS net_revenue,
  cogs_total     * fx_rate AS cogs_total,
  packaging_cost * fx_rate AS packaging_cost,
  shipping_cost  * fx_rate AS shipping_cost,
  gateway_fee    * fx_rate AS gateway_fee,
  cod_fee        * fx_rate AS cod_fee,
  (COALESCE(packaging_cost, 0)
     + COALESCE(shipping_cost, 0)
     + COALESCE(gateway_fee, 0)
     + COALESCE(cod_fee, 0)) * fx_rate AS fulfillment_variable,
  has_cost_imprint,
  (packaging_cost IS NOT NULL
     AND shipping_cost IS NOT NULL
     AND gateway_fee IS NOT NULL) AS has_fulfillment_imprint,
  customer_id,
  customer_email,
  billing_country AS shipping_country,
  billing_city,
  UPPER(status)   AS financial_status,
  status          AS status_raw,
  created_via     AS source_name,
  payment_method, shipping_method, carrier, carrier_status_code, packing_box_id,
  coupon_codes,
  attribution_source_type, utm_source, utm_medium, utm_campaign, utm_content,
  payload_json,
  CASE
    WHEN customer_email IS NULL OR TRIM(customer_email) = '' THEN CAST(NULL AS BOOL)
    ELSE ROW_NUMBER() OVER (
      PARTITION BY client_id, LOWER(TRIM(customer_email))
      ORDER BY order_date, order_id
    ) > 1
  END AS is_returning_customer,
  -- Signed negative (or 0): fee-line discounts, ex tax, client currency.
  fee_discounts_native * fx_rate AS fee_discounts,
  -- Positive (or 0): fee-line surcharges, ex tax, client currency. Not revenue.
  fee_charges_native   * fx_rate AS other_charges
FROM joined;
