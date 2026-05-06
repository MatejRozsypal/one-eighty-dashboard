-- 006_create_raw_shopify.sql
-- Raw layer for Shopify (Dr. Dobias). Three tables: orders, products, customers.
--
-- Two modes of ingest:
--   1. Webhooks (orders/create, orders/paid, orders/updated, customers/update, products/update) — real-time
--   2. Backfill — REST API pagination on first run, 24-month window
--
-- Both modes append to the same table. Use latest row per (client_id, order_id) for current state.
--
-- Run order: AFTER 002.

-- =============================================================================
-- ORDERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_shopify_orders` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  ingest_source        STRING    NOT NULL,     -- 'webhook' | 'backfill' | 'reconcile'

  order_id             STRING    NOT NULL,
  order_number         STRING,                  -- Shopify's display order number (#1023)
  order_date           DATE      NOT NULL,
  created_at           TIMESTAMP,
  updated_at           TIMESTAMP,
  processed_at         TIMESTAMP,

  -- Money (raw transaction currency — Dr Dobias trades in USD natively per session)
  currency             STRING,                  -- store currency (USD)
  presentment_currency STRING,                  -- what the customer saw (USD or CAD)
  subtotal_price       NUMERIC,
  total_shipping       NUMERIC,
  total_tax            NUMERIC,
  total_discounts      NUMERIC,
  total_price          NUMERIC,

  -- Customer
  customer_id          STRING,
  customer_email       STRING,
  is_returning_customer BOOL,
  shipping_country     STRING,
  shipping_province    STRING,

  -- Lifecycle
  financial_status     STRING,                  -- pending | paid | refunded | partially_refunded
  fulfillment_status   STRING,                  -- unfulfilled | partial | fulfilled
  cancelled_at         TIMESTAMP,
  source_name          STRING,                  -- web | pos | shopify_draft_order

  -- Line items
  line_items ARRAY<STRUCT<
    line_item_id    STRING,
    product_id      STRING,
    variant_id      STRING,
    sku             STRING,
    title           STRING,
    quantity        INT64,
    price           NUMERIC,
    total_discount  NUMERIC,
    fulfillment_status STRING
  >>,

  -- Audit
  payload_json         STRING
)
PARTITION BY order_date
CLUSTER BY client_id, financial_status
OPTIONS (
  description = "Shopify orders. Append-only. Webhook-driven for new/updated, backfill for history. Latest row per order_id is current state.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- PRODUCTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_shopify_products` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  ingest_source        STRING    NOT NULL,
  product_id           STRING    NOT NULL,
  variant_id           STRING,
  sku                  STRING,
  title                STRING,
  product_type         STRING,
  vendor               STRING,
  status               STRING,                  -- active | archived | draft
  price                NUMERIC,
  compare_at_price     NUMERIC,
  cost                 NUMERIC,                 -- inventory cost; may be NULL
  inventory_quantity   INT64,
  created_at           TIMESTAMP,
  updated_at           TIMESTAMP,
  payload_json         STRING
)
PARTITION BY DATE(ingested_at)
CLUSTER BY client_id, product_id
OPTIONS (
  description = "Shopify products + variants flat. Webhook-driven on update.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- CUSTOMERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_shopify_customers` (
  client_id            STRING    NOT NULL,
  ingested_at          TIMESTAMP NOT NULL,
  ingest_source        STRING    NOT NULL,
  customer_id          STRING    NOT NULL,
  email                STRING,
  first_name           STRING,
  last_name            STRING,
  city                 STRING,
  province             STRING,
  country              STRING,
  total_orders         INT64,
  total_spent          NUMERIC,
  currency             STRING,
  first_order_at       TIMESTAMP,
  last_order_at        TIMESTAMP,
  accepts_marketing    BOOL,
  created_at           TIMESTAMP,
  updated_at           TIMESTAMP,
  payload_json         STRING
)
PARTITION BY DATE(ingested_at)
CLUSTER BY client_id, customer_id
OPTIONS (
  description = "Shopify customers. PII-bearing — frontend service account must NOT have read access.",
  require_partition_filter = TRUE
);
