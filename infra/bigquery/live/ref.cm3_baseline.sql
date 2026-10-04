CREATE TABLE `oneeighty-warehouse.ref.cm3_baseline`
(
  client_id STRING NOT NULL,
  month DATE NOT NULL,
  revenue_net NUMERIC,
  gross_margin NUMERIC,
  cm1 NUMERIC,
  cm2 NUMERIC,
  cm3 NUMERIC,
  frozen_at TIMESTAMP,
  source_query_hash STRING,
  approved_by STRING,
  approved_at TIMESTAMP
)
OPTIONS(
  description="The agreed baseline CM3 per month, frozen once from mart_cm3_monthly. Never UPDATEd: a changed baseline means a new ref.contracts version and a fresh freeze, so any statement ever issued can be reproduced. The contract does not define CM1 or CM2; they are recorded here because the margin stack is what makes a disputed CM3 explainable."
);
