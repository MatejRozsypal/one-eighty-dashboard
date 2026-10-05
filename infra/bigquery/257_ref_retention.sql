-- =============================================================================
-- 257_ref_retention.sql
-- Retention reference data: per-client settings and rename-safe product classes, with the
-- Manami seed. Package WR1 of retention/03_design.md, section 2.1 (design number 255,
-- renumbered to 257 because 255 and 256 are taken by other packages).
--
-- Change (additive, nothing existing is modified)
--   NEW TABLE  ref.retention_settings   one optional row per client:
--                data_start_date      NULL = the client's earliest valid order
--                history_guard_days   customers first seen in the first N days of data are
--                                     "early" (left censoring, design 1.7). Default 0.
--                sync_lag_days        cut-off = yesterday (client time zone) minus this. Default 3.
--                primary_horizon_days default 90
--              Clients without a row get guard 0, lag 3, horizon 90 (applied in the
--              procedure of migration 258, not by column defaults).
--   NEW TABLE  ref.product_classes      line classification rules per client (design 1.4).
--              match_type: code | code_base | code_prefix | name_prefix | name_regex | default.
--              The matching rule with the lowest priority wins. valid_from / valid_to bound
--              reused codes. A client with no rows has entry_class NULL in
--              mart.rpt_customer_entry and the UI hides entry classes for it.
--   SEED       Manami: 40 rules (32 code rules, 7 name fallbacks, 1 default), design table
--              2.1, owner decisions of 2026-10-05: 5 ml and perfume bundles are full
--              size, gift sets 249/252/412/415 stay under default
--              "other", 153 = discovery, 409 = gift set). Name rules are fallbacks for
--              lines whose code nobody mapped. In name patterns "." stands for the en dash
--              of the product names, so no dash character enters the repo.
--              Settings: one Manami row ('manami', 2024-05-06, guard 180, lag 3, horizon 90).
--              Other clients: no row.
--
-- Based on: nothing live (new objects). Codes checked against stg.stg_shoptet_order_items
-- on 2026-10-05: every Manami line has an item_code; the coded rules cover all perfume,
-- sample, set and bundle lines, so the name rules match nothing today (lines by winning
-- rule: code 1,908, code_base 2,753, default 2,379, name 0).
--
-- Affected clients: none of the existing objects change. Regression and acceptance:
-- qa/258_rpt_customer_entry_regression.sql (the audit parity run in mart_qa used the same
-- seed with guard 0 and lag 0).
--
-- Deploy order (owner approved 2026-10-05, after the mart_qa regression passed; done
-- 2026-10-05, 40 rule rows and 1 settings row on prod)
--   1. This file (two CREATE TABLE, two INSERT).
--   2. 258_rpt_customer_entry.sql.
-- Rollback: DROP TABLE ref.product_classes; DROP TABLE ref.retention_settings
-- (after rolling back 258, whose procedure reads them).
-- =============================================================================

