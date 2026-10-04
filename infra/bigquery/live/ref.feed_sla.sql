CREATE TABLE `oneeighty-warehouse.ref.feed_sla`
(
  feed_key STRING NOT NULL,
  source STRING NOT NULL,
  flag_column STRING NOT NULL,
  table_ref STRING NOT NULL,
  max_staleness_hours INT64 NOT NULL,
  severity STRING NOT NULL,
  is_active BOOL NOT NULL,
  notes STRING
)
OPTIONS(
  description="Declared expectation for every ingest feed. Joined against ref.clients flags to derive which (client, feed) pairs must be fresh. Edit this table to change an SLA - no code change."
);
