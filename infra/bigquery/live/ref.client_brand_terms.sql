CREATE TABLE `oneeighty-warehouse.ref.client_brand_terms`
(
  client_id STRING NOT NULL,
  term STRING NOT NULL,
  term_norm STRING NOT NULL,
  match_type STRING NOT NULL,
  is_exclusion BOOL NOT NULL,
  applies_to STRING NOT NULL,
  note STRING,
  added_by STRING,
  updated_at TIMESTAMP NOT NULL
)
CLUSTER BY client_id
OPTIONS(
  description="Per-client brand vocabulary. Classifies Google campaigns, search terms and keywords as brand or non-brand. One row per term variant; misspellings are separate rows. term_norm is lower case, diacritics stripped, whitespace collapsed."
);
