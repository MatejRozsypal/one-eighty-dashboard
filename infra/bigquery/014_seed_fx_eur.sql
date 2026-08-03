-- 014_seed_fx_eur.sql
-- EUR<->CZK monthly rates. Venev sells in EUR while its Meta ad account bills in
-- CZK, so both directions are needed: EUR->CZK to fold Venev into the agency-wide
-- CZK rollup, CZK->EUR to express its Meta spend in the currency the rest of its
-- P&L is denominated in. Without these the currency toggle is padlocked for Venev
-- and every cross-currency figure (CM2, CM3, MER, aMER, CAC) is arithmetic across
-- two currencies.
--
-- Source: CNB "Prumerne kurzy devizoveho trhu - mesicni prumery", EUR, quantity 1:
--   https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/prumerne_mena.txt?mena=EUR
-- Same two-table trap as migration 013 -- per-month averages first, cumulative
-- January-to-N second, near-identical header. The generator asserts the third
-- header column is exactly `leden` and stops at the blank line.
--
-- `rate` is CZK per 1 EUR, so revenue_eur * rate = revenue_czk.
--
-- The CZK->EUR direction is DERIVED as 1/rate at 9dp, not published by CNB, so
-- its rows are tagged `..._inverse`. The suffix is appended rather than replacing
-- the tag so the provisional check in runbook 23 (`source LIKE 'cnb_mtd_avg%'`)
-- still matches the derived rows.
--
-- Range 2022-06 .. current month, matching the floor of the existing USD->CZK and
-- CAD->USD rows. Venev's Shopify store opened 2022-06-24, so its entire history
-- is covered.
--
-- !! THE LAST ROW OF EACH PAIR IS PROVISIONAL !!  CNB publishes a month's average
-- only once the month closes. Replace it when it does -- runbooks/23_fx_rates_refresh.md.
--
-- This file also carries the current month's USD->CZK row, which was missing:
-- migration 013 stopped at 2026-07, so from 1 August the dashboard's currency
-- toggle was silently padlocked for any range touching this month.
--
-- Idempotent: MERGE on the natural key.

