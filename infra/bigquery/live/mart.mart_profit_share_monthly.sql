CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_profit_share_monthly` AS
SELECT
  m.client_id,
  m.month,
  m.cm3,
  DATE_SUB(m.month, INTERVAL 12 MONTH) AS baseline_month,
  b.cm3                                AS baseline_cm3,
  m.cm3 - b.cm3                        AS cm3_delta,
  c.profit_share_pct,
  IF(m.is_complete AND b.cm3 IS NOT NULL,
     GREATEST(m.cm3 - b.cm3, 0) * c.profit_share_pct,
     NULL) AS profit_share_czk,
  m.is_complete,
  m.incomplete_reason,
  b.cm3 IS NOT NULL AS has_frozen_baseline,
  m.revenue_net, m.cogs, m.fulfillment, m.media_spend, m.orders
FROM `oneeighty-warehouse.mart.mart_cm3_monthly` m
JOIN `oneeighty-warehouse.ref.contracts` c
  ON c.client_id = m.client_id
 AND c.valid_from <= CURRENT_DATE()
 AND (c.valid_to IS NULL OR c.valid_to >= CURRENT_DATE())
LEFT JOIN `oneeighty-warehouse.ref.cm3_baseline` b
  ON b.client_id = m.client_id
 AND b.month     = DATE_SUB(m.month, INTERVAL 12 MONTH)
WHERE m.month >= DATE_TRUNC(c.contract_start_date, MONTH);
