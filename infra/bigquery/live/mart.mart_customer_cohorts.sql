CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_cohorts` AS
SELECT
  client_id,
  DATE_TRUNC(first_order_date, MONTH) AS cohort_month,
  currency,
  COUNT(*)                              AS customer_count,
  COUNTIF(is_y1_complete)               AS y1_complete_customers,
  -- Lifetime aggregates
  SUM(lifetime_revenue)                 AS cohort_total_revenue,
  SUM(lifetime_gross_profit)            AS cohort_total_gross_profit,
  SUM(total_orders)                     AS cohort_total_orders,
  ROUND(AVG(lifetime_revenue), 2)       AS ltv,
  ROUND(AVG(lifetime_gross_profit), 2)  AS ltgp,
  ROUND(AVG(total_orders), 2)           AS avg_orders_per_customer,
  -- Y1 aggregates (only meaningful for customers where is_y1_complete = TRUE)
  -- Use AVG_IF to exclude immature customers automatically
  ROUND(AVG(IF(is_y1_complete, y1_revenue, NULL)), 2)        AS y1_ltv,
  ROUND(AVG(IF(is_y1_complete, y1_gross_profit, NULL)), 2)   AS y1_ltgp,
  ROUND(AVG(IF(is_y1_complete, y1_orders, NULL)), 2)         AS y1_orders_per_customer,
  -- Returning behavior
  COUNTIF(is_returning)                                      AS returning_customers,
  SAFE_DIVIDE(COUNTIF(is_returning), COUNT(*)) * 100         AS cohort_repeat_rate_pct
FROM `oneeighty-warehouse.mart.mart_customer_lifetime`
GROUP BY client_id, cohort_month, currency;
