CREATE TABLE `oneeighty-warehouse.stg.ga4_sessions`
(
  client_id STRING NOT NULL,
  property_id STRING NOT NULL,
  date DATE NOT NULL,
  session_key INT64 NOT NULL,
  session_kind STRING NOT NULL,
  session_start_ts TIMESTAMP,
  channel_group STRING,
  source STRING,
  medium STRING,
  campaign_name STRING,
  campaign_id STRING,
  gads_customer_id STRING,
  gads_campaign_id STRING,
  platform STRING NOT NULL,
  landing_path STRING,
  device STRING,
  country STRING,
  engaged BOOL,
  has_view_item BOOL,
  has_add_to_cart BOOL,
  has_begin_checkout BOOL,
  has_purchase BOOL,
  purchases INT64,
  revenue NUMERIC,
  revenue_usd NUMERIC,
  currency STRING,
  loaded_at TIMESTAMP NOT NULL
)
PARTITION BY date
CLUSTER BY client_id
OPTIONS(
  description="Derived. One row per GA4 session (plus one row per purchase that arrived without a session id). Written by ops.sp_load_ga4_sessions, never by n8n. Do not write by hand."
);
