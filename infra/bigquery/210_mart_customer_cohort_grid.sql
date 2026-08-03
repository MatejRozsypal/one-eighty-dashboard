-- 210_mart_customer_cohort_grid.sql
-- Cohort grid: one row per (client, market, cohort month, month offset).
--
-- `mart_customer_cohorts` is one row per cohort — totals only, no time axis. It
-- can say a cohort's lifetime LTV; it cannot say what month 3 looked like, which
-- is the whole point of a cohort grid. This adds the offset axis, so retention,
-- revenue-per-customer, AOV and a cumulative LTV curve all derive from one view
-- instead of one query each.
--
-- ── Additive by construction ────────────────────────────────────────────────
-- A customer is assigned to exactly one market — the market of their FIRST
-- order, which is what defines the cohort. So cohort sizes and active counts
-- can be summed across markets to get "all markets" without double counting a
-- customer who later bought from elsewhere. The frontend relies on that.
--
-- ── `market` is not the same thing on both platforms, and must not pretend ───
--   Shopify (Dobias):  the shipping country of the first order — a real country.
--   Shoptet (Manami):  the currency of the first order. The Shoptet order
--                      payload carries no address at all (verified against
--                      raw_shoptet_orders.payload_json), so CZK/EUR is the
--                      closest thing to a market boundary the data contains.
-- `market_kind` says which one a row is, so the UI can label it honestly rather
-- than printing a currency code under a heading that says "Country".
--
-- ── Two caveats this view cannot fix ────────────────────────────────────────
-- 1. Dobias ran a separate Canadian store until it was merged into the US store
--    in March 2026, and that store's whole history entered the warehouse with
--    the merge. Cohorts before 2026-03 therefore mix two stores. The country
--    split makes this visible rather than hiding it, which is the best that can
--    be done here.
-- 2. Orders before 2022-06 have NULL USD amounts — `ref.fx_rates` starts there.
--    They fall outside the 36-month window anyway, but a widened window would
--    surface them as zero-revenue cohorts.

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_cohort_grid` AS
WITH shopify_costs AS (
  SELECT client_id, order_id, SUM(line_cost) AS order_cogs
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_id
),

orders AS (
  -- Manami via Shoptet
  SELECT
    client_id,
    LOWER(TRIM(email))                       AS customer_key,
    order_date,
    order_code                               AS order_id,
    total_with_vat_czk                       AS revenue,
    margin_czk                               AS gross_profit,
    'CZK'                                    AS currency,
    currency                                 AS market,
    'currency'                               AS market_kind
  FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
    AND email IS NOT NULL AND TRIM(email) != ''

  UNION ALL

  -- Dobias via Shopify
  SELECT
    o.client_id,
    LOWER(TRIM(o.customer_email))            AS customer_key,
    o.order_date,
    o.order_id,
    o.subtotal_price + COALESCE(o.total_shipping, 0) AS revenue,
    CASE WHEN c.order_cogs IS NULL THEN NULL
         ELSE o.subtotal_price - c.order_cogs END    AS gross_profit,
    o.currency,
    COALESCE(NULLIF(o.shipping_country, ''), 'Unknown') AS market,
    'country'                                AS market_kind
  FROM `oneeighty-warehouse.stg.stg_shopify_orders` o
  LEFT JOIN shopify_costs c USING (client_id, order_id)
  WHERE o.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
    AND o.customer_email IS NOT NULL AND TRIM(o.customer_email) != ''
),

-- The first order defines both the cohort month and the market, for life.
first_orders AS (
  SELECT
    client_id,
    customer_key,
    DATE_TRUNC(MIN(order_date), MONTH) AS cohort_month,
    ARRAY_AGG(market      ORDER BY order_date, order_id LIMIT 1)[OFFSET(0)] AS market,
    ARRAY_AGG(market_kind ORDER BY order_date, order_id LIMIT 1)[OFFSET(0)] AS market_kind,
    ARRAY_AGG(currency    ORDER BY order_date, order_id LIMIT 1)[OFFSET(0)] AS currency
  FROM orders
  GROUP BY client_id, customer_key
),

cohort_sizes AS (
  SELECT client_id, cohort_month, market, market_kind, currency,
         COUNT(*) AS cohort_customers
  FROM first_orders
  GROUP BY 1, 2, 3, 4, 5
),

-- Each order lands in the offset month measured from its customer's cohort.
activity AS (
  SELECT
    f.client_id,
    f.cohort_month,
    f.market,
    f.market_kind,
    f.currency,
    DATE_DIFF(DATE_TRUNC(o.order_date, MONTH), f.cohort_month, MONTH) AS month_offset,
    COUNT(DISTINCT o.customer_key) AS active_customers,
    COUNT(DISTINCT o.order_id)     AS orders,
    SUM(o.revenue)                 AS revenue,
    SUM(o.gross_profit)            AS gross_profit
  FROM orders o
  JOIN first_orders f
    ON o.client_id = f.client_id AND o.customer_key = f.customer_key
  GROUP BY 1, 2, 3, 4, 5, 6
)

SELECT
  a.client_id,
  a.cohort_month,
  a.market,
  a.market_kind,
  a.currency,
  a.month_offset,
  s.cohort_customers,
  a.active_customers,
  a.orders,
  a.revenue,
  a.gross_profit,
  -- Offsets a cohort has not lived through yet are absent, not zero. This flag
  -- lets the UI leave those cells blank instead of drawing a 0% that reads as
  -- "everybody churned" when it means "this month hasn't happened".
  DATE_ADD(a.cohort_month, INTERVAL a.month_offset MONTH)
    <= DATE_TRUNC(CURRENT_DATE(), MONTH) AS is_elapsed
FROM activity a
JOIN cohort_sizes s
  ON  a.client_id    = s.client_id
  AND a.cohort_month = s.cohort_month
  AND a.market       = s.market
WHERE a.month_offset >= 0;
