CREATE TABLE `oneeighty-warehouse.ops.access_log`
(
  access_id STRING NOT NULL,
  user_email STRING NOT NULL,
  user_role STRING,
  client_id_scope STRING,
  query_type STRING,
  resource STRING,
  ip_address STRING,
  user_agent STRING,
  accessed_at TIMESTAMP NOT NULL,
  query_duration_ms INT64,
  rows_returned INT64
)
PARTITION BY DATE(accessed_at)
CLUSTER BY user_email, client_id_scope
OPTIONS(
  require_partition_filter=true,
  description="Frontend audit log. Every authenticated query against the dashboard lands here."
);
