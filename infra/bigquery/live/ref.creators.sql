CREATE TABLE `oneeighty-warehouse.ref.creators`
(
  client_id STRING,
  creator_id STRING,
  name STRING,
  creator_type STRING,
  pay_model STRING,
  rate NUMERIC,
  deliverables_per_shoot INT64,
  product_cogs NUMERIC,
  usage_fee NUMERIC,
  rev_share_pct NUMERIC,
  active BOOL,
  synced_at TIMESTAMP
);
