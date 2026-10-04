-- =============================================================================
-- 228_woo_fee_lines_cogs_null.sql
-- WP3 (cleanup sprint 2026-10): WooCommerce revenue counts fee-line discounts,
-- and WooCommerce COGS is NULL (never 0) when no costed line exists.
--
-- Purpose
--   1. stg.stg_woo_orders: negative fee lines (loyalty and bundle discounts such
--      as "Sleva za tlapičky", "Věrnostní sleva 3% (Bronzová)", "Sleva 5 % za
--      balíček") now reduce subtotal_price (= net sales) and net_revenue, and are
--      added to total_discounts. Positive fee lines (surcharges) are exposed as
--      other_charges and are NOT part of revenue (immaterial, see METRICS.md).
--      New columns at the end: fee_discounts, other_charges.
--   2. stg.stg_woo_order_items: the order-level fee discount is spread over the
--      lines in proportion to line total, so SUM(line revenue) per order equals
--      the order's subtotal_price (Products reconciles with Snapshot).
--      Dormant cost fallback from ref.product_costs, matched on client_id and
--      variation_id, then product_id, then sku, effective-dated. No Woo client
--      has rows in ref.product_costs today, so this changes nothing until rows
--      are loaded.
--   3. mart.mart_daily_kpis: Woo branch only, `COALESCE(c.cogs, 0) AS cogs`
--      becomes `c.cogs AS cogs`, so a Woo day without any costed line has NULL
--      cogs and NULL cm1/cm2/cm3. Shopify and Shoptet branches unchanged byte
--      for byte (verified in qa/228_regression.sql, check R0).
--   4. mart.mart_cm3_monthly (Woo only view): cm3 uses `cogs` instead of
--      `COALESCE(cogs, 0)`, so a month without COGS has NULL cm3.
--   mart_orders, mart_product_perf, mart_sku_perf, mart_unit_economics,
--   mart_monthly_kpis and mart_profit_share_monthly read the changed columns
--   but need no text change: they pick the new definitions up through stg.
--
-- Based on live view definitions read from INFORMATION_SCHEMA.VIEWS on
-- 2026-10-04 (stg.stg_woo_orders, stg.stg_woo_order_items,
-- mart.mart_daily_kpis, mart.mart_cm3_monthly). The repo had no copy of them.
--
-- Affected clients: ethia, rawbark (the WooCommerce clients). manami, dobias,
-- venev: zero diff on all columns of all touched marts.
--
-- Regression (mart_qa.wp3_* candidates, 2026-10-04): see
-- infra/bigquery/qa/228_regression.sql and the WP3 report. Zero diff for
-- manami, dobias, venev; for ethia and rawbark the per-day revenue and
-- net_sales delta equals the per-day negative fee sum exactly; order identity
-- net_revenue + other_charges + tax = total - refunds holds within 1 CZK.
--
-- Deploy order (owner OK required, prod):
--   step 1  ALTER TABLE ref.product_costs (additive, nullable columns)
--   step 2  stg.stg_woo_orders
--   step 3  stg.stg_woo_order_items (reads stg_woo_orders.fee_discounts and
--           ref.product_costs.product_id / variation_id, so after 1 and 2)
--   step 4  mart.mart_daily_kpis
--   step 5  mart.mart_cm3_monthly
--   Before step 2: snapshot mart_qa.base_<view>_20261005 per 5.R step 6.1.
--   After step 5: re-run qa/228_regression.sql R1 to R5 against prod.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Step 1. ref.product_costs: Woo keys for the dormant cost join.
-- Raw Woo stores product_id and variation_id as STRING, so the new columns are
-- STRING too (the sprint plan said INT64; STRING avoids casts in the join).
-- Additive and nullable: existing venev rows and readers are unaffected.
-- -----------------------------------------------------------------------------
ALTER TABLE `oneeighty-warehouse.ref.product_costs`
  ADD COLUMN IF NOT EXISTS product_id STRING,
  ADD COLUMN IF NOT EXISTS variation_id STRING;


-- -----------------------------------------------------------------------------
-- Step 2. stg.stg_woo_orders
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- Step 3. stg.stg_woo_order_items
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_woo_order_items` AS
WITH ok_orders AS (
  SELECT client_id, order_id, order_date, currency, fx_rate, fee_discounts
  FROM `oneeighty-warehouse.stg.stg_woo_orders`
),
deduped AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT *,
           ROW_NUMBER() OVER (
             PARTITION BY client_id, order_id, line_item_id
             ORDER BY ingested_at DESC
           ) AS rn
    FROM `oneeighty-warehouse.raw.raw_woo_order_items`
    WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  )
  WHERE rn = 1
),
-- Effective-dated unit costs (dormant until ref.product_costs has Woo rows).
-- A row matches on variation_id when it has one, else on product_id when it
-- has one, else on sku. Most specific match wins, then the latest
-- effective_from on or before the order date.
cost_rows AS (
  SELECT
    pc.client_id,
    NULLIF(NULLIF(TRIM(pc.variation_id), ''), '0') AS variation_key,
    NULLIF(TRIM(pc.product_id), '')                AS product_key,
    NULLIF(TRIM(pc.sku), '')                       AS sku_key,
    pc.cost,
    pc.currency,
    pc.effective_from,
    pc.updated_at
  FROM `oneeighty-warehouse.ref.product_costs` pc
),
lines AS (
  SELECT
    i.*,
    o.currency,
    o.fx_rate,
    -- Share of the order's fee discount carried by this line: by line total,
    -- or equally when the order's line totals sum to 0.
    COALESCE(
      o.fee_discounts * COALESCE(
        SAFE_DIVIDE(i.total, SUM(i.total) OVER (PARTITION BY i.client_id, i.order_id)),
        SAFE_DIVIDE(NUMERIC '1', COUNT(*) OVER (PARTITION BY i.client_id, i.order_id))),
      0) AS fee_alloc
  FROM deduped i
  JOIN ok_orders o
    ON o.client_id = i.client_id AND o.order_id = i.order_id
),
costed AS (
  SELECT
    l.*,
    cr.cost * IF(COALESCE(cr.currency, l.currency) = l.currency, CAST(1 AS NUMERIC), fx.rate) AS ref_unit_cost
  FROM lines l
  LEFT JOIN cost_rows cr
    ON  cr.client_id = l.client_id
    AND cr.effective_from <= l.order_date
    AND (
          (cr.variation_key IS NOT NULL
             AND cr.variation_key = NULLIF(NULLIF(TRIM(l.variation_id), ''), '0'))
       OR (cr.variation_key IS NULL AND cr.product_key IS NOT NULL
             AND cr.product_key = NULLIF(TRIM(l.product_id), ''))
       OR (cr.variation_key IS NULL AND cr.product_key IS NULL AND cr.sku_key IS NOT NULL
             AND cr.sku_key = NULLIF(TRIM(l.sku), ''))
        )
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
    ON  fx.from_currency = cr.currency
    AND fx.to_currency   = l.currency
    AND fx.month_start   = DATE_TRUNC(l.order_date, MONTH)
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY l.client_id, l.order_id, l.line_item_id
    ORDER BY
      CASE WHEN cr.variation_key IS NOT NULL THEN 1
           WHEN cr.product_key   IS NOT NULL THEN 2
           WHEN cr.sku_key       IS NOT NULL THEN 3
           ELSE 4 END,
      cr.effective_from DESC,
      cr.updated_at DESC,
      cr.cost DESC
  ) = 1
),
priced AS (
  SELECT
    c.*,
    c.total * c.fx_rate + c.fee_alloc                                   AS line_revenue,
    COALESCE(c.unit_cost * c.fx_rate, c.ref_unit_cost)                  AS line_unit_cost,
    COALESCE(c.line_cost * c.fx_rate, c.ref_unit_cost * c.quantity)     AS line_cost_final
  FROM costed c
)
SELECT
  client_id,
  order_id,
  order_date,
  currency,
  fx_rate,
  line_item_id,
  product_id,
  variation_id,
  sku,
  TRIM(REGEXP_REPLACE(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
      REGEXP_REPLACE(name, r'<[^>]*>', ' '),
      '&nbsp;', ' '), '&amp;', '&'), '&quot;', '"'), '&lt;', '<'), '&gt;', '>'),
    r'\s+', ' ')) AS item_name,
  quantity,
  SAFE_DIVIDE(subtotal, NULLIF(quantity, 0)) * fx_rate AS unit_price,
  -- Coupon discount on the line plus its share of the fee-line discount.
  (COALESCE(subtotal, 0) - COALESCE(total, 0)) * fx_rate - fee_alloc AS line_discount,
  -- Line net sales after coupon and fee-line discounts, ex tax.
  line_revenue                     AS revenue,
  line_unit_cost                   AS unit_cost,
  line_cost_final                  AS line_cost,
  line_revenue - line_cost_final   AS margin,
  payload_json,
  -- The fee-line discount carried by this line (signed negative or 0).
  fee_alloc                        AS fee_discount_alloc
FROM priced;


-- -----------------------------------------------------------------------------
-- Step 4. mart.mart_daily_kpis
-- Only change vs live: in the WooCommerce part of shop_daily,
--   COALESCE(c.cogs, 0) AS cogs   ->   c.cogs              AS cogs
-- net_sales and revenue follow stg_woo_orders (subtotal_price, net_revenue).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_daily_kpis` AS
WITH client_ccy AS (
  SELECT client_id, currency AS client_currency, meta_currency, gads_currency
  FROM `oneeighty-warehouse.ref.clients`
),
shopify_orders_daily AS (
  SELECT
    client_id, order_date AS date, currency,
    SUM(subtotal_price + COALESCE(total_shipping, 0)) AS revenue,
    SUM(IF(is_returning_customer IS FALSE, subtotal_price + COALESCE(total_shipping, 0), 0)) AS new_customer_revenue,
    SUM(IF(is_returning_customer IS TRUE,  subtotal_price + COALESCE(total_shipping, 0), 0)) AS returning_customer_revenue,
    SUM(subtotal_price)              AS net_sales,
    SUM(IF(is_returning_customer IS FALSE, subtotal_price, 0)) AS new_customer_net_sales,
    SUM(IF(is_returning_customer IS TRUE,  subtotal_price, 0)) AS returning_customer_net_sales,
    SUM(COALESCE(total_shipping, 0)) AS shipping_revenue,
    SUM(COALESCE(total_tax, 0))      AS tax_collected,
    SUM(total_price)                 AS gross_revenue_incl_tax,
    COUNT(DISTINCT order_id)         AS orders,
    COUNT(DISTINCT customer_email)   AS unique_customers,
    COUNTIF(is_returning_customer IS FALSE) AS new_customer_orders,
    COUNTIF(is_returning_customer IS TRUE)  AS returning_customer_orders
  FROM `oneeighty-warehouse.stg.stg_shopify_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_date, currency
),
shopify_cogs_daily AS (
  SELECT client_id, order_date AS date, currency, SUM(line_cost) AS cogs
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_date, currency
),
woo_orders_daily AS (
  SELECT
    client_id, order_date AS date, currency,
    SUM(net_revenue) AS revenue,
    SUM(IF(is_returning_customer IS FALSE, net_revenue, 0)) AS new_customer_revenue,
    SUM(IF(is_returning_customer IS TRUE,  net_revenue, 0)) AS returning_customer_revenue,
    SUM(subtotal_price)              AS net_sales,
    SUM(IF(is_returning_customer IS FALSE, subtotal_price, 0)) AS new_customer_net_sales,
    SUM(IF(is_returning_customer IS TRUE,  subtotal_price, 0)) AS returning_customer_net_sales,
    SUM(COALESCE(total_shipping, 0)) AS shipping_revenue,
    SUM(COALESCE(total_tax, 0))      AS tax_collected,
    SUM(total_price)                 AS gross_revenue_incl_tax,
    SUM(fulfillment_variable)        AS fulfillment_cost,
    COUNT(DISTINCT order_id)         AS orders,
    COUNT(DISTINCT customer_email)   AS unique_customers,
    COUNTIF(is_returning_customer IS FALSE) AS new_customer_orders,
    COUNTIF(is_returning_customer IS TRUE)  AS returning_customer_orders
  FROM `oneeighty-warehouse.stg.stg_woo_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_date, currency
),
woo_cogs_daily AS (
  SELECT client_id, order_date AS date, currency, SUM(line_cost) AS cogs
  FROM `oneeighty-warehouse.stg.stg_woo_order_items`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_date, currency
),
shop_daily AS (
  SELECT
    o.client_id, o.date, o.currency,
    o.revenue, o.new_customer_revenue, o.returning_customer_revenue,
    o.net_sales, o.new_customer_net_sales, o.returning_customer_net_sales,
    o.shipping_revenue, o.tax_collected, o.gross_revenue_incl_tax,
    COALESCE(c.cogs, 0) AS cogs,
    CAST(0 AS NUMERIC)  AS fulfillment_cost,
    o.orders, o.unique_customers, o.new_customer_orders, o.returning_customer_orders
  FROM shopify_orders_daily o
  LEFT JOIN shopify_cogs_daily c USING (client_id, date, currency)

  UNION ALL

  SELECT
    client_id, order_date AS date, 'CZK' AS currency,
    SUM(total_with_vat_czk)            AS revenue,
    SUM(IF(is_returning_customer IS FALSE, total_with_vat_czk, 0)) AS new_customer_revenue,
    SUM(IF(is_returning_customer IS TRUE,  total_with_vat_czk, 0)) AS returning_customer_revenue,
    SUM(product_revenue_czk)           AS net_sales,
    SUM(IF(is_returning_customer IS FALSE, product_revenue_czk, 0)) AS new_customer_net_sales,
    SUM(IF(is_returning_customer IS TRUE,  product_revenue_czk, 0)) AS returning_customer_net_sales,
    CAST(NULL AS NUMERIC)              AS shipping_revenue,
    CAST(NULL AS NUMERIC)              AS tax_collected,
    SUM(total_with_vat_czk)            AS gross_revenue_incl_tax,
    SUM(product_revenue_czk) - SUM(margin_czk) AS cogs,
    CAST(0 AS NUMERIC)                 AS fulfillment_cost,
    COUNT(DISTINCT order_code)         AS orders,
    COUNT(DISTINCT email)              AS unique_customers,
    COUNTIF(is_returning_customer IS FALSE) AS new_customer_orders,
    COUNTIF(is_returning_customer IS TRUE)  AS returning_customer_orders
  FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_date

  UNION ALL

  SELECT
    o.client_id, o.date, o.currency,
    o.revenue, o.new_customer_revenue, o.returning_customer_revenue,
    o.net_sales, o.new_customer_net_sales, o.returning_customer_net_sales,
    o.shipping_revenue, o.tax_collected, o.gross_revenue_incl_tax,
    c.cogs              AS cogs,
    o.fulfillment_cost,
    o.orders, o.unique_customers, o.new_customer_orders, o.returning_customer_orders
  FROM woo_orders_daily o
  LEFT JOIN woo_cogs_daily c USING (client_id, date, currency)
),
meta_rows AS (
  SELECT
    m.client_id, m.date_start AS date, c.client_currency AS currency,
    IF(c.meta_currency = c.client_currency, NUMERIC '1', r.rate) AS fx,
    m.spend, m.purchase_value, m.purchases, m.impressions, m.clicks, m.reach
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` m
  JOIN client_ccy c ON c.client_id = m.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` r
    ON  r.month_start   = DATE_TRUNC(m.date_start, MONTH)
    AND r.from_currency = c.meta_currency
    AND r.to_currency   = c.client_currency
  WHERE m.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
),
meta_daily AS (
  SELECT client_id, date, currency,
    SUM(spend * fx) AS meta_spend, SUM(purchase_value * fx) AS meta_revenue,
    SUM(purchases) AS meta_purchases, SUM(impressions) AS meta_impressions,
    SUM(clicks) AS meta_clicks, SUM(reach) AS meta_reach
  FROM meta_rows GROUP BY client_id, date, currency
),
google_rows AS (
  SELECT
    g.client_id, g.date_start AS date, c.client_currency AS currency,
    CAST(IF(c.gads_currency = c.client_currency, NUMERIC '1', r.rate) AS FLOAT64) AS fx,
    g.spend, g.purchase_value, g.purchases, g.impressions, g.clicks
  FROM `oneeighty-warehouse.stg.stg_google_ads_campaign_insights` g
  JOIN client_ccy c ON c.client_id = g.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` r
    ON  r.month_start   = DATE_TRUNC(g.date_start, MONTH)
    AND r.from_currency = c.gads_currency
    AND r.to_currency   = c.client_currency
  WHERE g.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
),
google_daily AS (
  SELECT client_id, date, currency,
    SUM(spend * fx) AS google_spend, SUM(purchase_value * fx) AS google_revenue,
    SUM(purchases) AS google_purchases, SUM(impressions) AS google_impressions,
    SUM(clicks) AS google_clicks
  FROM google_rows GROUP BY client_id, date, currency
),
paid_daily AS (
  SELECT
    COALESCE(m.client_id, g.client_id) AS client_id,
    COALESCE(m.date,      g.date)      AS date,
    COALESCE(m.currency,  g.currency)  AS currency,
    m.meta_spend, m.meta_revenue, m.meta_purchases, m.meta_impressions, m.meta_clicks, m.meta_reach,
    g.google_spend, g.google_revenue, g.google_purchases, g.google_impressions, g.google_clicks,
    COALESCE(m.meta_spend, 0) + CAST(COALESCE(g.google_spend, 0) AS NUMERIC) AS paid_spend
  FROM meta_daily m
  FULL OUTER JOIN google_daily g
    ON m.client_id = g.client_id AND m.date = g.date AND m.currency = g.currency
)
SELECT
  COALESCE(s.client_id, p.client_id) AS client_id,
  COALESCE(s.date,      p.date)      AS date,
  COALESCE(s.currency,  p.currency)  AS currency,
  s.revenue, s.new_customer_revenue, s.returning_customer_revenue,
  s.net_sales, s.new_customer_net_sales, s.returning_customer_net_sales,
  s.shipping_revenue, s.tax_collected, s.gross_revenue_incl_tax,
  s.cogs,
  s.orders, s.unique_customers, s.new_customer_orders, s.returning_customer_orders,
  p.meta_spend, p.meta_revenue, p.meta_purchases, p.meta_impressions, p.meta_clicks, p.meta_reach,
  p.google_spend, p.google_revenue, p.google_purchases, p.google_impressions, p.google_clicks,
  p.paid_spend,
  CAST(0 AS NUMERIC) AS cm1_other_costs,
  COALESCE(s.fulfillment_cost, 0) AS fulfillment_cost,
  s.revenue - s.cogs - 0                                          AS cm1,
  s.revenue - s.cogs - 0 - COALESCE(s.fulfillment_cost, 0)        AS cm2,
  s.revenue - s.cogs - 0 - COALESCE(s.fulfillment_cost, 0) - COALESCE(p.paid_spend, 0) AS cm3
FROM shop_daily s
FULL OUTER JOIN paid_daily p
  ON s.client_id = p.client_id AND s.date = p.date AND s.currency = p.currency;


-- -----------------------------------------------------------------------------
-- Step 5. mart.mart_cm3_monthly (WooCommerce only)
-- Only change vs live: `revenue_net - COALESCE(cogs, 0)` -> `revenue_net - cogs`,
-- so a month without COGS gives NULL cm3 instead of cm3 = revenue - costs.
-- revenue_net follows stg_woo_orders.net_revenue (fee discounts included).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_cm3_monthly` AS
WITH contract AS (
  SELECT client_id, media_channels, contract_start_date
  FROM `oneeighty-warehouse.ref.contracts`
  WHERE valid_from <= CURRENT_DATE()
    AND (valid_to IS NULL OR valid_to >= CURRENT_DATE())
),
shop_monthly AS (
  SELECT
    client_id,
    DATE_TRUNC(order_date, MONTH)              AS month,
    SUM(net_revenue)                           AS revenue_net,
    SUM(cogs_total)                            AS cogs,
    SUM(fulfillment_variable)                  AS fulfillment_variable,
    COUNT(*)                                   AS orders,
    COUNTIF(NOT has_cost_imprint)              AS orders_without_cost_imprint,
    COUNTIF(NOT has_fulfillment_imprint)       AS orders_without_fulfillment_imprint
  FROM `oneeighty-warehouse.stg.stg_woo_orders`
  GROUP BY client_id, month
),
fixed_costs AS (
  SELECT client_id, month, SUM(amount_czk) AS fulfillment_fixed
  FROM `oneeighty-warehouse.ref.client_monthly_costs`
  GROUP BY client_id, month
),
meta_monthly AS (
  SELECT
    m.client_id,
    DATE_TRUNC(m.date_start, MONTH) AS month,
    SUM(m.spend * IF(c.meta_currency = c.currency, NUMERIC '1', COALESCE(fx.rate, NUMERIC '1'))) AS media_spend_meta,
    COUNT(DISTINCT m.date_start) AS meta_spend_days
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` m
  JOIN `oneeighty-warehouse.ref.clients` c ON c.client_id = m.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
    ON fx.from_currency = c.meta_currency AND fx.to_currency = c.currency
   AND fx.month_start = DATE_TRUNC(m.date_start, MONTH)
  GROUP BY m.client_id, month
),
google_monthly AS (
  SELECT
    g.client_id,
    DATE_TRUNC(g.date_start, MONTH) AS month,
    SUM(CAST(g.spend AS NUMERIC) * IF(c.gads_currency = c.currency, NUMERIC '1', COALESCE(fx.rate, NUMERIC '1'))) AS media_spend_google,
    COUNT(DISTINCT g.date_start) AS google_spend_days
  FROM `oneeighty-warehouse.stg.stg_google_ads_campaign_insights` g
  JOIN `oneeighty-warehouse.ref.clients` c ON c.client_id = g.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
    ON fx.from_currency = c.gads_currency AND fx.to_currency = c.currency
   AND fx.month_start = DATE_TRUNC(g.date_start, MONTH)
  GROUP BY g.client_id, month
),
combined AS (
  SELECT
    s.client_id,
    s.month,
    s.revenue_net,
    s.cogs,
    s.fulfillment_variable,
    COALESCE(f.fulfillment_fixed, 0) AS fulfillment_fixed,
    f.fulfillment_fixed IS NOT NULL  AS has_fixed_costs,
    IF('meta' IN UNNEST(ct.media_channels), COALESCE(mm.media_spend_meta, 0), 0)         AS media_spend_meta,
    IF('google_ads' IN UNNEST(ct.media_channels), COALESCE(gm.media_spend_google, 0), 0) AS media_spend_google,
    s.orders,
    s.orders_without_cost_imprint,
    s.orders_without_fulfillment_imprint,
    GREATEST(
      LEAST(
        DATE_DIFF(LAST_DAY(s.month), s.month, DAY) + 1,
        DATE_DIFF(CURRENT_DATE(), s.month, DAY) + 1
      ) - COALESCE(mm.meta_spend_days, 0),
      0
    ) AS spend_days_missing,
    ct.contract_start_date
  FROM shop_monthly s
  JOIN contract ct USING (client_id)
  LEFT JOIN fixed_costs    f  ON f.client_id  = s.client_id AND f.month  = s.month
  LEFT JOIN meta_monthly   mm ON mm.client_id = s.client_id AND mm.month = s.month
  LEFT JOIN google_monthly gm ON gm.client_id = s.client_id AND gm.month = s.month
)
SELECT
  client_id,
  month,
  revenue_net,
  cogs,
  fulfillment_variable,
  fulfillment_fixed,
  fulfillment_variable + fulfillment_fixed AS fulfillment,
  media_spend_meta,
  media_spend_google,
  media_spend_meta + media_spend_google    AS media_spend,
  revenue_net - cogs
              - (fulfillment_variable + fulfillment_fixed)
              - (media_spend_meta + media_spend_google) AS cm3,
  orders,
  orders_without_cost_imprint,
  spend_days_missing,
  (orders_without_cost_imprint = 0
     AND orders_without_fulfillment_imprint = 0
     AND has_fixed_costs
     AND spend_days_missing = 0) AS is_complete,
  ARRAY_TO_STRING(ARRAY(
    SELECT x FROM UNNEST([
      IF(orders_without_cost_imprint > 0, CONCAT(CAST(orders_without_cost_imprint AS STRING), ' orders without a COGS imprint'), NULL),
      IF(orders_without_fulfillment_imprint > 0, CONCAT(CAST(orders_without_fulfillment_imprint AS STRING), ' orders without a fulfillment imprint'), NULL),
      IF(NOT has_fixed_costs, 'no fixed monthly cost row (storage)', NULL),
      IF(spend_days_missing > 0, CONCAT(CAST(spend_days_missing AS STRING), ' days without Meta spend'), NULL)
    ]) AS x WHERE x IS NOT NULL
  ), '; ') AS incomplete_reason
FROM combined;
