CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_payback` AS
WITH orders AS (
  SELECT platform, client_id, customer_key, order_date, gross_profit, currency
  FROM `oneeighty-warehouse.stg.stg_customer_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
    AND customer_key IS NOT NULL
),
first_order AS (
  SELECT client_id, customer_key, MIN(order_date) AS first_order_date,
         ANY_VALUE(currency) AS currency
  FROM orders GROUP BY 1, 2
),
per_customer AS (
  SELECT
    f.client_id,
    f.customer_key,
    f.currency,
    f.first_order_date,
    DATE_ADD(f.first_order_date, INTERVAL 30 DAY) < CURRENT_DATE() AS d30_complete,
    DATE_ADD(f.first_order_date, INTERVAL 90 DAY) < CURRENT_DATE() AS d90_complete,
    -- WooCommerce: a customer with no costed order in the window has NULL
    -- gross profit, never 0 (rawbark has no cost data at all). Shopify and
    -- Shoptet keep the live behaviour (an uncosted order adds 0) byte for byte;
    -- that latent zero is logged as a separate item, not changed here.
    IF(LOGICAL_AND(o.platform = 'woocommerce')
         AND COUNTIF(o.order_date <= DATE_ADD(f.first_order_date, INTERVAL 30 DAY)
                     AND o.gross_profit IS NOT NULL) = 0,
       NULL,
       SUM(IF(o.order_date <= DATE_ADD(f.first_order_date, INTERVAL 30 DAY), o.gross_profit, 0))) AS gp_30,
    IF(LOGICAL_AND(o.platform = 'woocommerce')
         AND COUNTIF(o.order_date <= DATE_ADD(f.first_order_date, INTERVAL 90 DAY)
                     AND o.gross_profit IS NOT NULL) = 0,
       NULL,
       SUM(IF(o.order_date <= DATE_ADD(f.first_order_date, INTERVAL 90 DAY), o.gross_profit, 0))) AS gp_90
  FROM first_order f
  JOIN orders o ON o.client_id = f.client_id AND o.customer_key = f.customer_key
  -- customer_key MUST be in this grouping. Without it the CTE groups by cohort
  -- DATE, the outer COUNTIF then counts dates instead of customers, and every
  -- per-customer average is inflated by roughly the number of customers per
  -- day. Manami read 2,607 CZK of 30-day gross profit against a sub-1,000 CZK
  -- AOV before this was caught.
  GROUP BY 1, 2, 3, 4, 5, 6
)
SELECT
  client_id, currency, first_order_date AS cohort_date,
  COUNTIF(d30_complete) AS customers_30d_complete,
  COUNTIF(d90_complete) AS customers_90d_complete,
  SUM(IF(d30_complete, gp_30, NULL)) AS gross_profit_30d,
  SUM(IF(d90_complete, gp_90, NULL)) AS gross_profit_90d,
  SUM(IF(d90_complete, gp_30, NULL)) AS gross_profit_30d_of_90d_cohort
FROM per_customer
GROUP BY 1, 2, 3;
