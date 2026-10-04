CREATE TABLE `oneeighty-warehouse.ref.client_monthly_costs`
(
  client_id STRING NOT NULL,
  month DATE NOT NULL,
  cost_type STRING NOT NULL,
  amount_czk NUMERIC NOT NULL,
  source STRING,
  note STRING,
  updated_at TIMESTAMP
)
OPTIONS(
  description="Manual monthly fulfillment costs that no e-shop API exposes -- storage above all. Ex VAT, CZK. A month with no row here is treated as unknown, not as zero, and marks that month incomplete."
);
