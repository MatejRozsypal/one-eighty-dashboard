-- 250_ref_industry_benchmarks.sql
-- Reporting Suite (package RS10, design WP10): manually maintained industry benchmarks.
--
-- Purpose:    one row per vertical x region x metric x period x stat x source. The Reports
--             product reads this table (rows with is_active) to draw benchmark lines and
--             hover cards next to a client's own metric. The table starts EMPTY on purpose:
--             nothing is invented, every row needs a source and an as_of date.
-- Based on:   new object, nothing existing is changed. Verified 2026-10-05 that
--             `ref.industry_benchmarks` does not exist (ref holds 18 tables, none like it).
-- Affected:   no existing view, mart or client. No dashboard page outside Reports reads it.
-- Regression: not applicable (new table). DDL, a template row, a query and the row delete
--             were tested as mart_qa.rs10_industry_benchmarks (see runbooks/31).
-- Grants:     none needed. `sa-frontend-reader` already has READER on dataset `ref`.
-- Deploy order: 1 of 3. 250, then 251, then 252 (252 reads both tables). Idempotent
--             (CREATE TABLE IF NOT EXISTS). Needs owner OK. NOT EXECUTED against prod.
--
-- Value conventions (the app divides nothing, it compares like with like):
--   percent metrics  as fractions: 1.2 % is 0.012 (cm1_pct, cm3_pct, meta_ctr, google_ctr, ...)
--   ratio metrics    as x:         MER 3.1 is 3.1 (mer, amer, meta_roas, google_roas)
--   money metrics    in `currency`: aov, cac, meta_cpc, meta_cpm, meta_cpa, google_cpc.
--                    currency is REQUIRED for these and NULL for the rest (ops.v_benchmark_issues
--                    flags a violation). meta_cpm is per 1000 impressions, like the metric.
--   metric_id        a registry id from dashboard/lib/reports/registry/ids.ts. Ids are a permanent
--                    contract (METRICS.md, "Reporting registry"). Unknown ids are flagged by the
--                    app on Data Health, which knows the registry; SQL cannot.
--   region           'CZ' | 'CEE' | 'EU' | 'US' | 'GLOBAL'. Matching prefers the client's region,
--                    then EU, then GLOBAL (owner decision 2026-10-05).
--   stat             'median' | 'mean' | 'p25' | 'p75'.
--   vertical         matches ref.client_verticals.vertical, or the fallback 'all_ecommerce'.

CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.industry_benchmarks` (
  benchmark_id     STRING  NOT NULL,              -- e.g. 'pet_food-mer-2025h2-src1', unique per row
  vertical         STRING  NOT NULL,              -- ref.client_verticals.vertical, or 'all_ecommerce'
  region           STRING  NOT NULL,              -- 'CZ' | 'CEE' | 'EU' | 'US' | 'GLOBAL'
  metric_id        STRING  NOT NULL,              -- registry id: 'mer', 'meta_ctr', 'cac', ...
  period_start     DATE    NOT NULL,
  period_end       DATE    NOT NULL,
  stat             STRING  NOT NULL,              -- 'median' | 'mean' | 'p25' | 'p75'
  value            NUMERIC NOT NULL,              -- percents as fractions (0.012), ratios as x (3.1), money in `currency`
  value_low        NUMERIC,                       -- optional interquartile band
  value_high       NUMERIC,
  currency         STRING,                        -- required for money metrics, NULL otherwise
  source           STRING  NOT NULL,              -- shown on hover
  source_url       STRING,
  as_of            DATE    NOT NULL,              -- when we captured it; shown on hover
  definition_note  STRING,                        -- e.g. 'revenue ex VAT; blended paid'
  sample_note      STRING,
  note             STRING,
  is_active        BOOL    DEFAULT TRUE NOT NULL,
  entered_by       STRING  NOT NULL,
  entered_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP() NOT NULL
)
CLUSTER BY vertical, metric_id
OPTIONS (description = 'Manually maintained industry benchmarks for the Reports suite. One row per vertical x region x metric x period x stat x source. Never invent values; cite source and as_of. See runbooks/31_reporting_benchmarks.md.');

-- Template only, NO real values. Copy, fill every <placeholder>, run. Do not commit filled rows
-- that you cannot source. Full flow and checks: runbooks/31_reporting_benchmarks.md.
--
-- INSERT INTO `oneeighty-warehouse.ref.industry_benchmarks`
--   (benchmark_id, vertical, region, metric_id, period_start, period_end, stat, value,
--    value_low, value_high, currency, source, source_url, as_of, definition_note, sample_note,
--    note, entered_by)
-- VALUES ('<vertical>-<metric>-<period>-<src>', '<vertical>', '<EU>', '<metric_id>',
--         DATE '<yyyy-mm-dd>', DATE '<yyyy-mm-dd>', 'median', <value>,
--         NULL, NULL, NULL, '<source name and report title>', '<url or NULL>',
--         DATE '<capture date>', '<how the source defines the metric>', NULL,
--         NULL, '<your email>');
