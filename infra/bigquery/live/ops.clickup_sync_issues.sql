CREATE TABLE `oneeighty-warehouse.ops.clickup_sync_issues`
(
  synced_at TIMESTAMP NOT NULL,
  client_id STRING,
  severity STRING,
  kind STRING,
  entity_id STRING,
  detail STRING
)
PARTITION BY DATE(synced_at)
OPTIONS(
  description="Everything the ClickUp sync declined to resolve by guessing."
);
