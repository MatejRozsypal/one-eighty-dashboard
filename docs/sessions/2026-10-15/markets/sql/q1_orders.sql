-- Q1: order economics per client x market x period (base currency = ref.clients.currency)
WITH p AS (
  SELECT 'L12M' period, DATE '2025-10-15' d0, DATE '2026-10-14' d1 UNION ALL
  SELECT 'P12M', DATE '2024-10-15', DATE '2025-10-14' UNION ALL
  SELECT 'L90',  DATE '2026-07-17', DATE '2026-10-14' UNION ALL
  SELECT 'P90',  DATE '2026-04-18', DATE '2026-07-16'
),
base AS (
  SELECT
    o.*,
    CASE
      WHEN NULLIF(o.shipping_country, '') IS NOT NULL THEN o.shipping_country
      WHEN o.market_currency = 'CZK' THEN 'CZ'
      WHEN o.market_currency = 'EUR' AND o.client_id IN ('manami', 'rawbark') THEN 'SK'
      WHEN o.market_currency = 'CAD' THEN 'CA'
      WHEN o.market_currency = 'USD' THEN 'US'
      ELSE 'UNKNOWN' END AS market_raw,
    CASE WHEN NULLIF(o.shipping_country, '') IS NOT NULL THEN 'country' ELSE 'currency_fallback' END AS market_source,
    COALESCE(s.total_discounts, w.total_discounts) AS discounts,
    COALESCE(s.total_refunded, w.total_refunded)   AS refunds,
    s.financial_status AS shopify_fin_status,
    COALESCE(s.total_discounts, w.total_discounts, 0) > 0
      OR COALESCE(si.has_item_discount, FALSE)      AS is_discounted
  FROM `oneeighty-warehouse.stg.stg_customer_orders` o
  LEFT JOIN `oneeighty-warehouse.stg.stg_shopify_orders` s
    ON o.platform = 'shopify' AND s.client_id = o.client_id AND s.order_id = o.order_id
  LEFT JOIN `oneeighty-warehouse.stg.stg_woo_orders` w
    ON o.platform = 'woocommerce' AND w.client_id = o.client_id AND w.order_id = o.order_id
  LEFT JOIN (SELECT client_id, order_code, LOGICAL_OR(discount_pct > 0) has_item_discount
             FROM `oneeighty-warehouse.stg.stg_shoptet_order_items` GROUP BY 1, 2) si
    ON o.platform = 'shoptet' AND si.client_id = o.client_id AND si.order_code = o.order_id
  WHERE o.order_date >= '2024-10-15'
),
b AS (
  SELECT *,
    CASE WHEN client_id = 'dobias' AND market_raw NOT IN ('US', 'CA') THEN 'OTHER'
         WHEN client_id IN ('rawbark', 'manami', 'venev', 'ethia') AND market_raw NOT IN ('CZ', 'SK') THEN 'OTHER'
         ELSE market_raw END AS market
  FROM base
)
SELECT
  b.client_id, ANY_VALUE(b.currency) AS ccy, b.market, p.period,
  COUNT(*)                                                     AS orders,
  COUNTIF(b.is_returning_customer IS FALSE)                    AS new_customers,
  COUNTIF(b.is_returning_customer IS NULL)                     AS orders_no_email,
  COUNTIF(b.market_source = 'currency_fallback')               AS orders_market_fallback,
  ROUND(SUM(b.revenue))                                        AS revenue,
  ROUND(SUM(b.net_sales))                                      AS net_sales,
  ROUND(SUM(b.discounts))                                      AS discounts,
  ROUND(SUM(b.net_sales) + SUM(b.discounts))                   AS gross_sales,
  ROUND(100 * SAFE_DIVIDE(SUM(b.discounts), SUM(b.net_sales) + SUM(b.discounts)), 1) AS disc_pct_gross,
  ROUND(100 * COUNTIF(b.is_discounted) / COUNT(*), 1)          AS pct_orders_discounted,
  ROUND(SUM(b.refunds))                                        AS refunds,
  COUNTIF(b.refunds > 0)                                       AS orders_refunded_amt,
  COUNTIF(b.shopify_fin_status IN ('REFUNDED', 'PARTIALLY_REFUNDED')) AS orders_refunded_status,
  ROUND(SUM(b.shipping))                                       AS shipping_charged,
  ROUND(SUM(b.cogs))                                           AS cogs,
  ROUND(100 * COUNTIF(b.cogs IS NOT NULL) / COUNT(*), 1)       AS cogs_cov_pct,
  ROUND(100 * SAFE_DIVIDE(SUM(b.cogs), SUM(IF(b.cogs IS NOT NULL, b.net_sales, NULL))), 1) AS cogs_pct_net_sales,
  ROUND(SUM(b.gross_profit))                                   AS gp,
  ROUND(SAFE_DIVIDE(SUM(IF(b.is_returning_customer IS FALSE, b.net_sales, 0)), COUNTIF(b.is_returning_customer IS FALSE)), 1) AS aov_new,
  ROUND(SAFE_DIVIDE(SUM(IF(b.is_returning_customer IS TRUE,  b.net_sales, 0)), COUNTIF(b.is_returning_customer IS TRUE)), 1)  AS aov_ret,
  ROUND(SAFE_DIVIDE(SUM(IF(b.is_returning_customer IS FALSE, b.gross_profit, NULL)), COUNTIF(b.is_returning_customer IS FALSE AND b.gross_profit IS NOT NULL)), 1) AS first_order_gp,
  ROUND(100 * SAFE_DIVIDE(SUM(IF(b.is_returning_customer IS TRUE, b.revenue, 0)), SUM(b.revenue)), 1) AS returning_rev_share
FROM b
JOIN p ON b.order_date BETWEEN p.d0 AND p.d1
GROUP BY 1, 3, 4
ORDER BY 1, 3, 4