MERGE `oneeighty-warehouse.ref.fx_rates` T
USING (
  WITH eur AS (
    SELECT * FROM UNNEST([
      STRUCT(DATE '2022-06-01' AS month_start, NUMERIC '24.719' AS rate, 'cnb_monthly_avg' AS source),
      STRUCT(DATE '2022-07-01', NUMERIC '24.577', 'cnb_monthly_avg'),
      STRUCT(DATE '2022-08-01', NUMERIC '24.568', 'cnb_monthly_avg'),
      STRUCT(DATE '2022-09-01', NUMERIC '24.573', 'cnb_monthly_avg'),
      STRUCT(DATE '2022-10-01', NUMERIC '24.532', 'cnb_monthly_avg'),
      STRUCT(DATE '2022-11-01', NUMERIC '24.367', 'cnb_monthly_avg'),
      STRUCT(DATE '2022-12-01', NUMERIC '24.269', 'cnb_monthly_avg'),
      STRUCT(DATE '2023-01-01', NUMERIC '23.958', 'cnb_monthly_avg'),
      STRUCT(DATE '2023-02-01', NUMERIC '23.712', 'cnb_monthly_avg'),
      STRUCT(DATE '2023-03-01', NUMERIC '23.683', 'cnb_monthly_avg'),
      STRUCT(DATE '2023-04-01', NUMERIC '23.438', 'cnb_monthly_avg'),
      STRUCT(DATE '2023-05-01', NUMERIC '23.604', 'cnb_monthly_avg'),
      STRUCT(DATE '2023-06-01', NUMERIC '23.696', 'cnb_monthly_avg'),
      STRUCT(DATE '2023-07-01', NUMERIC '23.902', 'cnb_monthly_avg'),
      STRUCT(DATE '2023-08-01', NUMERIC '24.112', 'cnb_monthly_avg'),
      STRUCT(DATE '2023-09-01', NUMERIC '24.387', 'cnb_monthly_avg'),
      STRUCT(DATE '2023-10-01', NUMERIC '24.586', 'cnb_monthly_avg'),
      STRUCT(DATE '2023-11-01', NUMERIC '24.489', 'cnb_monthly_avg'),
      STRUCT(DATE '2023-12-01', NUMERIC '24.483', 'cnb_monthly_avg'),
      STRUCT(DATE '2024-01-01', NUMERIC '24.716', 'cnb_monthly_avg'),
      STRUCT(DATE '2024-02-01', NUMERIC '25.232', 'cnb_monthly_avg'),
      STRUCT(DATE '2024-03-01', NUMERIC '25.290', 'cnb_monthly_avg'),
      STRUCT(DATE '2024-04-01', NUMERIC '25.280', 'cnb_monthly_avg'),
      STRUCT(DATE '2024-05-01', NUMERIC '24.806', 'cnb_monthly_avg'),
      STRUCT(DATE '2024-06-01', NUMERIC '24.779', 'cnb_monthly_avg'),
      STRUCT(DATE '2024-07-01', NUMERIC '25.305', 'cnb_monthly_avg'),
      STRUCT(DATE '2024-08-01', NUMERIC '25.179', 'cnb_monthly_avg'),
      STRUCT(DATE '2024-09-01', NUMERIC '25.099', 'cnb_monthly_avg'),
      STRUCT(DATE '2024-10-01', NUMERIC '25.294', 'cnb_monthly_avg'),
      STRUCT(DATE '2024-11-01', NUMERIC '25.302', 'cnb_monthly_avg'),
      STRUCT(DATE '2024-12-01', NUMERIC '25.137', 'cnb_monthly_avg'),
      STRUCT(DATE '2025-01-01', NUMERIC '25.162', 'cnb_monthly_avg'),
      STRUCT(DATE '2025-02-01', NUMERIC '25.076', 'cnb_monthly_avg'),
      STRUCT(DATE '2025-03-01', NUMERIC '25.003', 'cnb_monthly_avg'),
      STRUCT(DATE '2025-04-01', NUMERIC '25.040', 'cnb_monthly_avg'),
      STRUCT(DATE '2025-05-01', NUMERIC '24.923', 'cnb_monthly_avg'),
      STRUCT(DATE '2025-06-01', NUMERIC '24.806', 'cnb_monthly_avg'),
      STRUCT(DATE '2025-07-01', NUMERIC '24.625', 'cnb_monthly_avg'),
      STRUCT(DATE '2025-08-01', NUMERIC '24.517', 'cnb_monthly_avg'),
      STRUCT(DATE '2025-09-01', NUMERIC '24.347', 'cnb_monthly_avg'),
      STRUCT(DATE '2025-10-01', NUMERIC '24.315', 'cnb_monthly_avg'),
      STRUCT(DATE '2025-11-01', NUMERIC '24.239', 'cnb_monthly_avg'),
      STRUCT(DATE '2025-12-01', NUMERIC '24.260', 'cnb_monthly_avg'),
      STRUCT(DATE '2026-01-01', NUMERIC '24.279', 'cnb_monthly_avg'),
      STRUCT(DATE '2026-02-01', NUMERIC '24.260', 'cnb_monthly_avg'),
      STRUCT(DATE '2026-03-01', NUMERIC '24.437', 'cnb_monthly_avg'),
      STRUCT(DATE '2026-04-01', NUMERIC '24.382', 'cnb_monthly_avg'),
      STRUCT(DATE '2026-05-01', NUMERIC '24.313', 'cnb_monthly_avg'),
      STRUCT(DATE '2026-06-01', NUMERIC '24.210', 'cnb_monthly_avg'),
      STRUCT(DATE '2026-07-01', NUMERIC '24.210', 'cnb_monthly_avg'),
      -- provizorni: prumer 1 dennich fixingu tohoto mesice
      STRUCT(DATE '2026-08-01', NUMERIC '24.205', 'cnb_mtd_avg@2026-08-03')
    ])
  )
  SELECT month_start, 'EUR' AS from_currency, 'CZK' AS to_currency, rate, source FROM eur
  UNION ALL
  SELECT month_start, 'CZK', 'EUR', ROUND(1 / rate, 9), source || '_inverse' FROM eur
  UNION ALL
  SELECT DATE '2026-08-01', 'USD', 'CZK', NUMERIC '20.989', 'cnb_mtd_avg@2026-08-03'
) S
ON  T.month_start   = S.month_start
AND T.from_currency = S.from_currency
AND T.to_currency   = S.to_currency
WHEN MATCHED THEN UPDATE SET
  rate = S.rate, source = S.source, ingested_at = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT
  (month_start, from_currency, to_currency, rate, source, ingested_at)
VALUES
  (S.month_start, S.from_currency, S.to_currency, S.rate, S.source, CURRENT_TIMESTAMP());
