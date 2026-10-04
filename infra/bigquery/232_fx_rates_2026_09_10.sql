-- 232_fx_rates_2026_09_10.sql
-- Purpose:   refresh ref.fx_rates (runbooks/23_fx_rates_refresh.md, audit P0-5, plan W4).
--              - September 2026 becomes FINAL (cnb_monthly_avg) for USD->CZK and EUR->CZK;
--                CZK->EUR is the 9dp inverse, tagged cnb_monthly_avg_inverse.
--              - October 2026 is PROVISIONAL (cnb_mtd_avg@2026-10-04, mean of the daily
--                fixings published so far: 2026-10-01 and 2026-10-02).
--            Live today (snapshot 2026-10-04): every CNB pair ends at 2026-09-01 and that
--            row is provisional (cnb_mtd_avg@2026-09-21). October has no row, so
--            RawBark's October EUR orders have NULL revenue and the USD->CZK toggle is
--            padlocked for October.
-- Source:    CNB, fetched 2026-10-04 16:53 UTC (public, no key):
--              monthly averages (first table only, header third column asserted = 'leden'):
--                https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/prumerne_mena.txt?mena=USD
--                https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/prumerne_mena.txt?mena=EUR
--              daily fixings for October:
--                https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/rok.txt?rok=2026
--            Cross-check: the mean of the 21 September daily fixings is 21.090 USD and
--            24.292 EUR, equal to the published monthly averages. October USD fixings
--            21.655 and 21.795 (mean 21.725); EUR 24.465 and 24.465 (mean 24.465).
-- Based on:  live/ref.fx_rates.sql (snapshot 2026-10-04); same MERGE shape as 013 and 014.
-- Affected clients (when deployed):
--            dobias (USD->CZK rollup), venev (EUR->CZK rollup, CZK->EUR for Meta spend),
--            rawbark (EUR orders from SK customers). Expected effect: September USD
--            and EUR amounts move from the provisional to the final rate (USD +0.61 %,
--            EUR +0.16 %), RawBark October EUR orders gain revenue (17 orders were NULL).
--            ethia and manami are CZK on every side: no change.
-- Regression: data only, no view changes. Per-month CZK conversions for August and
--            earlier are untouched (rows keyed on month, MATCHED rows only for 2026-09).
-- NOT EXECUTED against prod. Needs owner OK. Deploy order: independent of 230, 231, 233.
--            Do NOT add a "fall back to the latest rate" view change: a missing rate
--            must stay NULL, never a silently wrong rate (plan P0-5).
-- Re-run in early November: replace the October rows with the final figure and add
--            November provisional rows (procedure in runbook 23).
--
-- Idempotent: MERGE on (month_start, from_currency, to_currency).

MERGE `oneeighty-warehouse.ref.fx_rates` T
USING (
  WITH cnb AS (
    SELECT * FROM UNNEST([
      -- final: published CNB monthly average, September 2026
      STRUCT(DATE '2026-09-01' AS month_start, 'USD' AS from_currency, NUMERIC '21.090' AS rate, 'cnb_monthly_avg' AS source),
      STRUCT(DATE '2026-09-01', 'EUR', NUMERIC '24.292', 'cnb_monthly_avg'),
      -- provisional: mean of the CNB daily fixings of 2026-10-01 and 2026-10-02
      STRUCT(DATE '2026-10-01', 'USD', NUMERIC '21.725', 'cnb_mtd_avg@2026-10-04'),
      STRUCT(DATE '2026-10-01', 'EUR', NUMERIC '24.465', 'cnb_mtd_avg@2026-10-04')
    ])
  )
  SELECT month_start, from_currency, 'CZK' AS to_currency, rate, source FROM cnb
  UNION ALL
  -- CZK->EUR is derived (1 / EUR->CZK at 9dp), as in migration 014. The suffix is
  -- appended so the runbook-23 check source LIKE 'cnb_mtd_avg%' still matches.
  SELECT month_start, 'CZK', 'EUR', ROUND(1 / rate, 9), source || '_inverse' FROM cnb WHERE from_currency = 'EUR'
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

-- Verify (runbook 23): last_month = 2026-10-01 for USD->CZK, EUR->CZK, CZK->EUR.
--   SELECT from_currency, to_currency, MAX(month_start) AS last_month,
--          COUNTIF(source LIKE 'cnb_mtd_avg%') AS provisional_rows
--   FROM `oneeighty-warehouse.ref.fx_rates` GROUP BY 1, 2;
-- Verify RawBark has no NULL revenue left (expect 0):
--   SELECT COUNT(*) FROM `oneeighty-warehouse.mart.mart_orders`
--   WHERE client_id = 'rawbark' AND date >= DATE '2026-10-01' AND revenue IS NULL;
