-- =============================================================================
-- 282_home_alerts.sql
-- Home "For you": the daily alert snapshot, with history per alert.
--
-- Why
--   The For you cards on Home were recomputed from the plan and creative marts on
--   every page load, so an alert had no history (since when is it open?) and the
--   team could not tell a new problem from an old one. The owner asked
--   (2026-10-08) for a once-a-day computation the page reads as a snapshot.
--
-- Change (additive, nothing existing is modified)
--   NEW TABLE     mart.home_alerts, one row per alert_key ever seen:
--                   alert_key           stable key, rule + client (+ entity):
--                                         plan:<client>  ly:<client>  amer:<client>
--                                         cost:<client>  unmapped:<client>
--                                         promo_end:<client>:<promo task id>
--                                       never a date, so a dismissal in the app
--                                       (Postgres home_alert_dismissals) keeps
--                                       matching the same alert day after day
--                   client_id, client_name, rule, entity_id
--                   severity            the card tone: negative > warning > info > neutral
--                   money_at_stake      in the client's currency (NULL when the rule
--                                       has no money figure); money_at_stake_czk at
--                                       the latest ref.fx_rates rate, for ordering
--                   currency, title, detail, link   the card text, figures formatted
--                                       as lib/format.ts does (en-US, CZK 12,345)
--                   first_seen          first day of the current open run
--                   last_seen           last run day the rule fired
--                   computed_at         the run that last wrote the row
--                 The page's snapshot is the rows whose computed_at equals the
--                 latest run in mart.home_alerts_runs. Rows of alerts that stopped
--                 firing stay with their old last_seen (history).
--   NEW TABLE     mart.home_alerts_runs, one row per run (run_date, computed_at,
--                 alert_count). An alert is "still open" when it fired on the
--                 previous run day; a day without a run (failed job) does not reset
--                 first_seen, a run where the alert did not fire does.
--   NEW PROCEDURE mart.sp_refresh_home_alerts(): computes today's alerts
--                 (Europe/Prague date) into a temp table, checks them, then in one
--                 transaction MERGEs them into mart.home_alerts and logs the run.
--                 Checks (ASSERT, any failure ends the CALL with an error and leaves
--                 both tables as they were):
--                   * mart.plan_pacing refreshed within the last 36 hours
--                   * no duplicate alert_key
--                   * every alert has a client, rule, severity and title
--
-- Rules (ported from dashboard/lib/home/shopify/rules.ts, same thresholds and text)
--   In SQL (this file):
--     plan       Behind plan: the targeted CM3 or revenue row of the current month
--                (mart.plan_pacing) is behind / off track; the larger shortfall
--                (target to date minus actual) is the money at stake.
--     ly         Below last year: no plan this month and revenue month to date is
--                10 % or more under the same days a year earlier
--                (mart.plan_actuals_daily). At stake: the gap.
--     amer       aMER behind plan, only when neither money rule fired.
--     cost       Missing cost data: CM3 cannot be measured this month.
--     unmapped   Meta ads with spend and no ClickUp task (mart.mart_creative_unmapped,
--                active clients). At stake: their spend. The app's live rule also
--                hides ads confirmed in Postgres during the last hour before the
--                ClickUp sync lands them; at 05:10 those have synced, so the
--                warehouse count is the same queue.
--     promo_end  NEW. A ClickUp promo (mart.plan_input, level Promo, not rejected
--                or on hold) running today and ending today, tomorrow or in 2 days.
--                At stake: the promo's Target revenue minus its attributed revenue
--                (mart.plan_promo_perf, grain total) when both exist and the goal
--                is not yet met; otherwise no money figure.
--   In the app (live on every load, merged with this snapshot at read time):
--     capacity, window, brief   the Velocity rules. They read the Velocity inputs
--                and creative settings saved in Postgres, which BigQuery cannot read.
--
-- Scheduler: n8n "BQ: refresh home alerts" (infra/n8n/wf_home_alerts_daily.json),
--   daily 05:10 Europe/Prague, one BigQuery node CALL mart.sp_refresh_home_alerts(),
--   error workflow lslDsvbP8jLKEgw0. NOT imported: import it after this file is
--   deployed. The n8n credential runs as sa-n8n-writer, which needs write access to
--   mart (see 253 statement 0; skip if that grant is already in place).
--
-- Reader: dashboard lib/home/final/alerts.ts. When the latest run is older than
--   36 hours, or the table cannot be read, the page computes the same rules live.
--
-- Cost: about 130 MB and 140 slot seconds per CALL (measured in mart_qa), once a day.
--
-- Based on: live mart.plan_pacing, mart.plan_actuals_daily, mart.plan_input,
--   mart.plan_promo_perf, mart.mart_creative_unmapped, ref.clients, ref.fx_rates
--   as of 2026-10-08. None of them is changed.
-- QA copies: mart_qa.ha_home_alerts, mart_qa.ha_home_alerts_runs,
--   mart_qa.ha_sp_refresh_home_alerts (same body, writes mart_qa).
-- Affected clients: none (new objects).
-- Deploy order: statements 1, 2, 3, then 4 (first CALL), then import and activate
--   the n8n workflow. Rollback: deactivate the workflow, DROP PROCEDURE
--   mart.sp_refresh_home_alerts, DROP TABLE mart.home_alerts, mart.home_alerts_runs
--   (the page falls back to live computation by itself).
-- =============================================================================

