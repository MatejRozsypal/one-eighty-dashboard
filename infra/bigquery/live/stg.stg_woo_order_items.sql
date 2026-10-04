CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_woo_order_items` AS
WITH ok_orders AS (
  SELECT client_id, order_id, order_date, currency, fx_rate
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
)
SELECT
  i.client_id,
  i.order_id,
  i.order_date,
  o.currency,
  o.fx_rate,
  i.line_item_id,
  i.product_id,
  i.variation_id,
  i.sku,
  TRIM(REGEXP_REPLACE(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
      REGEXP_REPLACE(i.name, r'<[^>]*>', ' '),
      '&nbsp;', ' '), '&amp;', '&'), '&quot;', '"'), '&lt;', '<'), '&gt;', '>'),
    r'\s+', ' ')) AS item_name,
  i.quantity,
  SAFE_DIVIDE(i.subtotal, NULLIF(i.quantity, 0)) * o.fx_rate AS unit_price,
  (COALESCE(i.subtotal, 0) - COALESCE(i.total, 0))  * o.fx_rate AS line_discount,
  i.total                                            * o.fx_rate AS revenue,
  i.unit_cost * o.fx_rate AS unit_cost,
  i.line_cost * o.fx_rate AS line_cost,
  (i.total - i.line_cost) * o.fx_rate AS margin,
  i.payload_json
FROM deduped i
JOIN ok_orders o
  ON o.client_id = i.client_id AND o.order_id = i.order_id;
