CREATE TABLE `oneeighty-warehouse.ref.campaign_overrides`
(
  client_id STRING NOT NULL,
  platform STRING NOT NULL,
  campaign_id STRING NOT NULL,
  funnel_stage STRING,
  brand_class STRING,
  market STRING,
  note STRING,
  updated_at TIMESTAMP NOT NULL
)
CLUSTER BY client_id;
