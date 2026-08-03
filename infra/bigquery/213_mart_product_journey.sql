-- 213 — Product journey and first-product repurchase
--
-- The last "Soon" item in the nav. Answers which first purchase predicts a
-- second, and what customers go on to buy after it.
--
-- ── The anchor product ──────────────────────────────────────────────────────
-- An order can hold several lines, and a journey needs one product per order or
-- it cannot be drawn. The anchor is the highest-revenue line: it is the thing
-- the basket was built around, and "what did they lead with" is the buying
-- decision worth tracking. The alternative — counting a customer once per line —
-- makes the shares non-exclusive, so they no longer sum to the customer count
-- and a flow diagram built on them is a lie about volume.
--
-- ── Both platforms ──────────────────────────────────────────────────────────
-- The original spec assumed Shopify only. Shoptet carries item-level data too,
-- so Manami is included. The two differ in their keys — Shopify has a customer
-- id and an order id, Shoptet has only an email and an order code — so each is
-- normalised to (customer_key, order_key) before the shared logic runs.
--
-- Shoptet has no customer id at all, so its identity is the email. A customer
-- who orders twice under two addresses reads as two people, which understates
-- repeat rate. Stated, not corrected: guessing at identity is worse.
--
-- ── Maturity ────────────────────────────────────────────────────────────────
-- A customer who bought last week has not "failed to repurchase" — they have
-- not had time. Every repeat figure counts only customers whose first order is
-- at least 180 days old. Without that, a brand's repeat rate falls whenever it
-- has a good acquisition month, which is exactly backwards.
--
-- 180 days suits both clients here: supplements replenish on roughly a 60–90
-- day cycle, perfume much longer. It is a stated assumption, not a measurement,
-- and the pages that read these views say so.

-- ── Every order reduced to one customer, one date, one product ──────────────
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_product_steps` AS
WITH shopify_orders AS (
  SELECT
    client_id,
    order_id                                        AS order_key,
    order_date,
    COALESCE(customer_id, LOWER(customer_email))    AS customer_key
  FROM `oneeighty-warehouse.stg.stg_shopify_orders`
  WHERE COALESCE(customer_id, customer_email) IS NOT NULL
),
shopify_anchor AS (
  SELECT
    o.client_id,
    o.customer_key,
    o.order_key,
    o.order_date,
    ARRAY_AGG(i.item_name ORDER BY i.revenue DESC, i.item_name LIMIT 1)[OFFSET(0)] AS product
  FROM shopify_orders o
  JOIN `oneeighty-warehouse.stg.stg_shopify_order_items` i
    ON i.order_id = o.order_key AND i.client_id = o.client_id
  WHERE i.item_name IS NOT NULL
  GROUP BY 1, 2, 3, 4
),

shoptet_orders AS (
  SELECT
    client_id,
    order_code        AS order_key,
    order_date,
    LOWER(email)      AS customer_key
  FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
  WHERE email IS NOT NULL AND email != ''
),
shoptet_anchor AS (
  SELECT
    o.client_id,
    o.customer_key,
    o.order_key,
    o.order_date,
    ARRAY_AGG(i.item_name ORDER BY i.revenue_czk DESC, i.item_name LIMIT 1)[OFFSET(0)] AS product
  FROM shoptet_orders o
  JOIN `oneeighty-warehouse.stg.stg_shoptet_order_items` i
    ON i.order_code = o.order_key AND i.client_id = o.client_id
  WHERE i.item_name IS NOT NULL
  GROUP BY 1, 2, 3, 4
),

combined AS (
  SELECT * FROM shopify_anchor
  UNION ALL
  SELECT * FROM shoptet_anchor
)

SELECT
  client_id,
  customer_key,
  order_key,
  order_date,
  product,
  ROW_NUMBER() OVER (
    PARTITION BY client_id, customer_key ORDER BY order_date, order_key
  ) AS step,
  COUNT(*) OVER (PARTITION BY client_id, customer_key)    AS lifetime_orders,
  MIN(order_date) OVER (PARTITION BY client_id, customer_key) AS first_order_date
FROM combined;


-- ── Transitions: what they bought next ──────────────────────────────────────
-- Aggregated, so no customer identity leaves the warehouse into this view. The
-- frontend service account reads mart only, and a journey needs volumes, not
-- names.
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_product_journey` AS
WITH stepped AS (
  SELECT
    client_id,
    customer_key,
    step,
    product,
    LEAD(product) OVER (
      PARTITION BY client_id, customer_key ORDER BY step
    ) AS next_product
  FROM `oneeighty-warehouse.mart.mart_customer_product_steps`
)
SELECT
  client_id,
  step            AS from_step,
  product         AS from_product,
  next_product    AS to_product,
  COUNT(*)        AS customers
FROM stepped
WHERE next_product IS NOT NULL
GROUP BY 1, 2, 3, 4;


-- ── First product → did they come back ──────────────────────────────────────
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_first_product_repeat` AS
WITH first_orders AS (
  SELECT
    client_id,
    customer_key,
    product           AS first_product,
    lifetime_orders,
    first_order_date
  FROM `oneeighty-warehouse.mart.mart_customer_product_steps`
  WHERE step = 1
)
SELECT
  client_id,
  first_product,
  COUNT(*)                                  AS customers,
  COUNTIF(lifetime_orders >= 2)             AS repeaters,
  -- Deliberately NOT a stored percentage: METRICS.md forbids pre-divided
  -- columns, because summing them across rows is wrong and somebody always
  -- tries. The numerator and denominator are here; the rate is recomputed.
  AVG(lifetime_orders)                      AS avg_lifetime_orders,
  MIN(first_order_date)                     AS earliest_first_order,
  MAX(first_order_date)                     AS latest_first_order
FROM first_orders
-- Maturity: only customers who have had 180 days to come back.
WHERE first_order_date < DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
GROUP BY 1, 2;
