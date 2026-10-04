CREATE TABLE `oneeighty-warehouse.ref.contracts`
(
  client_id STRING NOT NULL,
  contract_start_date DATE,
  retainer_czk NUMERIC,
  profit_share_pct NUMERIC,
  baseline_from DATE,
  baseline_to DATE,
  media_channels ARRAY<STRING>,
  valid_from DATE NOT NULL,
  valid_to DATE,
  note STRING,
  updated_at TIMESTAMP
)
OPTIONS(
  description="Commercial terms per client, versioned by valid_from/valid_to. Renegotiating means a new row, never an UPDATE, so an already-issued statement can always be reproduced from the terms that applied at the time."
);
