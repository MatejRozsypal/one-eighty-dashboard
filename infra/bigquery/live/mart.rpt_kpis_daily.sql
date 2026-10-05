CREATE TABLE `oneeighty-warehouse.mart.rpt_kpis_daily`
(
  client_id STRING,
  date DATE,
  currency STRING,
  revenue NUMERIC,
  new_customer_revenue NUMERIC,
  returning_customer_revenue NUMERIC,
  net_sales NUMERIC,
  new_customer_net_sales NUMERIC,
  returning_customer_net_sales NUMERIC,
  shipping_revenue NUMERIC,
  tax_collected NUMERIC,
  gross_revenue_incl_tax NUMERIC,
  cogs NUMERIC,
  orders INT64,
  unique_customers INT64,
  new_customer_orders INT64,
  returning_customer_orders INT64,
  meta_spend NUMERIC,
  meta_revenue NUMERIC,
  meta_purchases INT64,
  meta_impressions INT64,
  meta_clicks INT64,
  meta_reach INT64,
  google_spend FLOAT64,
  google_revenue FLOAT64,
  google_purchases FLOAT64,
  google_impressions INT64,
  google_clicks INT64,
  paid_spend NUMERIC,
  cm1_other_costs NUMERIC,
  fulfillment_cost NUMERIC,
  cm1 NUMERIC,
  cm2 NUMERIC,
  cm3 NUMERIC,
  refreshed_at TIMESTAMP
)
PARTITION BY DATE_TRUNC(date, MONTH)
CLUSTER BY client_id, date
OPTIONS(
  description="Materialised mart.mart_daily_kpis for Reports (same 34 columns + refreshed_at). Rebuilt hourly by mart.sp_refresh_rpt_kpis (n8n \"BQ: refresh rpt_kpis_daily\"). Lags the view by up to 1 hour. Migration 253."
);
