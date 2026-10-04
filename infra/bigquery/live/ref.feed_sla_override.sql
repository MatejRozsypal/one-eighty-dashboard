CREATE TABLE `oneeighty-warehouse.ref.feed_sla_override`
(
  client_id STRING NOT NULL,
  feed_key STRING NOT NULL,
  max_staleness_hours INT64 NOT NULL,
  reason STRING
)
OPTIONS(
  description="Per-client staleness overrides. Takes precedence over ref.feed_sla.max_staleness_hours."
);
