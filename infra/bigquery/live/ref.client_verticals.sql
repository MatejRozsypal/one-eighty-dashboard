CREATE TABLE `oneeighty-warehouse.ref.client_verticals`
(
  client_id STRING NOT NULL,
  vertical STRING NOT NULL,
  sub_vertical STRING,
  region STRING NOT NULL,
  valid_from DATE NOT NULL,
  valid_to DATE,
  note STRING,
  updated_by STRING NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP() NOT NULL
)
OPTIONS(
  description="Client to vertical mapping for benchmark matching in the Reports suite. At most one open row (valid_to IS NULL) per client. See runbooks/31_reporting_benchmarks.md."
);
