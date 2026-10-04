CREATE TABLE `oneeighty-warehouse.ops.profit_share_statements`
(
  statement_id STRING NOT NULL,
  client_id STRING NOT NULL,
  month DATE NOT NULL,
  status STRING NOT NULL,
  revenue_net NUMERIC,
  cogs NUMERIC,
  fulfillment NUMERIC,
  media_spend NUMERIC,
  cm3 NUMERIC,
  baseline_cm3 NUMERIC,
  cm3_delta NUMERIC,
  profit_share_pct NUMERIC,
  profit_share_czk NUMERIC,
  is_complete BOOL,
  incomplete_reason STRING,
  generated_at TIMESTAMP,
  sent_at TIMESTAMP,
  approved_at TIMESTAMP,
  approved_by STRING,
  note STRING
)
PARTITION BY month
CLUSTER BY client_id
OPTIONS(
  description="Frozen monthly profit-share statements. Once a statement is approved its figures never change: later data corrections are reported as an adjustment line on a subsequent statement, not by rewriting a statement the client has already agreed to."
);
