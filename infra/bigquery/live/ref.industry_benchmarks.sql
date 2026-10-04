CREATE TABLE `oneeighty-warehouse.ref.industry_benchmarks`
(
  benchmark_id STRING NOT NULL,
  vertical STRING NOT NULL,
  region STRING NOT NULL,
  metric_id STRING NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  stat STRING NOT NULL,
  value NUMERIC NOT NULL,
  value_low NUMERIC,
  value_high NUMERIC,
  currency STRING,
  source STRING NOT NULL,
  source_url STRING,
  as_of DATE NOT NULL,
  definition_note STRING,
  sample_note STRING,
  note STRING,
  is_active BOOL DEFAULT TRUE NOT NULL,
  entered_by STRING NOT NULL,
  entered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP() NOT NULL
)
CLUSTER BY vertical, metric_id
OPTIONS(
  description="Manually maintained industry benchmarks for the Reports suite. One row per vertical x region x metric x period x stat x source. Never invent values; cite source and as_of. See runbooks/31_reporting_benchmarks.md."
);