-- 1. The snapshot with history.
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.mart.home_alerts` (
  alert_key          STRING NOT NULL,
  client_id          STRING NOT NULL,
  client_name        STRING,
  rule               STRING NOT NULL,
  entity_id          STRING,
  severity           STRING NOT NULL,
  money_at_stake_czk FLOAT64,
  money_at_stake     FLOAT64,
  currency           STRING,
  title              STRING NOT NULL,
  detail             STRING,
  link               STRING,
  first_seen         DATE NOT NULL,
  last_seen          DATE NOT NULL,
  computed_at        TIMESTAMP NOT NULL
)
CLUSTER BY alert_key
OPTIONS (description = 'Home For you alerts, one row per alert_key ever seen. Snapshot = rows whose computed_at is the latest run in mart.home_alerts_runs. Written daily by mart.sp_refresh_home_alerts (n8n, 05:10 Europe/Prague). Migration 282.');

-- 2. One row per run.
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.mart.home_alerts_runs` (
  run_date    DATE NOT NULL,
  computed_at TIMESTAMP NOT NULL,
  alert_count INT64 NOT NULL
)
OPTIONS (description = 'Runs of mart.sp_refresh_home_alerts. Migration 282.');

-- 3. The procedure.
CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_home_alerts`()
OPTIONS (description = 'Computes the Home For you alerts for today (Europe/Prague) and MERGEs them into mart.home_alerts with first_seen / last_seen history, logging the run in mart.home_alerts_runs. Fails (and changes nothing) when mart.plan_pacing is older than 36 hours or the alerts fail their checks. Migration 282. Called daily at 05:10 by the n8n workflow "BQ: refresh home alerts".')
BEGIN
  DECLARE run_ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP();
  DECLARE today DATE DEFAULT CURRENT_DATE('Europe/Prague');
  DECLARE prev_run DATE;
  DECLARE pacing_at TIMESTAMP;

  SET @@query_label = 'feature:home-alerts-refresh';

  SET prev_run = (
    SELECT MAX(run_date) FROM `oneeighty-warehouse.mart.home_alerts_runs` WHERE run_date < today);
  SET pacing_at = (SELECT MAX(refreshed_at) FROM `oneeighty-warehouse.mart.plan_pacing`);
  ASSERT pacing_at >= TIMESTAMP_SUB(run_ts, INTERVAL 36 HOUR)
    AS 'home_alerts refresh: mart.plan_pacing is older than 36 hours, alerts kept as they were';

  -- Card text formatting, as lib/format.ts renders it (en-US, U+2212 minus).
  CREATE TEMP FUNCTION money(v FLOAT64, cur STRING) AS (
    IF(v IS NULL, 'n/a', CONCAT(IF(ROUND(v) < 0, '\u2212', ''),
      CASE cur WHEN 'USD' THEN '$' WHEN 'EUR' THEN '\u20ac' WHEN 'GBP' THEN '\u00a3' ELSE CONCAT(cur, '\u00a0') END,
      FORMAT("%'d", CAST(ROUND(ABS(v)) AS INT64)))));
  CREATE TEMP FUNCTION pct(f FLOAT64) AS (IF(f IS NULL, 'n/a', FORMAT('%.1f%%', f * 100)));
  CREATE TEMP FUNCTION ratio(v FLOAT64) AS (IF(v IS NULL, 'n/a', FORMAT('%.2f\u00d7', v)));
  CREATE TEMP FUNCTION whole(v FLOAT64) AS (FORMAT("%'d", CAST(ROUND(v) AS INT64)));

  -- Today's alerts.
  CREATE TEMP TABLE today_alerts AS
    WITH
    -- Latest CZK rate per currency (lib/home/shopify/data.ts fetchCzkRates).
    fx AS (
      SELECT 'CZK' AS currency, 1.0 AS rate
      UNION ALL
      SELECT from_currency, CAST(rate AS FLOAT64)
      FROM `oneeighty-warehouse.ref.fx_rates`
      WHERE to_currency = 'CZK' AND rate > 0 AND from_currency != 'CZK'
      QUALIFY ROW_NUMBER() OVER (PARTITION BY from_currency ORDER BY month_start DESC) = 1
    ),
    registry AS (               -- getClientsIncludingInactive(): every registry row
      SELECT client_id, name, currency, meta_currency, status
      FROM `oneeighty-warehouse.ref.clients`
      WHERE client_id IS NOT NULL AND currency IS NOT NULL
    ),
    -- The current month's pacing rows (lib/home/queries.ts fetchMonthPacing), with the
    -- status as toPacingRow() derives it.
    pacing AS (
      SELECT
        p.client_id, p.metric, p.period_label, p.as_of,
        p.target_total, p.target_to_date, p.actual_to_date, p.pace_pct, p.result,
        p.target_total IS NOT NULL AS targeted,
        CASE
          WHEN p.target_total IS NULL AND p.status != 'not_started' THEN 'no_target'
          WHEN p.is_measured = FALSE AND p.status NOT IN ('not_started', 'closed') THEN 'not_measured'
          WHEN p.status IN ('ahead', 'on_track', 'behind', 'off_track', 'not_started', 'closed') THEN p.status
          ELSE 'on_track'
        END AS status
      FROM `oneeighty-warehouse.mart.plan_pacing` p
      WHERE p.period_type = 'month' AND p.period_id = FORMAT_DATE('%Y-%m', p.as_of)
    ),
    pacing_tone AS (            -- planStatusTone() for the non-spend metrics used here
      SELECT *,
        CASE
          WHEN status = 'behind' THEN 'warning'
          WHEN status = 'off_track' THEN 'negative'
          WHEN status = 'closed' AND result = 'missed' THEN 'negative'
          ELSE 'other'
        END AS tone,
        CASE
          WHEN status = 'closed' AND result = 'met' THEN 'Met'
          WHEN status = 'closed' AND result = 'missed' THEN 'Missed'
          WHEN status = 'no_target' THEN 'No target'
          WHEN status = 'not_measured' THEN IF(metric = 'cm3', 'No cost data', 'Missing days')
          ELSE CASE status WHEN 'ahead' THEN 'Ahead' WHEN 'on_track' THEN 'On track' WHEN 'behind' THEN 'Behind'
                           WHEN 'off_track' THEN 'Off track' WHEN 'not_started' THEN 'Not started' WHEN 'closed' THEN 'Closed' END
        END AS status_label
      FROM pacing
    ),
    -- Month to date and the same days a year earlier (lib/home/queries.ts fetchActuals).
    a AS (
      SELECT * FROM `oneeighty-warehouse.mart.plan_actuals_daily`
      WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 400 DAY)
    ),
    x AS (SELECT client_id, MAX(date) AS last_day FROM a GROUP BY client_id),
    t AS (
      SELECT a.*, x.last_day,
        a.date BETWEEN DATE_TRUNC(x.last_day, MONTH) AND x.last_day AS cur,
        a.date BETWEEN DATE_SUB(DATE_TRUNC(x.last_day, MONTH), INTERVAL 1 YEAR)
                   AND DATE_SUB(x.last_day, INTERVAL 1 YEAR) AS ly
      FROM a JOIN x USING (client_id)
    ),
    act AS (
      SELECT client_id,
        SUM(IF(cur, revenue, NULL)) AS revenue,
        COUNTIF(ly) AS days_ly,
        SUM(IF(ly, revenue, NULL)) AS revenue_ly,
        SUM(IF(cur, cm3, NULL)) AS cm3,
        COUNTIF(cur AND cm3 IS NULL) AS cm3_gaps,
        SUM(IF(cur, new_customer_revenue, NULL)) AS ncr,
        SUM(IF(cur, paid_spend, NULL)) AS paid,
        COUNTIF(cur AND paid_spend IS NULL) AS paid_gaps
      FROM t GROUP BY client_id
    ),
    -- One row per registry client: the ClientHealth fields the rules read (buildClient()).
    health AS (
      SELECT
        r.client_id, r.name, r.currency,
        rv AS rev_row, cm AS cm3_row, am AS amer_row,
        COALESCE(rv.actual_to_date, act.revenue) AS revenue_actual,
        COALESCE(cm.actual_to_date, IF(act.cm3_gaps = 0, act.cm3, NULL)) AS cm3_actual,
        COALESCE(am.actual_to_date,
          IF(act.paid_gaps = 0 AND act.paid IS NOT NULL AND act.paid > 0, IFNULL(act.ncr, 0) / act.paid, NULL)) AS amer_actual,
        -- focus: CM3 row when targeted and measured, else the targeted revenue row
        IFNULL(cm.targeted AND cm.status != 'not_measured', FALSE) OR IFNULL(rv.targeted, FALSE) AS has_focus,
        IF(act.days_ly > 0 AND act.revenue_ly IS NOT NULL AND act.revenue_ly > 0 AND act.revenue IS NOT NULL,
           (act.revenue - act.revenue_ly) / act.revenue_ly, NULL) AS vs_ly
      FROM registry r
      LEFT JOIN act USING (client_id)
      LEFT JOIN (SELECT * FROM pacing_tone WHERE metric = 'revenue') rv ON rv.client_id = r.client_id
      LEFT JOIN (SELECT * FROM pacing_tone WHERE metric = 'cm3') cm ON cm.client_id = r.client_id
      LEFT JOIN (SELECT * FROM pacing_tone WHERE metric = 'amer') am ON am.client_id = r.client_id
    ),
    -- Behind plan: the larger shortfall of the targeted CM3 and revenue rows (planCard()).
    plan_cand AS (
      SELECT h.client_id, h.name, h.currency, c.metric_label, c.row, c.ord,
             c.row.target_to_date - c.row.actual_to_date AS short
      FROM health h,
      UNNEST([STRUCT('CM3' AS metric_label, h.cm3_row AS row, 0 AS ord),
              STRUCT('Revenue' AS metric_label, h.rev_row AS row, 1 AS ord)]) c
      WHERE c.row.targeted AND c.row.tone IN ('warning', 'negative')
        AND c.row.actual_to_date IS NOT NULL AND c.row.target_to_date IS NOT NULL
        AND c.row.target_to_date > c.row.actual_to_date
    ),
    plan_alerts AS (
      SELECT * FROM plan_cand
      WHERE TRUE
      QUALIFY ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY short DESC, ord) = 1
    ),
    ly_alerts AS (              -- lastYearCard()
      SELECT h.client_id, h.name, h.currency, h.vs_ly, h.revenue_actual AS now_rev,
             h.revenue_actual / (1 + h.vs_ly) AS before_rev,
             h.revenue_actual / (1 + h.vs_ly) - h.revenue_actual AS gap
      FROM health h
      WHERE NOT h.has_focus AND h.vs_ly IS NOT NULL AND h.revenue_actual IS NOT NULL
        AND h.vs_ly <= -0.1 AND h.vs_ly > -1
    ),
    amer_alerts AS (            -- amerCard(): only when neither money card fired
      SELECT h.client_id, h.name, h.currency, h.amer_row AS row
      FROM health h
      WHERE h.amer_row.targeted AND h.amer_row.tone IN ('warning', 'negative')
        AND h.amer_row.actual_to_date IS NOT NULL AND h.amer_row.target_to_date IS NOT NULL
        AND h.client_id NOT IN (SELECT client_id FROM plan_alerts)
        AND h.client_id NOT IN (SELECT client_id FROM ly_alerts)
    ),
    cost_alerts AS (            -- costCard()
      SELECT h.client_id, h.name, h.currency, h.amer_actual
      FROM health h
      WHERE h.cm3_actual IS NULL AND h.revenue_actual IS NOT NULL
    ),
    unmapped_alerts AS (        -- unmappedCard(): active clients, warehouse queue
      SELECT r.client_id, r.name, COALESCE(r.meta_currency, r.currency) AS currency,
             COUNT(*) AS ads, CAST(SUM(IFNULL(u.spend, 0)) AS FLOAT64) AS spend
      FROM `oneeighty-warehouse.mart.mart_creative_unmapped` u
      JOIN registry r ON r.client_id = u.client_id AND r.status = 'active'
      WHERE NOT u.before_pipeline
      GROUP BY 1, 2, 3
    ),
    -- Promo ending in 2 days or less (new): a running ClickUp promo whose last day is
    -- today, tomorrow or the day after (Europe/Prague).
    promo_alerts AS (
      SELECT
        p.client_id, r.name, r.currency, p.task_id, p.name AS promo_name, p.end_date,
        DATE_DIFF(p.end_date, today, DAY) AS ends_in,
        p.target_revenue, f.attr_orders, f.attr_revenue, f.as_of
      FROM `oneeighty-warehouse.mart.plan_input` p
      JOIN registry r USING (client_id)
      LEFT JOIN `oneeighty-warehouse.mart.plan_promo_perf` f
        ON f.client_id = p.client_id AND f.task_id = p.task_id AND f.grain = 'total'
      WHERE p.level = 'Promo'
        AND IFNULL(p.status, '') NOT IN ('rejected', 'on hold')
        AND p.start_date <= today
        AND p.end_date >= today
        AND DATE_DIFF(p.end_date, today, DAY) <= 2
    ),
    alerts AS (
      SELECT
        CONCAT('plan:', client_id) AS alert_key, client_id, name AS client_name, 'plan' AS rule,
        CAST(NULL AS STRING) AS entity_id,
        IF(row.tone = 'negative', 'negative', 'warning') AS severity,
        short AS money_at_stake, currency,
        FORMAT('%s is %s short of plan to date.', metric_label, money(short, currency)) AS title,
        FORMAT('%s of %s · %s of plan · %s', money(row.actual_to_date, currency), money(row.target_to_date, currency),
               pct(row.pace_pct / 100), row.status_label) AS detail,
        FORMAT('/goals?client=%s', client_id) AS link
      FROM plan_alerts
      UNION ALL
      SELECT
        CONCAT('ly:', client_id), client_id, name, 'ly', NULL, 'warning', gap, currency,
        FORMAT('Revenue month to date is %s below the same days last year.', pct(ABS(vs_ly))),
        FORMAT('%s against %s', money(now_rev, currency), money(before_rev, currency)),
        FORMAT('/snapshot?client=%s', client_id)
      FROM ly_alerts
      UNION ALL
      SELECT
        CONCAT('amer:', client_id), client_id, name, 'amer', NULL,
        IF(row.tone = 'negative', 'negative', 'warning'), NULL, currency,
        FORMAT('aMER is %s against %s planned to date.', ratio(row.actual_to_date), ratio(row.target_to_date)),
        FORMAT('%s · %s', row.status_label, row.period_label),
        FORMAT('/goals?client=%s', client_id)
      FROM amer_alerts
      UNION ALL
      SELECT
        CONCAT('cost:', client_id), client_id, name, 'cost', NULL, 'neutral', NULL, currency,
        'CM3 is n/a this month: cost data is missing on at least one day.',
        IF(amer_actual IS NULL, 'aMER is n/a too.', NULL),
        '/health'
      FROM cost_alerts
      UNION ALL
      SELECT
        CONCAT('unmapped:', client_id), client_id, name, 'unmapped', NULL, 'info',
        IF(spend > 0, spend, NULL), currency,
        FORMAT('%s Meta %s no ClickUp task.', whole(ads), IF(ads = 1, 'ad has', 'ads have')),
        'Their spend is missing from every tag breakdown.',
        FORMAT('/creative?client=%s#unmapped', client_id)
      FROM unmapped_alerts
      WHERE ads > 0
      UNION ALL
      SELECT
        CONCAT('promo_end:', client_id, ':', task_id), client_id, name, 'promo_end', task_id, 'warning',
        IF(target_revenue IS NOT NULL AND attr_revenue IS NOT NULL AND target_revenue > attr_revenue,
           CAST(target_revenue - attr_revenue AS FLOAT64), NULL),
        currency,
        FORMAT('%s ends %s.', promo_name,
               CASE ends_in WHEN 0 THEN 'today' WHEN 1 THEN 'tomorrow' ELSE FORMAT('in %d days', ends_in) END),
        IF(attr_orders IS NULL, NULL,
           CONCAT(FORMAT('%s %s · %s', whole(attr_orders), IF(attr_orders = 1, 'order', 'orders'),
                         money(CAST(attr_revenue AS FLOAT64), currency)),
                  IF(target_revenue IS NULL, '', FORMAT(' of %s', money(CAST(target_revenue AS FLOAT64), currency))),
                  FORMAT(' through %d %s', EXTRACT(DAY FROM as_of), FORMAT_DATE('%b', as_of)))),
        FORMAT('/goals?client=%s&view=promo&period=%s', client_id, task_id)
      FROM promo_alerts
    )
    SELECT
      al.*,
      IF(al.money_at_stake IS NULL, NULL, al.money_at_stake * fx.rate) AS money_at_stake_czk
    FROM alerts al
    LEFT JOIN fx ON fx.currency = al.currency;

  -- Checks. A failed ASSERT ends the CALL: mart.home_alerts stays as it was.
  ASSERT NOT EXISTS (SELECT alert_key FROM today_alerts GROUP BY alert_key HAVING COUNT(*) > 1)
    AS 'home_alerts refresh: duplicate alert_key, alerts kept as they were';
  ASSERT NOT EXISTS (
    SELECT 1 FROM today_alerts
    WHERE client_id IS NULL OR rule IS NULL OR severity IS NULL OR title IS NULL)
    AS 'home_alerts refresh: an alert without client, rule, severity or title, alerts kept as they were';

  -- Write and log in one transaction: readers see the previous run or this one.
  BEGIN TRANSACTION;

  MERGE `oneeighty-warehouse.mart.home_alerts` T
  USING today_alerts S
  ON T.alert_key = S.alert_key
  WHEN MATCHED THEN UPDATE SET
    client_id = S.client_id, client_name = S.client_name, rule = S.rule, entity_id = S.entity_id,
    severity = S.severity, money_at_stake_czk = S.money_at_stake_czk,
    money_at_stake = S.money_at_stake, currency = S.currency,
    title = S.title, detail = S.detail, link = S.link,
    -- Still open when it fired on the previous run day (or earlier today): keep its start.
    first_seen = IF(T.last_seen >= IFNULL(prev_run, today), T.first_seen, today),
    last_seen = today,
    computed_at = run_ts
  WHEN NOT MATCHED THEN INSERT (
    alert_key, client_id, client_name, rule, entity_id, severity, money_at_stake_czk,
    money_at_stake, currency, title, detail, link, first_seen, last_seen, computed_at)
  VALUES (
    S.alert_key, S.client_id, S.client_name, S.rule, S.entity_id, S.severity, S.money_at_stake_czk,
    S.money_at_stake, S.currency, S.title, S.detail, S.link, today, today, run_ts);

  INSERT INTO `oneeighty-warehouse.mart.home_alerts_runs` (run_date, computed_at, alert_count)
  SELECT today, run_ts, COUNT(*) FROM today_alerts;

  COMMIT TRANSACTION;
END;

-- 4. First run (creates today's snapshot). About 130 MB.
CALL `oneeighty-warehouse.mart.sp_refresh_home_alerts`();

