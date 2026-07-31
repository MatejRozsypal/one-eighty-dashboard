-- 013_seed_fx_usd_czk.sql
-- USD -> CZK monthly rates, so the dashboard's agency-wide CZK rollup can convert
-- Dobias (USD) alongside Manami (CZK). Until this landed `ref.fx_rates` held only
-- CAD->USD, and the dashboard's currency toggle rendered disabled with a padlock.
--
-- Source: CNB "Prumerne kurzy devizoveho trhu - mesicni prumery", USD, quantity 1:
--   https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/prumerne_mena.txt?mena=USD
-- Note that file carries TWO tables -- per-month averages first, cumulative
-- January-to-N averages second. Only the first is wanted; the second silently
-- looks just like it and is wrong by up to ~1%.
--
-- `rate` is CZK per 1 USD, so revenue_usd * rate = revenue_czk.
--
-- Monthly averages, not spot rates -- matching how the CAD->USD rows were seeded
-- and how `dashboard/lib/currency.ts` joins: each daily row is converted at ITS
-- OWN month's rate and only then summed, so a multi-month range is never
-- converted as though one rate held throughout.
--
-- Range 2022-06 .. current month. The floor matches the existing CAD->USD rows;
-- mart data starts 2023-07 (dobias) / 2024-05 (manami), so every selectable
-- range is covered with room to spare.
--
-- !! THE LAST ROW IS PROVISIONAL !!
-- CNB publishes a month's average only once the month has closed, so the current
-- month carries a month-to-date mean of the daily fixings, tagged
-- `source LIKE 'cnb_mtd_avg%'`. When the month closes it must be replaced with
-- the official figure and a new provisional row added -- otherwise the toggle
-- silently disables again the moment a selected range reaches an uncovered month.
-- Procedure: runbooks/23_fx_rates_refresh.md. The Data Health page carries an
-- "FX rates" row so a missed refresh is visible rather than merely disabling
-- the toggle with a message about rates "not being in the warehouse yet".
--
-- Idempotent: MERGE on the natural key, so re-running overwrites a provisional
-- row in place rather than duplicating it.

