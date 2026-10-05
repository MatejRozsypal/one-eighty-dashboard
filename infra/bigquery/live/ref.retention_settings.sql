CREATE TABLE `oneeighty-warehouse.ref.retention_settings`
(
  client_id STRING NOT NULL,
  data_start_date DATE OPTIONS(description="First day of complete order history. NULL = the client's earliest valid order."),
  history_guard_days INT64 NOT NULL OPTIONS(description="Customers whose first order is before data_start_date + this many days are flagged is_early (they may be returning customers from before the data start). 0 = history complete."),
  sync_lag_days INT64 NOT NULL OPTIONS(description="cutoff_date = yesterday in the client time zone minus this many days. Buffer for late syncs and late cancellations."),
  primary_horizon_days INT64 NOT NULL OPTIONS(description="Headline horizon in days for the Repeat rate page."),
  note STRING,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
OPTIONS(
  description="Retention settings per client, optional. A client without a row uses data_start_date NULL, history_guard_days 0, sync_lag_days 3, primary_horizon_days 90. Read by mart.sp_refresh_rpt_customer_entry. Migration 257."
);
