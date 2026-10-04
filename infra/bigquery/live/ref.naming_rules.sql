CREATE TABLE `oneeighty-warehouse.ref.naming_rules`
(
  client_id STRING NOT NULL,
  platform STRING NOT NULL,
  entity STRING NOT NULL,
  dimension STRING NOT NULL,
  pattern STRING NOT NULL,
  value STRING,
  priority INT64 NOT NULL,
  note STRING,
  updated_at TIMESTAMP NOT NULL
)
CLUSTER BY client_id;
