CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_monthly_kpis` AS
WITH monthly AS (
  SELECT client_id, DATE_TRUNC(date, MONTH) AS month_start, currency,
    SUM(revenue) AS revenue,
    SUM(new_customer_revenue) AS new_customer_revenue,
    SUM(returning_customer_revenue) AS returning_customer_revenue,
    SUM(net_sales) AS net_sales,
    SUM(new_customer_net_sales) AS new_customer_net_sales,
    SUM(returning_customer_net_sales) AS returning_customer_net_sales,
    SUM(shipping_revenue) AS shipping_revenue,
    SUM(tax_collected) AS tax_collected,
    SUM(gross_revenue_incl_tax) AS gross_revenue_incl_tax,
    SUM(cogs) AS cogs,
    SUM(cm1_other_costs) AS cm1_other_costs,
    SUM(fulfillment_cost) AS fulfillment_cost,
    SUM(cm1) AS cm1, SUM(cm2) AS cm2, SUM(cm3) AS cm3,
    SUM(orders) AS orders,
    SUM(new_customer_orders) AS new_customer_orders,
    SUM(returning_customer_orders) AS returning_customer_orders,
    SUM(unique_customers) AS unique_customers_sum_of_daily,
    SUM(meta_spend) AS meta_spend,
    SUM(meta_revenue) AS meta_revenue,
    SUM(meta_purchases) AS meta_purchases,
    SUM(meta_impressions) AS meta_impressions,
    SUM(meta_clicks) AS meta_clicks,
    SUM(meta_reach) AS meta_reach,
    SUM(google_spend) AS google_spend,
    SUM(google_revenue) AS google_revenue,
    SUM(google_purchases) AS google_purchases,
    SUM(google_impressions) AS google_impressions,
    SUM(google_clicks) AS google_clicks,
    SUM(paid_spend) AS paid_spend
  FROM `oneeighty-warehouse.mart.mart_daily_kpis`
  GROUP BY client_id, month_start, currency
)
SELECT m.*,
  LAG(m.new_customer_orders)  OVER w  AS prev_month_new_customer_orders,
  LAG(m.new_customer_revenue) OVER w  AS prev_month_new_customer_revenue,
  LAG(m.revenue)              OVER w  AS prev_month_revenue,
  SAFE_DIVIDE(m.new_customer_orders,  LAG(m.new_customer_orders)  OVER w) - 1 AS mom_new_customer_orders_pct,
  SAFE_DIVIDE(m.new_customer_revenue, LAG(m.new_customer_revenue) OVER w) - 1 AS mom_new_customer_revenue_pct,
  SAFE_DIVIDE(m.revenue,              LAG(m.revenue)              OVER w) - 1 AS mom_revenue_pct
FROM monthly m
WINDOW w AS (PARTITION BY client_id, currency ORDER BY month_start);
