CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shoptet_orders` AS
WITH deduped AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY client_id, code ORDER BY ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_shoptet_orders`
    WHERE orderDate >= '2020-01-01'
  )
  WHERE rn = 1
    -- Substring match: the previous exact-match list ('storno','cancelled','zrušeno')
    -- never fired, because Shoptet's actual status is 'Stornována'. 119 cancelled
    -- orders were counted as real orders (0 revenue each), inflating order counts
    -- and deflating AOV. Substring matching also survives status renames.
    AND LOWER(statusName) NOT LIKE '%storno%'
    AND LOWER(statusName) NOT IN ('cancelled', 'zrušeno')
),
cost_adj AS (
  SELECT client_id, order_code, SUM(cost_czk) AS adj_czk
  FROM `oneeighty-warehouse.stg.stg_shoptet_order_items`
  WHERE cost_is_imputed
  GROUP BY client_id, order_code
),
-- One row per Shoptet client: the storefront the export is pulled from and the
-- country that storefront sells to by default. Move to ref.clients when a
-- second Shoptet client arrives.
storefronts AS (
  SELECT 'manami' AS client_id, 'eshop.manami.cz' AS storefront_domain, 'CZ' AS domain_country
),
-- Transacting currency -> market country, per client (EUR is not SK for
-- every shop, so this is never a global map).
currency_markets AS (
  SELECT * FROM UNNEST([
    STRUCT('manami' AS client_id, 'CZK' AS currency, 'CZ' AS currency_country),
    STRUCT('manami', 'EUR', 'SK')
  ])
),
market AS (
  SELECT
    d.*,
    NULLIF(TRIM(JSON_VALUE(d.payload_json, '$.deliveryCountryName')), '') AS delivery_country_name,
    -- Pickup point postcode at the end of the shipping item name
    -- ("<carrier> - <id> | <point>, <street>, <city>, 680 01").
    REPLACE(REGEXP_EXTRACT(d.shippingMethod, r'\|.*,\s*(\d{3} ?\d{2})\s*$'), ' ', '') AS pickup_postcode
  FROM deduped d
),
market_country AS (
  SELECT
    m.*,
    -- Shoptet exports the country by its name in the shop admin language.
    -- Unmapped names fall through to the next rule and show up in the
    -- 284 regression (check 4), so a new name is never silently wrong.
    CASE LOWER(m.delivery_country_name)
      WHEN 'česká republika'     THEN 'CZ'
      WHEN 'česko'               THEN 'CZ'
      WHEN 'czech republic'      THEN 'CZ'
      WHEN 'czechia'             THEN 'CZ'
      WHEN 'slovensko'           THEN 'SK'
      WHEN 'slovenská republika' THEN 'SK'
      WHEN 'slovakia'            THEN 'SK'
    END AS delivery_country,
    -- CZ postcodes run 100 00 to 799 99, SK postcodes start with 0, 8 or 9.
    CASE
      WHEN m.pickup_postcode IS NULL THEN NULL
      WHEN SUBSTR(m.pickup_postcode, 1, 1) IN ('0', '8', '9') THEN 'SK'
      ELSE 'CZ'
    END AS postcode_country
  FROM market m
)
SELECT
  d.client_id,
  d.code AS order_code,
  d.orderDate AS order_date,
  d.statusName AS status,
  d.sourceName AS source,
  d.email,
  d.currency,
  d.exchangeRate AS exchange_rate,
  d.totalPriceWithVat        AS total_with_vat,
  d.totalPriceWithVatCZK     AS total_with_vat_czk,
  d.productRevenue           AS product_revenue,
  d.productRevenueCZK        AS product_revenue_czk,
  d.totalMargin - COALESCE(a.adj_czk, 0) / IF(d.currency = 'CZK', NUMERIC '1', d.exchangeRate) AS margin,
  d.totalMarginCZK - COALESCE(a.adj_czk, 0) AS margin_czk,
  d.priceToPay               AS price_to_pay,
  d.priceToPayCZK            AS price_to_pay_czk,
  d.shippingMethod  AS shipping_method,
  d.paymentMethod   AS payment_method,
  d.itemCount       AS item_count,
  d.totalQuantity   AS total_quantity,
  CASE
    WHEN d.email IS NULL OR TRIM(d.email) = '' THEN CAST(NULL AS BOOL)
    ELSE ROW_NUMBER() OVER (
      PARTITION BY d.client_id, LOWER(TRIM(d.email))
      ORDER BY d.orderDate, d.code
    ) > 1
  END AS is_returning_customer,
  d.customerOrderCount  AS customer_order_count,
  d.isReturningCustomer AS is_returning_customer_raw,
  d.ingested_at,
  -- Market (284): shipping country first, currency second, storefront last.
  d.delivery_country_name,
  d.pickup_postcode,
  COALESCE(d.delivery_country, d.postcode_country, cm.currency_country, sf.domain_country) AS shipping_country,
  CASE
    WHEN d.delivery_country  IS NOT NULL THEN 'delivery_country'
    WHEN d.postcode_country  IS NOT NULL THEN 'pickup_postcode'
    WHEN cm.currency_country IS NOT NULL THEN 'currency'
    WHEN sf.domain_country   IS NOT NULL THEN 'storefront_domain'
  END AS country_source,
  sf.storefront_domain
FROM market_country d
LEFT JOIN cost_adj a
  ON a.client_id = d.client_id AND a.order_code = d.code
LEFT JOIN currency_markets cm
  ON cm.client_id = d.client_id AND cm.currency = d.currency
LEFT JOIN storefronts sf
  ON sf.client_id = d.client_id;
