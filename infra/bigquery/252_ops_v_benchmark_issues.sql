-- 252_ops_v_benchmark_issues.sql
-- Reporting Suite (package RS10, design WP10, PHASE 2): data quality of the benchmark reference
-- tables. File only for now: it is not wired into Data Health or ops.v_pipeline_alerts, and the
-- Reports MVP does not need it. Deploy it with the phase 2 Data Health work.
--
-- Purpose:    one row per problem found in ref.industry_benchmarks or ref.client_verticals.
--             BigQuery has no CHECK or UNIQUE constraints, so this view is the constraint layer.
--             An empty result means both tables are clean (also true while both are empty,
--             except for the "client without vertical" rows, see below).
-- Based on:   new object, reads only 250 and 251 plus ref.clients. Nothing existing is changed.
-- Affected:   no existing view or client. Pure monitor.
-- Regression: not applicable (new view). Tested as mart_qa.rs10_v_benchmark_issues against
--             mart_qa.rs10_* copies of both tables with one deliberately bad row per rule.
-- Deploy order: 3 of 3, after 250 and 251. CREATE OR REPLACE VIEW, idempotent.
--             Needs owner OK. NOT EXECUTED against prod.
--
-- Output columns: issue_code, severity ('critical' | 'warning'), client_id, benchmark_id,
--                 vertical, metric_id, detail (one readable line).
-- Severity: critical = the Reports product would show a wrong or misleading number or mapping;
--           warning = needs attention but nothing is wrong yet.
--
-- NOT checked here: unknown metric_id values. SQL does not know the registry; the app compares
-- metric_id with dashboard/lib/reports/registry/ids.ts and flags unknown ids on Data Health.
--
-- Keep the two id lists below in step with the registry (ids are append-only, so this means
-- adding ids, never changing them). money = metrics whose unit is money; fraction = metrics whose
-- unit is percent (stored as a fraction, 0.012 for 1.2 %).

