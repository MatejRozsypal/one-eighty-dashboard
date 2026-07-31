-- =============================================================================
-- 208 — mart.mart_order_gaps
--
-- Order-to-order gaps per customer. Feeds the dashboard's "Time between orders"
-- screen, which answers the single most actionable retention question there is:
-- when should a reorder reminder go out?
--
-- WHY THIS LIVES IN mart, NOT stg
-- The frontend service account (sa-frontend-reader) holds bigquery.dataViewer
-- on the `mart` dataset only — deliberately, so the app cannot read raw PII.
-- The gap calculation needs order-level history from stg, so it is exposed here
-- as an aggregate view. Note that this view emits NO customer identifier: only
-- the gap in days. Nothing joinable back to a person crosses into mart.
--
-- GRAIN
-- One row per (client_id, currency, consecutive-order-pair). A customer with
-- 4 orders contributes 3 rows.
--
-- MULTI-TENANT
-- UNIONs the Shopify and Shoptet branches, matching the pattern in
-- 300_create_mart_views.sql. A client with neither simply emits no rows, and
-- the dashboard renders its "no data yet" state.
--
-- WINDOW
-- 24 months. Long enough that the annual tail is visible, short enough that the
-- view stays cheap — this is scanned on every page load.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_order_gaps` AS
WITH all_orders AS (
  -- Shopify branch
  SELECT
    client_id,
    LOWER(customer_email) AS customer_key,
    order_date,
    currency
  FROM `oneeighty-warehouse.stg.stg_shopify_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH)
    AND customer_email IS NOT NULL
    AND customer_email != ''

  UNION ALL

  -- Shoptet branch
  SELECT
    client_id,
    LOWER(email) AS customer_key,
    order_date,
    'CZK' AS currency
  FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH)
    AND email IS NOT NULL
    AND email != ''
),
sequenced AS (
  SELECT
    client_id,
    currency,
    customer_key,
    order_date,
    LAG(order_date) OVER (
      PARTITION BY client_id, customer_key, currency
      ORDER BY order_date
    ) AS prev_order_date,
    ROW_NUMBER() OVER (
      PARTITION BY client_id, customer_key, currency
      ORDER BY order_date
    ) AS order_seq
  FROM all_orders
)
SELECT
  client_id,
  currency,
  DATE_DIFF(order_date, prev_order_date, DAY) AS gap_days,
  -- Which repeat this is: 2 = first→second order, 3 = second→third, and so on.
  -- Lets the dashboard show that gaps typically shorten with each repeat.
  order_seq,
  order_date AS gap_end_date
FROM sequenced
WHERE prev_order_date IS NOT NULL;
