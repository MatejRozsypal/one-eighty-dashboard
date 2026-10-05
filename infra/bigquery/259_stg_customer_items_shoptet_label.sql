-- =============================================================================
-- 259_stg_customer_items_shoptet_label.sql
-- Purpose: stable Shoptet product label in stg.stg_customer_order_items so that a
--   renamed product is one row in the Repurchase tables (mart_customer_product_steps,
--   mart_first_product_repeat, mart_product_journey group by product_name).
--   Manami SKU 153 (the sample set) has had 4 names and showed up as 4 rows
--   (325, 466, 57 and 126 customers at audit time), a fake decline between names.
-- Change: Shoptet branch only. product_key = COALESCE(NULLIF(item_code, ''), item_name).
--   product_name = latest item_name per (client_id, base item code) by order date
--   (a shoptet_labels CTE, like woo_labels), falling back to item_name. item_name is
--   unchanged. Shopify and WooCommerce branches are untouched.
-- Based on: infra/bigquery/live/stg.stg_customer_order_items.sql (live 2026-10-05,
--   md5 of the definition a7693fd71783a2005f96c271acd37ee4).
-- Affected clients: manami (the only Shoptet client). Others: 0 diff rows.
-- Regression: qa/259_regression.sql (design 2.5, WR2). Results recorded there.
-- Deploy order: 259 first, then 260. Rollback: previous live text in
--   scratchpad/rollback (stg.stg_customer_order_items.pre259.sql).
-- Design ref: retention design 2.3 (renumbered from 257).
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_customer_order_items` AS
WITH woo_lines AS (
  SELECT
    client_id,
    order_id,
    order_date,
    line_item_id,
    item_name,
    COALESCE(NULLIF(sku, ''), NULLIF(NULLIF(product_id, ''), '0'), item_name) AS product_key,
    revenue,
    line_cost
  FROM `oneeighty-warehouse.stg.stg_woo_order_items`
),
woo_labels AS (
  SELECT
    client_id,
    product_key,
    ARRAY_AGG(item_name ORDER BY LENGTH(item_name), item_name LIMIT 1)[OFFSET(0)] AS product_name
  FROM woo_lines
  WHERE item_name IS NOT NULL
  GROUP BY client_id, product_key
),
shoptet_lines AS (
  SELECT
    client_id,
    order_code,
    order_date,
    item_key,
    item_name,
    item_code,
    NULLIF(REGEXP_EXTRACT(item_code, r'^[^/]+'), '') AS base_code
  FROM `oneeighty-warehouse.stg.stg_shoptet_order_items`
),
shoptet_labels AS (
  -- One stable label per base item code ("153", "1003" from "1003/5"): the latest
  -- item_name by order date. Shoptet renames products (SKU 153 has had 4 names)
  -- and the Repurchase tables group by name, so one product showed as several rows.
  SELECT
    client_id,
    base_code,
    ARRAY_AGG(item_name ORDER BY order_date DESC, order_code DESC, item_key DESC LIMIT 1)[OFFSET(0)] AS product_name
  FROM shoptet_lines
  WHERE base_code IS NOT NULL
    AND item_name IS NOT NULL
  GROUP BY client_id, base_code
)
-- Shopify: amounts in reporting currency. Product identity is the item name,
-- which is what the journey marts have always grouped by.
SELECT
  'shopify'              AS platform,
  client_id,
  order_id,
  order_date,
  CAST(NULL AS STRING)   AS line_id,
  item_name,
  item_name              AS product_key,
  item_name              AS product_name,
  revenue,
  line_cost
FROM `oneeighty-warehouse.stg.stg_shopify_order_items`

UNION ALL

-- Shoptet: CZK columns, keyed by order_code. Product key is the item code (falls
-- back to the name for lines without one), the label is the latest name per base code.
SELECT
  'shoptet'              AS platform,
  i.client_id,
  i.order_code           AS order_id,
  i.order_date,
  i.item_key             AS line_id,
  i.item_name,
  COALESCE(NULLIF(i.item_code, ''), i.item_name) AS product_key,
  COALESCE(l.product_name, i.item_name)          AS product_name,
  i.revenue_czk          AS revenue,
  i.cost_czk             AS line_cost
FROM `oneeighty-warehouse.stg.stg_shoptet_order_items` i
LEFT JOIN shoptet_labels l
  ON l.client_id = i.client_id AND l.base_code = NULLIF(REGEXP_EXTRACT(i.item_code, r'^[^/]+'), '')

UNION ALL

-- WooCommerce: product key per the W3 spec, labelled with one stable name.
SELECT
  'woocommerce'          AS platform,
  w.client_id,
  w.order_id,
  w.order_date,
  w.line_item_id         AS line_id,
  w.item_name,
  w.product_key,
  l.product_name,
  w.revenue,
  w.line_cost
FROM woo_lines w
LEFT JOIN woo_labels l
  ON l.client_id = w.client_id AND l.product_key = w.product_key;