CREATE OR REPLACE VIEW `oneeighty-warehouse.ops.v_benchmark_issues` AS
WITH
  money_metrics AS (
    SELECT m FROM UNNEST(['aov', 'cac', 'meta_cpc', 'meta_cpm', 'meta_cpa', 'google_cpc']) AS m
  ),
  fraction_metrics AS (
    SELECT m FROM UNNEST(['cm1_pct', 'cm3_pct', 'meta_ctr', 'google_ctr',
                          'email_open_rate', 'email_click_rate', 'meta_atc_rate']) AS m
  ),
  b AS (
    SELECT * FROM `oneeighty-warehouse.ref.industry_benchmarks` WHERE is_active
  ),
  v AS (
    SELECT * FROM `oneeighty-warehouse.ref.client_verticals`
  ),
  open_v AS (
    SELECT * FROM v WHERE valid_to IS NULL
  ),
  active_clients AS (
    SELECT client_id FROM `oneeighty-warehouse.ref.clients`
    WHERE status = 'active' AND NOT STARTS_WITH(client_id, 'demo')
  ),
  issues AS (
    -- ---- ref.industry_benchmarks (active rows only) ----
    SELECT 'money_without_currency' AS issue_code, 'critical' AS severity, CAST(NULL AS STRING) AS client_id,
           b.benchmark_id, b.vertical, b.metric_id,
           'Money metric has no currency, so it cannot be converted.' AS detail
    FROM b WHERE b.metric_id IN (SELECT m FROM money_metrics) AND (b.currency IS NULL OR TRIM(b.currency) = '')
    UNION ALL
    SELECT 'currency_on_non_money', 'warning', NULL, b.benchmark_id, b.vertical, b.metric_id,
           FORMAT('Currency %s is set on a metric that is not money.', b.currency)
    FROM b WHERE b.metric_id NOT IN (SELECT m FROM money_metrics) AND b.currency IS NOT NULL
    UNION ALL
    SELECT 'percent_not_fraction', 'critical', NULL, b.benchmark_id, b.vertical, b.metric_id,
           FORMAT('Percent metric value %s is above 1. Percents are stored as fractions (1.2 %% is 0.012).', CAST(b.value AS STRING))
    FROM b WHERE b.metric_id IN (SELECT m FROM fraction_metrics) AND b.value > 1
    UNION ALL
    SELECT 'period_inverted', 'critical', NULL, b.benchmark_id, b.vertical, b.metric_id,
           FORMAT('period_end %s is before period_start %s.', CAST(b.period_end AS STRING), CAST(b.period_start AS STRING))
    FROM b WHERE b.period_end < b.period_start
    UNION ALL
    SELECT 'band_inconsistent', 'critical', NULL, b.benchmark_id, b.vertical, b.metric_id,
           FORMAT('Band does not bracket the value: low %s, value %s, high %s.',
                  IFNULL(CAST(b.value_low AS STRING), 'null'), CAST(b.value AS STRING), IFNULL(CAST(b.value_high AS STRING), 'null'))
    FROM b
    WHERE (b.value_low IS NOT NULL AND b.value_high IS NOT NULL AND b.value_low > b.value_high)
       OR (b.value_low IS NOT NULL AND b.value_low > b.value)
       OR (b.value_high IS NOT NULL AND b.value_high < b.value)
    UNION ALL
    SELECT 'invalid_stat', 'critical', NULL, b.benchmark_id, b.vertical, b.metric_id,
           FORMAT('stat "%s" is not one of median, mean, p25, p75.', b.stat)
    FROM b WHERE b.stat NOT IN ('median', 'mean', 'p25', 'p75')
    UNION ALL
    SELECT 'invalid_region', 'critical', NULL, b.benchmark_id, b.vertical, b.metric_id,
           FORMAT('region "%s" is not one of CZ, CEE, EU, US, GLOBAL.', b.region)
    FROM b WHERE b.region NOT IN ('CZ', 'CEE', 'EU', 'US', 'GLOBAL')
    UNION ALL
    SELECT 'duplicate_active_row', 'critical', NULL, b.benchmark_id, b.vertical, b.metric_id,
           FORMAT('%d active rows share vertical, region, metric, period, stat and source.', d.n)
    FROM b
    JOIN (
      SELECT vertical, region, metric_id, period_start, period_end, stat, source, COUNT(*) AS n
      FROM `oneeighty-warehouse.ref.industry_benchmarks`
      WHERE is_active
      GROUP BY 1, 2, 3, 4, 5, 6, 7 HAVING COUNT(*) > 1
    ) d USING (vertical, region, metric_id, period_start, period_end, stat, source)
    UNION ALL
    SELECT 'duplicate_benchmark_id', 'critical', NULL, b.benchmark_id, b.vertical, b.metric_id,
           FORMAT('benchmark_id is used by %d active rows.', d.n)
    FROM b
    JOIN (
      SELECT benchmark_id, COUNT(*) AS n FROM `oneeighty-warehouse.ref.industry_benchmarks`
      WHERE is_active GROUP BY 1 HAVING COUNT(*) > 1
    ) d USING (benchmark_id)
    UNION ALL
    SELECT 'stale_as_of', 'warning', NULL, b.benchmark_id, b.vertical, b.metric_id,
           FORMAT('as_of %s is more than 12 months old. Reports shows it muted as Stale.', CAST(b.as_of AS STRING))
    FROM b WHERE b.as_of < DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
    UNION ALL
    SELECT 'vertical_without_clients', 'warning', NULL, b.benchmark_id, b.vertical, b.metric_id,
           'No open ref.client_verticals row uses this vertical, so no client can match this row.'
    FROM b
    WHERE b.vertical != 'all_ecommerce'
      AND b.vertical NOT IN (SELECT vertical FROM open_v)

    -- ---- ref.client_verticals ----
    UNION ALL
    SELECT 'client_without_vertical', 'warning', c.client_id, NULL, NULL, NULL,
           'Active client has no open vertical row. It only matches all_ecommerce benchmarks.'
    FROM active_clients c
    WHERE c.client_id NOT IN (SELECT client_id FROM open_v)
    UNION ALL
    SELECT 'multiple_open_verticals', 'critical', o.client_id, NULL, NULL, NULL,
           FORMAT('Client has %d open vertical rows (valid_to IS NULL). Close all but one.', o.n)
    FROM (SELECT client_id, COUNT(*) AS n FROM open_v GROUP BY 1 HAVING COUNT(*) > 1) o
    UNION ALL
    SELECT 'vertical_window_inverted', 'critical', v.client_id, NULL, v.vertical, NULL,
           FORMAT('valid_to %s is before valid_from %s.', CAST(v.valid_to AS STRING), CAST(v.valid_from AS STRING))
    FROM v WHERE v.valid_to IS NOT NULL AND v.valid_to < v.valid_from
    UNION ALL
    SELECT 'vertical_invalid_region', 'critical', v.client_id, NULL, v.vertical, NULL,
           FORMAT('region "%s" is not one of CZ, CEE, EU, US, GLOBAL.', v.region)
    FROM v WHERE v.region NOT IN ('CZ', 'CEE', 'EU', 'US', 'GLOBAL')
    UNION ALL
    SELECT 'vertical_not_snake_case', 'warning', v.client_id, NULL, v.vertical, NULL,
           'vertical must be lower snake_case so it matches ref.industry_benchmarks.vertical.'
    FROM v WHERE NOT REGEXP_CONTAINS(v.vertical, r'^[a-z][a-z0-9_]*$')
    UNION ALL
    SELECT 'vertical_unknown_client', 'warning', v.client_id, NULL, v.vertical, NULL,
           'client_id is not in ref.clients.'
    FROM v WHERE v.client_id NOT IN (SELECT client_id FROM `oneeighty-warehouse.ref.clients`)
  )
SELECT issue_code, severity, client_id, benchmark_id, vertical, metric_id, detail
FROM issues;