MERGE `oneeighty-warehouse.ref.fx_rates` T
USING (
  SELECT * FROM UNNEST([
    STRUCT(DATE '2022-06-01' AS month_start, 'USD' AS from_currency, 'CZK' AS to_currency,
           NUMERIC '23.400' AS rate, 'cnb_monthly_avg' AS source),
    STRUCT(DATE '2022-07-01', 'USD', 'CZK', NUMERIC '24.157', 'cnb_monthly_avg'),
    STRUCT(DATE '2022-08-01', 'USD', 'CZK', NUMERIC '24.261', 'cnb_monthly_avg'),
    STRUCT(DATE '2022-09-01', 'USD', 'CZK', NUMERIC '24.778', 'cnb_monthly_avg'),
    STRUCT(DATE '2022-10-01', 'USD', 'CZK', NUMERIC '24.986', 'cnb_monthly_avg'),
    STRUCT(DATE '2022-11-01', 'USD', 'CZK', NUMERIC '23.912', 'cnb_monthly_avg'),
    STRUCT(DATE '2022-12-01', 'USD', 'CZK', NUMERIC '22.921', 'cnb_monthly_avg'),
    STRUCT(DATE '2023-01-01', 'USD', 'CZK', NUMERIC '22.252', 'cnb_monthly_avg'),
    STRUCT(DATE '2023-02-01', 'USD', 'CZK', NUMERIC '22.129', 'cnb_monthly_avg'),
    STRUCT(DATE '2023-03-01', 'USD', 'CZK', NUMERIC '22.123', 'cnb_monthly_avg'),
    STRUCT(DATE '2023-04-01', 'USD', 'CZK', NUMERIC '21.370', 'cnb_monthly_avg'),
    STRUCT(DATE '2023-05-01', 'USD', 'CZK', NUMERIC '21.738', 'cnb_monthly_avg'),
    STRUCT(DATE '2023-06-01', 'USD', 'CZK', NUMERIC '21.860', 'cnb_monthly_avg'),
    STRUCT(DATE '2023-07-01', 'USD', 'CZK', NUMERIC '21.584', 'cnb_monthly_avg'),
    STRUCT(DATE '2023-08-01', 'USD', 'CZK', NUMERIC '22.104', 'cnb_monthly_avg'),
    STRUCT(DATE '2023-09-01', 'USD', 'CZK', NUMERIC '22.813', 'cnb_monthly_avg'),
    STRUCT(DATE '2023-10-01', 'USD', 'CZK', NUMERIC '23.276', 'cnb_monthly_avg'),
    STRUCT(DATE '2023-11-01', 'USD', 'CZK', NUMERIC '22.671', 'cnb_monthly_avg'),
    STRUCT(DATE '2023-12-01', 'USD', 'CZK', NUMERIC '22.457', 'cnb_monthly_avg'),
    STRUCT(DATE '2024-01-01', 'USD', 'CZK', NUMERIC '22.664', 'cnb_monthly_avg'),
    STRUCT(DATE '2024-02-01', 'USD', 'CZK', NUMERIC '23.374', 'cnb_monthly_avg'),
    STRUCT(DATE '2024-03-01', 'USD', 'CZK', NUMERIC '23.261', 'cnb_monthly_avg'),
    STRUCT(DATE '2024-04-01', 'USD', 'CZK', NUMERIC '23.563', 'cnb_monthly_avg'),
    STRUCT(DATE '2024-05-01', 'USD', 'CZK', NUMERIC '22.935', 'cnb_monthly_avg'),
    STRUCT(DATE '2024-06-01', 'USD', 'CZK', NUMERIC '23.032', 'cnb_monthly_avg'),
    STRUCT(DATE '2024-07-01', 'USD', 'CZK', NUMERIC '23.335', 'cnb_monthly_avg'),
    STRUCT(DATE '2024-08-01', 'USD', 'CZK', NUMERIC '22.867', 'cnb_monthly_avg'),
    STRUCT(DATE '2024-09-01', 'USD', 'CZK', NUMERIC '22.598', 'cnb_monthly_avg'),
    STRUCT(DATE '2024-10-01', 'USD', 'CZK', NUMERIC '23.191', 'cnb_monthly_avg'),
    STRUCT(DATE '2024-11-01', 'USD', 'CZK', NUMERIC '23.803', 'cnb_monthly_avg'),
    STRUCT(DATE '2024-12-01', 'USD', 'CZK', NUMERIC '23.979', 'cnb_monthly_avg'),
    STRUCT(DATE '2025-01-01', 'USD', 'CZK', NUMERIC '24.303', 'cnb_monthly_avg'),
    STRUCT(DATE '2025-02-01', 'USD', 'CZK', NUMERIC '24.082', 'cnb_monthly_avg'),
    STRUCT(DATE '2025-03-01', 'USD', 'CZK', NUMERIC '23.137', 'cnb_monthly_avg'),
    STRUCT(DATE '2025-04-01', 'USD', 'CZK', NUMERIC '22.339', 'cnb_monthly_avg'),
    STRUCT(DATE '2025-05-01', 'USD', 'CZK', NUMERIC '22.099', 'cnb_monthly_avg'),
    STRUCT(DATE '2025-06-01', 'USD', 'CZK', NUMERIC '21.539', 'cnb_monthly_avg'),
    STRUCT(DATE '2025-07-01', 'USD', 'CZK', NUMERIC '21.088', 'cnb_monthly_avg'),
    STRUCT(DATE '2025-08-01', 'USD', 'CZK', NUMERIC '21.079', 'cnb_monthly_avg'),
    STRUCT(DATE '2025-09-01', 'USD', 'CZK', NUMERIC '20.753', 'cnb_monthly_avg'),
    STRUCT(DATE '2025-10-01', 'USD', 'CZK', NUMERIC '20.903', 'cnb_monthly_avg'),
    STRUCT(DATE '2025-11-01', 'USD', 'CZK', NUMERIC '20.971', 'cnb_monthly_avg'),
    STRUCT(DATE '2025-12-01', 'USD', 'CZK', NUMERIC '20.725', 'cnb_monthly_avg'),
    STRUCT(DATE '2026-01-01', 'USD', 'CZK', NUMERIC '20.684', 'cnb_monthly_avg'),
    STRUCT(DATE '2026-02-01', 'USD', 'CZK', NUMERIC '20.516', 'cnb_monthly_avg'),
    STRUCT(DATE '2026-03-01', 'USD', 'CZK', NUMERIC '21.141', 'cnb_monthly_avg'),
    STRUCT(DATE '2026-04-01', 'USD', 'CZK', NUMERIC '20.827', 'cnb_monthly_avg'),
    STRUCT(DATE '2026-05-01', 'USD', 'CZK', NUMERIC '20.835', 'cnb_monthly_avg'),
    STRUCT(DATE '2026-06-01', 'USD', 'CZK', NUMERIC '21.020', 'cnb_monthly_avg'),
    -- Provisional: mean of the 21 CNB daily fixings 2026-07-01 .. 2026-07-30.
    STRUCT(DATE '2026-07-01', 'USD', 'CZK', NUMERIC '21.210', 'cnb_mtd_avg@2026-07-30')
  ])
) S
ON  T.month_start   = S.month_start
AND T.from_currency = S.from_currency
AND T.to_currency   = S.to_currency
WHEN NOT MATCHED THEN INSERT (month_start, from_currency, to_currency, rate, source, ingested_at)
  VALUES (S.month_start, S.from_currency, S.to_currency, S.rate, S.source, CURRENT_TIMESTAMP())
WHEN MATCHED THEN UPDATE SET rate = S.rate, source = S.source, ingested_at = CURRENT_TIMESTAMP();
