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
