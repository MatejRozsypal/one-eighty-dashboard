CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_daily` AS
SELECT
  client_id,
  order_date                                                        AS date,
  COUNT(DISTINCT order_id)                                          AS orders,
  COUNTIF(is_returning_customer IS FALSE)                           AS new_customer_orders,
  COUNTIF(is_returning_customer IS TRUE)                            AS returning_customer_orders,
  COUNTIF(is_returning_customer IS NULL)                            AS unknown_orders,
  SUM(revenue)                                                      AS revenue,
  SUM(IF(is_returning_customer IS FALSE, revenue, 0))               AS new_customer_revenue,
  SUM(IF(is_returning_customer IS TRUE,  revenue, 0))               AS returning_customer_revenue,
  SUM(net_sales)                                                    AS net_sales,
  SUM(IF(is_returning_customer IS FALSE, net_sales, 0))             AS new_customer_net_sales,
  SUM(IF(is_returning_customer IS TRUE,  net_sales, 0))             AS returning_customer_net_sales,
  SAFE_DIVIDE(COUNTIF(is_returning_customer IS FALSE),
              COUNT(DISTINCT order_id)) * 100                       AS new_customer_pct,
  SAFE_DIVIDE(SUM(net_sales), COUNT(DISTINCT order_id))             AS aov,
  SAFE_DIVIDE(SUM(IF(is_returning_customer IS FALSE, net_sales, 0)),
              NULLIF(COUNTIF(is_returning_customer IS FALSE), 0))   AS aov_new,
  SAFE_DIVIDE(SUM(IF(is_returning_customer IS TRUE,  net_sales, 0)),
              NULLIF(COUNTIF(is_returning_customer IS TRUE), 0))    AS aov_returning
FROM `oneeighty-warehouse.stg.stg_customer_orders`
WHERE platform IN ('shopify', 'woocommerce')
  AND order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
GROUP BY client_id, order_date;
