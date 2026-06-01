-- 012_create_ref_fx_rates.sql
-- Foreign exchange rates table for currency conversion.
-- One row per (month_start, from_currency, to_currency).
--
-- Initially populated for CAD→USD monthly rates June 2022 → May 2026 to support
-- Dobias's Canadian-store historical data that was migrated to the US Shopify
-- store in March 2026. Source: manually entered from Bank of Canada monthly
-- exchange rates.
--
-- Future-compatible for additional currency pairs (e.g., CZK→EUR, EUR→USD).
-- Use DATE_TRUNC(date_column, MONTH) when joining to map an order/event to
-- the rate for its month.

CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.fx_rates` (
  month_start    DATE     NOT NULL,
  from_currency  STRING   NOT NULL,
  to_currency    STRING   NOT NULL,
  rate           NUMERIC  NOT NULL,
  source         STRING,
  ingested_at    TIMESTAMP NOT NULL
)
CLUSTER BY from_currency, to_currency;

-- Initial seed: CAD → USD, June 2022 – May 2026 (48 months)
-- Run via MERGE for idempotency
MERGE `oneeighty-warehouse.ref.fx_rates` T
USING (
  SELECT * FROM UNNEST([
    STRUCT(DATE '2022-06-01' AS month_start, 'CAD' AS from_currency, 'USD' AS to_currency, NUMERIC '0.7805' AS rate),
    STRUCT(DATE '2022-07-01', 'CAD', 'USD', NUMERIC '0.7727'),
    STRUCT(DATE '2022-08-01', 'CAD', 'USD', NUMERIC '0.7739'),
    STRUCT(DATE '2022-09-01', 'CAD', 'USD', NUMERIC '0.7511'),
    STRUCT(DATE '2022-10-01', 'CAD', 'USD', NUMERIC '0.7300'),
    STRUCT(DATE '2022-11-01', 'CAD', 'USD', NUMERIC '0.7436'),
    STRUCT(DATE '2022-12-01', 'CAD', 'USD', NUMERIC '0.7357'),
    STRUCT(DATE '2023-01-01', 'CAD', 'USD', NUMERIC '0.7451'),
    STRUCT(DATE '2023-02-01', 'CAD', 'USD', NUMERIC '0.7435'),
    STRUCT(DATE '2023-03-01', 'CAD', 'USD', NUMERIC '0.7309'),
    STRUCT(DATE '2023-04-01', 'CAD', 'USD', NUMERIC '0.7416'),
    STRUCT(DATE '2023-05-01', 'CAD', 'USD', NUMERIC '0.7397'),
    STRUCT(DATE '2023-06-01', 'CAD', 'USD', NUMERIC '0.7526'),
    STRUCT(DATE '2023-07-01', 'CAD', 'USD', NUMERIC '0.7568'),
    STRUCT(DATE '2023-08-01', 'CAD', 'USD', NUMERIC '0.7416'),
    STRUCT(DATE '2023-09-01', 'CAD', 'USD', NUMERIC '0.7389'),
    STRUCT(DATE '2023-10-01', 'CAD', 'USD', NUMERIC '0.7291'),
    STRUCT(DATE '2023-11-01', 'CAD', 'USD', NUMERIC '0.7294'),
    STRUCT(DATE '2023-12-01', 'CAD', 'USD', NUMERIC '0.7446'),
    STRUCT(DATE '2024-01-01', 'CAD', 'USD', NUMERIC '0.7449'),
    STRUCT(DATE '2024-02-01', 'CAD', 'USD', NUMERIC '0.7407'),
    STRUCT(DATE '2024-03-01', 'CAD', 'USD', NUMERIC '0.7386'),
    STRUCT(DATE '2024-04-01', 'CAD', 'USD', NUMERIC '0.7314'),
    STRUCT(DATE '2024-05-01', 'CAD', 'USD', NUMERIC '0.7315'),
    STRUCT(DATE '2024-06-01', 'CAD', 'USD', NUMERIC '0.7296'),
    STRUCT(DATE '2024-07-01', 'CAD', 'USD', NUMERIC '0.7293'),
    STRUCT(DATE '2024-08-01', 'CAD', 'USD', NUMERIC '0.7326'),
    STRUCT(DATE '2024-09-01', 'CAD', 'USD', NUMERIC '0.7382'),
    STRUCT(DATE '2024-10-01', 'CAD', 'USD', NUMERIC '0.7271'),
    STRUCT(DATE '2024-11-01', 'CAD', 'USD', NUMERIC '0.7156'),
    STRUCT(DATE '2024-12-01', 'CAD', 'USD', NUMERIC '0.7023'),
    STRUCT(DATE '2025-01-01', 'CAD', 'USD', NUMERIC '0.6949'),
    STRUCT(DATE '2025-02-01', 'CAD', 'USD', NUMERIC '0.6993'),
    STRUCT(DATE '2025-03-01', 'CAD', 'USD', NUMERIC '0.6964'),
    STRUCT(DATE '2025-04-01', 'CAD', 'USD', NUMERIC '0.7150'),
    STRUCT(DATE '2025-05-01', 'CAD', 'USD', NUMERIC '0.7215'),
    STRUCT(DATE '2025-06-01', 'CAD', 'USD', NUMERIC '0.7313'),
    STRUCT(DATE '2025-07-01', 'CAD', 'USD', NUMERIC '0.7304'),
    STRUCT(DATE '2025-08-01', 'CAD', 'USD', NUMERIC '0.7245'),
    STRUCT(DATE '2025-09-01', 'CAD', 'USD', NUMERIC '0.7229'),
    STRUCT(DATE '2025-10-01', 'CAD', 'USD', NUMERIC '0.7147'),
    STRUCT(DATE '2025-11-01', 'CAD', 'USD', NUMERIC '0.7115'),
    STRUCT(DATE '2025-12-01', 'CAD', 'USD', NUMERIC '0.7245'),
    STRUCT(DATE '2026-01-01', 'CAD', 'USD', NUMERIC '0.7258'),
    STRUCT(DATE '2026-02-01', 'CAD', 'USD', NUMERIC '0.7326'),
    STRUCT(DATE '2026-03-01', 'CAD', 'USD', NUMERIC '0.7291'),
    STRUCT(DATE '2026-04-01', 'CAD', 'USD', NUMERIC '0.7273'),
    STRUCT(DATE '2026-05-01', 'CAD', 'USD', NUMERIC '0.7287')
  ])
) S
ON T.month_start = S.month_start AND T.from_currency = S.from_currency AND T.to_currency = S.to_currency
WHEN NOT MATCHED THEN INSERT (month_start, from_currency, to_currency, rate, source, ingested_at)
  VALUES (S.month_start, S.from_currency, S.to_currency, S.rate, 'manual_entry_2026-05-25', CURRENT_TIMESTAMP())
WHEN MATCHED THEN UPDATE SET rate = S.rate, ingested_at = CURRENT_TIMESTAMP();
