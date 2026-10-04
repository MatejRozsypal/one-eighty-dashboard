CREATE TABLE `oneeighty-warehouse.ops.feed_freshness`
(
  checked_at TIMESTAMP NOT NULL,
  client_id STRING NOT NULL,
  feed_key STRING NOT NULL,
  source STRING,
  table_ref STRING,
  last_ingested_at TIMESTAMP,
  staleness_hours FLOAT64,
  max_staleness_hours INT64,
  severity STRING,
  status STRING NOT NULL,
  rows_last_24h INT64
)
PARTITION BY DATE(checked_at)
CLUSTER BY status, client_id
OPTIONS(
  require_partition_filter=true,
  description="Freshness observations measured from the destination tables themselves. Append-only history; ops.v_feed_health reads the latest check."
);
