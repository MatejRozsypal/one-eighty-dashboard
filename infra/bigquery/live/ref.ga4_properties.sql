CREATE TABLE `oneeighty-warehouse.ref.ga4_properties`
(
  client_id STRING NOT NULL,
  property_id STRING NOT NULL,
  dataset_id STRING NOT NULL,
  hostname_pattern STRING,
  is_primary BOOL NOT NULL,
  valid_from DATE,
  valid_to DATE,
  note STRING,
  updated_at TIMESTAMP NOT NULL
)
CLUSTER BY client_id
OPTIONS(
  description="GA4 BigQuery export registry. One row per property. Read by ops.sp_load_ga4_sessions. To add a property see runbooks/30_ga4_sessions.md."
);
