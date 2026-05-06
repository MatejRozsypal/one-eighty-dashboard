-- 004_create_raw_shoptet.sql
-- Raw layer for Shoptet (Czech e-commerce). Three tables: orders, products, customers.
-- All append-only. payload_json column preserves the untouched API response.
--
-- Partition strategy: business date column (PARTITION BY)
-- Cluster strategy: client_id first (every query filters by tenant)
--
-- Run order: AFTER 002.

-- =============================================================================
-- ORDERS — the revenue spine
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_shoptet_orders` (
  -- Identity & ingest metadata
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  order_id             STRING    NOT NULL,
  order_code           STRING,                  -- Shoptet's human-readable order number

  -- When
  order_date           DATE      NOT NULL,      -- partition key
  created_at           TIMESTAMP,
  updated_at           TIMESTAMP,

  -- Money (raw native currency — DO NOT pre-convert)
  currency             STRING,
  subtotal             NUMERIC,
  shipping             NUMERIC,
  tax                  NUMERIC,
  discount             NUMERIC,
  total                NUMERIC,

  -- Customer
  customer_id          STRING,
  customer_email       STRING,
  customer_phone       STRING,
  is_returning_customer BOOL,
  shipping_country     STRING,                  -- two-letter ISO code

  -- Status
  status               STRING,                  -- new | processing | shipped | done | cancelled
  payment_method       STRING,
  shipping_method      STRING,

  -- Line items (nested for analytical queries; payload_json keeps the raw)
  line_items ARRAY<STRUCT<
    sku           STRING,
    product_id    STRING,
    variant_id    STRING,
    name          STRING,
    quantity      INT64,
    unit_price    NUMERIC,
    discount      NUMERIC,
    total         NUMERIC
  >>,

  -- Audit
  payload_json         STRING                   -- entire original Shoptet API response
)
PARTITION BY order_date
CLUSTER BY client_id, status
OPTIONS (
  description = "Shoptet orders. Append-only. Partitioned by order_date (24-month backfill on initial load). One row per order_id × ingest run.",
  partition_expiration_days = NULL,            -- never expire; we keep history
  require_partition_filter = TRUE              -- forces queries to filter by date — keeps cost free
);

-- =============================================================================
-- PRODUCTS — for SKU-level reporting
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_shoptet_products` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  product_id           STRING    NOT NULL,
  sku                  STRING,
  name                 STRING,
  category_path        STRING,                  -- e.g. "Parfumerie / Dámské"
  brand                STRING,
  price                NUMERIC,
  cost_price           NUMERIC,                 -- for margin calc; may be NULL if not in Shoptet
  inventory_quantity   INT64,
  status               STRING,                  -- visible | hidden | archived
  created_at           TIMESTAMP,
  updated_at           TIMESTAMP,
  payload_json         STRING
)
PARTITION BY DATE(ingested_at)
CLUSTER BY client_id, product_id
OPTIONS (
  description = "Shoptet products. Snapshot per ingest. Use latest snapshot per product_id for current state.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- CUSTOMERS — for LTV, return-customer rate
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_shoptet_customers` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  customer_id          STRING    NOT NULL,
  email                STRING,
  first_name           STRING,
  last_name            STRING,
  city                 STRING,
  country              STRING,
  total_orders         INT64,
  total_spent          NUMERIC,
  first_order_at       TIMESTAMP,
  last_order_at        TIMESTAMP,
  created_at           TIMESTAMP,
  payload_json         STRING
)
PARTITION BY DATE(ingested_at)
CLUSTER BY client_id, customer_id
OPTIONS (
  description = "Shoptet customers. Snapshot per ingest. Latest snapshot = current state.",
  require_partition_filter = TRUE
);
