-- 251_ref_client_verticals.sql
-- Reporting Suite (package RS10, design WP10): client to vertical mapping.
--
-- Purpose:    tells the Reports product which benchmark vertical and region each client belongs to.
--             One row per client and validity window; the open row (valid_to IS NULL) is current.
--             Read by dashboard/lib/reports/clients.ts. A client with no open row is shown as the
--             "Unassigned" vertical in vertical splits and only matches 'all_ecommerce' benchmarks.
-- Based on:   new object. Verified 2026-10-05 that `ref.client_verticals` does not exist.
--             ref.clients (5 active clients: dobias, ethia, manami, rawbark, venev) is the key.
-- Affected:   no existing view, mart or client. The table starts EMPTY.
-- Regression: not applicable (new table). Tested as mart_qa.rs10_client_verticals.
-- Seed:       NOT part of this file. The 5 vertical rows were seeded into prod on 2026-10-04
--             (owner confirmed the taxonomy), with a one-off INSERT ... WHERE NOT EXISTS (SELECT 1
--             FROM ref.client_verticals), all open, valid_from 2026-10-01, updated_by
--             matej@oneeighty.cz, note "confirmed by owner 2026-10-04":
--               dobias   pet_supplements  dog_supplements     US
--               rawbark  pet_food         dog_granules        CZ
--               manami   fragrance        natural_perfumery   CZ
--               ethia    skincare         acne_sensitive_skin CZ
--               venev    skincare         natural_cosmetics   CEE
--             Details and rationale: runbooks/31_reporting_benchmarks.md ("Vertical taxonomy").
-- Deploy order: 2 of 3, after 250, before 252. Idempotent. DEPLOYED to prod 2026-10-04 (table created empty, then seeded).
--
-- Rules (BigQuery has no constraints, so ops.v_benchmark_issues in 252 reports violations):
--   at most ONE open row (valid_to IS NULL) per client;
--   valid_to, when set, is on or after valid_from;
--   to change a client's vertical: set valid_to on the old row, insert the new row with
--   valid_from = the day after. Never UPDATE the vertical in place (history would be lost).

CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.client_verticals` (
  client_id     STRING NOT NULL,                  -- ref.clients.client_id
  vertical      STRING NOT NULL,                  -- snake_case, from the agreed taxonomy
  sub_vertical  STRING,
  region        STRING NOT NULL,                  -- primary market for benchmark matching: 'CZ' | 'CEE' | 'EU' | 'US' | 'GLOBAL'
  valid_from    DATE   NOT NULL,
  valid_to      DATE,                             -- NULL = current
  note          STRING,
  updated_by    STRING NOT NULL,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP() NOT NULL
)
OPTIONS (description = 'Client to vertical mapping for benchmark matching in the Reports suite. At most one open row (valid_to IS NULL) per client. See runbooks/31_reporting_benchmarks.md.');

-- Template only (the seed was a one-off, see header):
--
-- INSERT INTO `oneeighty-warehouse.ref.client_verticals`
--   (client_id, vertical, sub_vertical, region, valid_from, valid_to, note, updated_by)
-- VALUES ('<client_id>', '<vertical>', NULL, '<CZ>', DATE '<yyyy-mm-dd>', NULL, '<why>', '<your email>');
