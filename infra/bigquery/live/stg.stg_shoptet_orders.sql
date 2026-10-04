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
  d.ingested_at
FROM deduped d
LEFT JOIN cost_adj a
  ON a.client_id = d.client_id AND a.order_code = d.code;
