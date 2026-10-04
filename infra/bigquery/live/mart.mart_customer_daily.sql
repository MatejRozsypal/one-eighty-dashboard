CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_daily` AS
SELECT
  client_id,
  order_date                                                        AS date,
  COUNT(DISTINCT order_id)                                          AS orders,
  COUNTIF(is_returning_customer IS FALSE)                           AS new_customer_orders,
  COUNTIF(is_returning_customer IS TRUE)                            AS returning_customer_orders,
  COUNTIF(is_returning_customer IS NULL)                            AS unknown_orders,
  SUM(subtotal_price + COALESCE(total_shipping, 0))                 AS revenue,
  SUM(IF(is_returning_customer IS FALSE,
         subtotal_price + COALESCE(total_shipping, 0), 0))          AS new_customer_revenue,
  SUM(IF(is_returning_customer IS TRUE,
         subtotal_price + COALESCE(total_shipping, 0), 0))          AS returning_customer_revenue,
  SUM(subtotal_price)                                               AS net_sales,
  SUM(IF(is_returning_customer IS FALSE, subtotal_price, 0))        AS new_customer_net_sales,
  SUM(IF(is_returning_customer IS TRUE,  subtotal_price, 0))        AS returning_customer_net_sales,
  SAFE_DIVIDE(COUNTIF(is_returning_customer IS FALSE),
              COUNT(DISTINCT order_id)) * 100                       AS new_customer_pct,
  SAFE_DIVIDE(SUM(subtotal_price), COUNT(DISTINCT order_id))        AS aov,
  SAFE_DIVIDE(SUM(IF(is_returning_customer IS FALSE, subtotal_price, 0)),
              NULLIF(COUNTIF(is_returning_customer IS FALSE), 0))   AS aov_new,
  SAFE_DIVIDE(SUM(IF(is_returning_customer IS TRUE,  subtotal_price, 0)),
              NULLIF(COUNTIF(is_returning_customer IS TRUE), 0))    AS aov_returning
FROM `oneeighty-warehouse.stg.stg_shopify_orders`
WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
GROUP BY client_id, order_date;
