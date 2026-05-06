-- 001_create_datasets.sql
-- Creates the five datasets that hold the entire warehouse.
-- Run order: this is the FIRST SQL to execute. Nothing else works without datasets.
--
-- Datasets:
--   raw  — append-only floor of truth, every API payload preserved
--   ref  — slowly-changing reference data (clients registry, fx rates)
--   stg  — staging layer that unifies sources (built later, in Phase 3)
--   mart — canonical metric layer powering Looker + frontend
--   ops  — pipeline logs, audit trails, operational housekeeping
--
-- Region: EU (sets data residency for GDPR compliance — Manami is CZ)
-- Cost: free. Datasets are metadata only.

CREATE SCHEMA IF NOT EXISTS `oneeighty-warehouse.raw`
OPTIONS (
  location = "EU",
  description = "Append-only raw ingest layer. One row per API record, payload_json preserved."
);

CREATE SCHEMA IF NOT EXISTS `oneeighty-warehouse.ref`
OPTIONS (
  location = "EU",
  description = "Reference data: clients registry, fx rates, product cost overrides."
);

CREATE SCHEMA IF NOT EXISTS `oneeighty-warehouse.stg`
OPTIONS (
  location = "EU",
  description = "Staging layer: cross-source unified views (built in Phase 3 when needed)."
);

CREATE SCHEMA IF NOT EXISTS `oneeighty-warehouse.mart`
OPTIONS (
  location = "EU",
  description = "Canonical metric layer. KPIs, profit-share, MER. Powers Looker and frontend."
);

CREATE SCHEMA IF NOT EXISTS `oneeighty-warehouse.ops`
OPTIONS (
  location = "EU",
  description = "Pipeline logs, audit trails, scheduled-query monitoring."
);
