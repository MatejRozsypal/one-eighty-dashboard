-- 241_ref_client_brand_terms.sql
-- Paid redesign (package PA2): per-client brand vocabulary.
--
-- Purpose:    one row per brand term variant per client. Classifies Google Ads
--             campaigns, search terms and keywords as brand or non-brand (owner
--             decision: brand vs non-brand is a per-client list, not a naming
--             convention). Read by 242_gads_marts.sql.
-- Based on:   new object, nothing existing is changed. Verified on 2026-10-04 that
--             `ref.client_brand_terms` does not exist yet.
-- Affected:   no existing view or client. Seeds only the obvious terms; the owner adds
--             the rest (misspellings, product-line brand names, competitor-neutral
--             variants) with the INSERT helper in runbooks/17_google_ads_to_bigquery.md
--             ("Paid marts and brand terms").
-- Regression: not applicable (new table). Seed was tested as mart_qa.pa2_client_brand_terms.
-- Deploy order: 1 of 2. Run this file, then 242_gads_marts.sql. Idempotent: the table is
--             CREATE IF NOT EXISTS and the seed skips rows that already exist.
--
-- Normalisation used everywhere (views and the INSERT helper):
--   TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(NORMALIZE(x, NFD)), r'\p{M}', ''), r'\s+', ' '))
--   = lower case, diacritics stripped, whitespace collapsed.
--
-- Brand match for a normalised text t, client c, scope s ('campaign' | 'search_term'):
--   EXISTS a non-exclusion term of c with applies_to IN ('all', s) that matches t
--   AND NOT EXISTS an exclusion term of c with applies_to IN ('all', s) that matches t.
--   match_type: contains = STRPOS; word = whole-word regex (term is regex-escaped);
--               exact = equality; regex = term_norm is used as an RE2 pattern as typed.

CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.client_brand_terms` (
  client_id     STRING    NOT NULL,
  term          STRING    NOT NULL,   -- as typed, for display ("RawBark", "raw bark")
  term_norm     STRING    NOT NULL,   -- normalised (see header); written by the INSERT helper
  match_type    STRING    NOT NULL,   -- 'contains' | 'word' | 'exact' | 'regex'
  is_exclusion  BOOL      NOT NULL,   -- TRUE = a match makes the text NOT brand (generic word containing the brand)
  applies_to    STRING    NOT NULL,   -- 'all' | 'search_term' | 'campaign'
  note          STRING,
  added_by      STRING,
  updated_at    TIMESTAMP NOT NULL
)
CLUSTER BY client_id
OPTIONS (description = "Per-client brand vocabulary. Classifies Google campaigns, search terms and keywords as brand or non-brand. One row per term variant; misspellings are separate rows. term_norm is lower case, diacritics stripped, whitespace collapsed.");

-- Seed: only the obvious terms. Re-runnable.
INSERT INTO `oneeighty-warehouse.ref.client_brand_terms`
  (client_id, term, term_norm, match_type, is_exclusion, applies_to, note, added_by, updated_at)
SELECT s.client_id, s.term, s.term_norm, 'contains', FALSE, 'all', 'seed 2026-10-04: obvious brand name only', 'pa2_seed', CURRENT_TIMESTAMP()
FROM UNNEST([
  STRUCT('manami'  AS client_id, 'manami'   AS term, 'manami'   AS term_norm),
  STRUCT('rawbark' AS client_id, 'rawbark'  AS term, 'rawbark'  AS term_norm),
  STRUCT('rawbark' AS client_id, 'raw bark' AS term, 'raw bark' AS term_norm)
]) s
WHERE NOT EXISTS (
  SELECT 1 FROM `oneeighty-warehouse.ref.client_brand_terms` t
  WHERE t.client_id = s.client_id AND t.term_norm = s.term_norm
    AND t.match_type = 'contains' AND t.is_exclusion = FALSE AND t.applies_to = 'all'
);
