-- 007a_create_raw_klaviyo_forms.sql
-- Raw layer for Klaviyo forms (popups, embedded, flyouts).
-- Metadata snapshot — submission/conversion metrics flow via /api/events/ when
-- we eventually wire the events branch.
--
-- Run order: AFTER 002.

CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_klaviyo_forms` (
  client_id     STRING    NOT NULL,
  ingested_at   TIMESTAMP NOT NULL,
  snapshot_date DATE      NOT NULL,

  form_id       STRING    NOT NULL,
  form_name     STRING,
  status        STRING,                       -- draft | live | archived
  archived      BOOL,
  ab_test       BOOL,

  created_at    TIMESTAMP,
  updated_at    TIMESTAMP,

  payload_json  STRING
)
PARTITION BY snapshot_date
CLUSTER BY client_id, form_id
OPTIONS (
  description = "Klaviyo forms (popups, embedded, flyouts). Daily snapshot of metadata.",
  require_partition_filter = TRUE
);
