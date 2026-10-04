CREATE TABLE `oneeighty-warehouse.ref.clickup_field_map`
(
  client_id STRING NOT NULL,
  list_kind STRING NOT NULL,
  logical STRING NOT NULL,
  field_id STRING NOT NULL,
  field_type STRING NOT NULL,
  ambiguous_with STRING,
  synced_at TIMESTAMP
)
OPTIONS(
  description="Logical field name to ClickUp custom-field UUID. Refreshed every sync; ambiguity is recorded, never resolved by guessing."
);
