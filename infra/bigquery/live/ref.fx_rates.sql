CREATE TABLE `oneeighty-warehouse.ref.fx_rates`
(
  month_start DATE NOT NULL,
  from_currency STRING NOT NULL,
  to_currency STRING NOT NULL,
  rate NUMERIC NOT NULL,
  source STRING,
  ingested_at TIMESTAMP NOT NULL
)
CLUSTER BY from_currency, to_currency;
