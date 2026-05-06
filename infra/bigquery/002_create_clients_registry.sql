-- 002_create_clients_registry.sql
-- The single most important table in the warehouse.
-- Every n8n workflow reads from this. Adding a client = one INSERT here.
--
-- Run order: AFTER 001_create_datasets.sql.

CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.clients` (
  -- Identity
  client_id          STRING    NOT NULL,    -- canonical id, used everywhere (e.g. 'manami')
  slug               STRING    NOT NULL,    -- url-safe slug (matches client_id usually)
  name               STRING    NOT NULL,    -- display name (e.g. 'Manami s.r.o.')

  -- Locale
  currency           STRING    NOT NULL,    -- ISO-4217 (CZK, USD, CAD, EUR)
  timezone           STRING    NOT NULL,    -- IANA tz (Europe/Prague, America/Toronto)
  country            STRING,                -- ISO-3166 alpha-2 (CZ, CA, US)

  -- Platform routing
  shop_platform      STRING,                -- shopify | shoptet | NULL
  email_platform     STRING,                -- klaviyo  | ecomail | NULL

  -- Status
  status             STRING    NOT NULL,    -- active | onboarding | paused

  -- Source flags — workflows filter by these
  has_shopify        BOOL      DEFAULT FALSE,
  has_shoptet        BOOL      DEFAULT FALSE,
  has_klaviyo        BOOL      DEFAULT FALSE,
  has_ecomail        BOOL      DEFAULT FALSE,
  has_meta           BOOL      DEFAULT FALSE,
  has_gads           BOOL      DEFAULT FALSE,
  has_ga4            BOOL      DEFAULT FALSE,
  has_instagram      BOOL      DEFAULT FALSE,

  -- Timestamps
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
OPTIONS (
  description = "Master registry of agency clients. Every workflow loops over rows here filtered by status='active' and the relevant has_<source> flag."
);
