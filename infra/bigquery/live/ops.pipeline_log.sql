CREATE TABLE `oneeighty-warehouse.ops.pipeline_log`
(
  run_id STRING NOT NULL,
  workflow STRING NOT NULL,
  client_id STRING,
  source STRING,
  started_at TIMESTAMP NOT NULL,
  finished_at TIMESTAMP,
  duration_seconds INT64,
  status STRING NOT NULL,
  rows_loaded INT64,
  bytes_loaded INT64,
  error_msg STRING,
  retry_count INT64 DEFAULT 0,
  trigger STRING,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(started_at)
CLUSTER BY workflow, client_id
OPTIONS(
  require_partition_filter=true,
  description="Every n8n workflow run logs here. wf_health_check reads this daily and emails on failures."
);