-- 1. Settings
CREATE TABLE `oneeighty-warehouse.ref.retention_settings`
(
  client_id STRING NOT NULL,
  data_start_date DATE OPTIONS(description="First day of complete order history. NULL = the client's earliest valid order."),
  history_guard_days INT64 NOT NULL OPTIONS(description="Customers whose first order is before data_start_date + this many days are flagged is_early (they may be returning customers from before the data start). 0 = history complete."),
  sync_lag_days INT64 NOT NULL OPTIONS(description="cutoff_date = yesterday in the client time zone minus this many days. Buffer for late syncs and late cancellations."),
  primary_horizon_days INT64 NOT NULL OPTIONS(description="Headline horizon in days for the Repeat rate page."),
  note STRING,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
OPTIONS(
  description="Retention settings per client, optional. A client without a row uses data_start_date NULL, history_guard_days 0, sync_lag_days 3, primary_horizon_days 90. Read by mart.sp_refresh_rpt_customer_entry. Migration 257."
);

-- 2. Product classes
CREATE TABLE `oneeighty-warehouse.ref.product_classes`
(
  client_id STRING NOT NULL,
  match_type STRING NOT NULL OPTIONS(description="code | code_base | code_prefix | name_prefix | name_regex | default"),
  pattern STRING NOT NULL OPTIONS(description="Value compared with the line code, code base or name. '*' for default."),
  line_class STRING NOT NULL OPTIONS(description="discovery | sample | full | bundle | gift_set | accessory | other"),
  counts_as_full BOOL NOT NULL OPTIONS(description="TRUE for full-size products and packs of them (full, bundle)."),
  priority INT64 NOT NULL OPTIONS(description="Lower wins when several rules match a line."),
  valid_from DATE OPTIONS(description="Rule applies to orders on or after this date. NULL = always."),
  valid_to DATE OPTIONS(description="Rule applies to orders before this date. NULL = always."),
  label STRING,
  note STRING,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
CLUSTER BY client_id
OPTIONS(
  description="Per-client order line classes for retention (entry class, upgrade to full size). Line code: Shoptet item_code (code_base = part before '/'), Shopify sku, WooCommerce sku else variation_id else product_id. The matching rule with the lowest priority wins; a line matching only 'default' or no rule is unclassified (ops.v_unclassified_products). Migration 257."
);

-- 3. Manami settings: Shoptet backfill starts 2024-05-06, guard 180 days (owner decision).
INSERT INTO `oneeighty-warehouse.ref.retention_settings`
  (client_id, data_start_date, history_guard_days, sync_lag_days, primary_horizon_days, note)
VALUES
  ('manami', DATE '2024-05-06', 180, 3, 90,
   'Shoptet backfill starts 2024-05-06, earlier sales unknown. Guard 180 approved by the owner 2026-10-05.');

-- 4. Manami product classes (design 2.1, reviewed 2026-10-05)
INSERT INTO `oneeighty-warehouse.ref.product_classes`
  (client_id, match_type, pattern, line_class, counts_as_full, priority, label, note)
SELECT 'manami', match_type, pattern, line_class, counts_as_full, priority, label,
       'reviewed 2026-10-05'
FROM UNNEST([
  STRUCT('code' AS match_type, '153' AS pattern, 'discovery' AS line_class, FALSE AS counts_as_full, 10 AS priority, 'Testovaci sada parfemu (sample set)' AS label),
  ('code_base', '409',  'gift_set',  FALSE, 20,  'Test gift set and voucher'),
  ('code_base', '75',   'sample',    FALSE, 30,  'Single perfume sample, Tester'),
  ('code_base', '472',  'sample',    FALSE, 30,  'Single perfume sample, limited edition'),
  ('code_base', '564',  'sample',    FALSE, 30,  'Single perfume sample'),
  ('code_base', '1001', 'full',      TRUE,  40,  'Perfume'),
  ('code_base', '1002', 'full',      TRUE,  40,  'Perfume'),
  ('code_base', '1003', 'full',      TRUE,  40,  'Perfume'),
  ('code_base', '1004', 'full',      TRUE,  40,  'Perfume'),
  ('code_base', '1005', 'full',      TRUE,  40,  'Perfume'),
  ('code_base', '46',   'full',      TRUE,  40,  'Perfume'),
  ('code_base', '51',   'full',      TRUE,  40,  'Perfume'),
  ('code_base', '54',   'full',      TRUE,  40,  'Perfume'),
  ('code_base', '57',   'full',      TRUE,  40,  'Perfume'),
  ('code_base', '60',   'full',      TRUE,  40,  'Perfume'),
  ('code_base', '102',  'full',      TRUE,  40,  'Perfume'),
  ('code_base', '403',  'full',      TRUE,  40,  'Perfume'),
  ('code_base', '469',  'full',      TRUE,  40,  'Perfume, limited edition'),
  ('code_base', '290',  'full',      TRUE,  40,  'Personal perfume'),
  ('code_base', '551',  'bundle',    TRUE,  50,  'Perfume bundle'),
  ('code_base', '554',  'bundle',    TRUE,  50,  'Perfume bundle, limited edition'),
  ('code_base', '557',  'bundle',    TRUE,  50,  'Perfume bundle, limited edition'),
  ('code_base', '560',  'bundle',    TRUE,  50,  'Perfume bundle, limited edition'),
  ('code_base', '563',  'bundle',    TRUE,  50,  'Perfume bundle, limited edition'),
  ('code_base', '570',  'bundle',    TRUE,  50,  'Perfume bundle, autumn'),
  ('code_base', '573',  'bundle',    TRUE,  50,  'Perfume bundle, autumn'),
  ('code_base', '576',  'bundle',    TRUE,  50,  'Perfume bundle, autumn'),
  ('code_base', '579',  'bundle',    TRUE,  50,  'Perfume bundle, autumn'),
  ('code_base', '473',  'accessory', FALSE, 60,  'Gift pouch'),
  ('code_base', '306',  'accessory', FALSE, 60,  'Gift pouch'),
  ('code_base', '78',   'accessory', FALSE, 60,  'Gift packaging'),
  ('code_base', '79',   'accessory', FALSE, 60,  'Gift packaging'),
  ('name_prefix', 'Testovací sada', 'discovery', FALSE, 100, 'Name fallback: sample set'),
  ('name_prefix', 'Vzorek parfému', 'sample',    FALSE, 101, 'Name fallback: perfume sample'),
  ('name_regex',  '^Tester$',       'sample',    FALSE, 101, 'Name fallback: tester'),
  ('name_prefix', 'Parfém ',        'full',      TRUE,  102, 'Name fallback: perfume'),
  ('name_prefix', 'Osobní JEDINEČNÝ parfém', 'full', TRUE, 102, 'Name fallback: personal perfume'),
  ('name_regex',  '^Něžná . .*[Ll]imitovaná edice', 'full', TRUE, 102, 'Name fallback: limited edition perfume'),
  ('name_regex',  '^(Letní rituál na cesty|Podzimní balíček|(Gardénie|Jasmín|Lilie|Magnólie) . limitovaná edice)', 'bundle', TRUE, 103, 'Name fallback: perfume bundle'),
  ('default',     '*',              'other',     FALSE, 999, 'Everything else: oils, oil samples, flower waters, salts, roll-ons, calendars, vouchers, other gift sets (249, 252, 412, 415)')
]);
