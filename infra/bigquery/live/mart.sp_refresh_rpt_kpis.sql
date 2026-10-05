CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_rpt_kpis`()
OPTIONS (description = 'Rebuilds mart.rpt_kpis_daily from mart.mart_daily_kpis. Builds mart.rpt_kpis_daily__next, checks it (rows > 0, >= 90 % of the current table, unique client_id and date, latest date not older than 2 days), then swaps it in with CREATE OR REPLACE TABLE ... COPY. Any failure leaves the current table untouched. Migration 253. Called hourly by the n8n workflow "BQ: refresh rpt_kpis_daily".')
BEGIN
  DECLARE prev_rows INT64;
  DECLARE new_rows INT64;
  DECLARE dup_rows INT64;
  DECLARE max_date DATE;

  SET @@query_label = 'feature:rpt-kpis-refresh';

  -- Rows in the table that is live now. NULL on the first run (table absent).
  SET prev_rows = (
    SELECT row_count FROM `oneeighty-warehouse.mart`.__TABLES__
    WHERE table_id = 'rpt_kpis_daily');

  -- 1. Build the next version beside the live one. One scan of the view.
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.rpt_kpis_daily__next`
  PARTITION BY DATE_TRUNC(date, MONTH)
  CLUSTER BY client_id, date
  OPTIONS (description = 'Staging copy for mart.sp_refresh_rpt_kpis. Not for reading.')
  AS
  SELECT k.*, CURRENT_TIMESTAMP() AS refreshed_at
  FROM `oneeighty-warehouse.mart.mart_daily_kpis` AS k;

  -- 2. Checks. A failed ASSERT ends the procedure here: the live table stays as it was.
  SET (new_rows, dup_rows, max_date) = (
    SELECT AS STRUCT
      COUNT(*),
      COUNT(*) - COUNT(DISTINCT FORMAT('%s|%t', client_id, date)),
      MAX(date)
    FROM `oneeighty-warehouse.mart.rpt_kpis_daily__next`);

  ASSERT new_rows > 0
    AS 'rpt_kpis_daily refresh: mart_daily_kpis returned 0 rows, live table kept';
  ASSERT prev_rows IS NULL OR new_rows >= 0.9 * prev_rows
    AS 'rpt_kpis_daily refresh: new row count is below 90 % of the live table, live table kept';
  ASSERT dup_rows = 0
    AS 'rpt_kpis_daily refresh: duplicate client_id and date rows, live table kept';
  ASSERT max_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)
    AS 'rpt_kpis_daily refresh: latest date is older than 2 days, live table kept';

  -- 3. Swap. One statement: readers see the old table or the new one, never a mix.
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.rpt_kpis_daily`
  COPY `oneeighty-warehouse.mart.rpt_kpis_daily__next`
  OPTIONS (description = 'Materialised mart.mart_daily_kpis for Reports (same 34 columns + refreshed_at). Rebuilt hourly by mart.sp_refresh_rpt_kpis (n8n "BQ: refresh rpt_kpis_daily"). Lags the view by up to 1 hour. Migration 253.');

  DROP TABLE IF EXISTS `oneeighty-warehouse.mart.rpt_kpis_daily__next`;
END;
