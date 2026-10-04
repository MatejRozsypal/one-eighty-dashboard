CREATE TABLE `oneeighty-warehouse.ref.clickup_lists`
(
  client_id STRING NOT NULL,
  list_kind STRING NOT NULL,
  list_id STRING NOT NULL,
  folder_id STRING,
  active BOOL NOT NULL
)
OPTIONS(
  description="Maps each client to its ClickUp ad pipeline, concept and persona lists."
);
