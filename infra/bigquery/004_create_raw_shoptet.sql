-- 004_create_raw_shoptet.sql
-- Two tables matching the existing n8n Transform Item Data node output:
--   raw_shoptet_orders       — one row per order_code (transform's _type='order')
--   raw_shoptet_order_items  — one row per (order_code, item_code, variant) (transform's _type='item')
--
-- Columns are camelCase to match the transform output → BQ Insert nodes map directly with no rename step.
-- Renamed transform's `date` → `orderDate` to avoid BQ reserved-word friction. One line change in transform.
--
-- Run order: AFTER 002 (clients registry).

-- =============================================================================
-- ORDERS — order rollup
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_shoptet_orders` (
  client_id              STRING    NOT NULL,
  ingested_at            TIMESTAMP NOT NULL,

  -- Identity
  code                   STRING    NOT NULL,
  orderDate              DATE      NOT NULL,
  statusName             STRING,
  sourceName             STRING,

  -- Customer (PII)
  email                  STRING,
  phone                  STRING,

  -- Currency
  currency               STRING,
  exchangeRate           NUMERIC,

  -- Money (native)
  totalPriceWithVat      NUMERIC,
  totalPriceWithoutVat   NUMERIC,
  priceToPay             NUMERIC,

  -- Money (CZK converted by transform)
  totalPriceWithVatCZK   NUMERIC,
  totalPriceWithoutVatCZK NUMERIC,
  priceToPayCZK          NUMERIC,

  -- Logistics
  cashOnDelivery         NUMERIC,
  weight                 NUMERIC,
  packageNumber          STRING,
  shopRemark             STRING,
  paymentForm            STRING,
  shippingMethod         STRING,
  paymentMethod          STRING,

  -- Item rollup (computed in transform)
  itemCount              INT64,
  totalQuantity          INT64,
  productRevenue         NUMERIC,
  productRevenueCZK      NUMERIC,
  totalPurchasePrice     NUMERIC,
  totalPurchasePriceCZK  NUMERIC,
  totalMargin            NUMERIC,
  totalMarginCZK         NUMERIC,

  -- Customer history (computed in transform)
  customerOrderCount     INT64,
  isReturningCustomer    BOOL,

  payload_json           STRING
)
PARTITION BY orderDate
CLUSTER BY client_id, statusName
OPTIONS (
  description = "Shoptet orders, aggregated by code. Source: n8n transform from CSV export. One row per order_code per ingest run.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- ORDER ITEMS — line-level
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_shoptet_order_items` (
  client_id                   STRING    NOT NULL,
  ingested_at                 TIMESTAMP NOT NULL,

  itemKey                     STRING    NOT NULL,
  orderCode                   STRING    NOT NULL,
  orderDate                   DATE      NOT NULL,
  statusName                  STRING,

  -- Repeated from order (denormalized for analytical convenience)
  currency                    STRING,
  exchangeRate                NUMERIC,
  email                       STRING,
  sourceName                  STRING,

  -- Item identity
  itemName                    STRING,
  itemCode                    STRING,
  itemVariantName             STRING,
  itemManufacturer            STRING,
  itemEan                     STRING,

  -- Quantity + price
  itemAmount                  NUMERIC,
  itemUnitPriceWithVat        NUMERIC,
  itemTotalPriceWithVat       NUMERIC,
  itemTotalPriceWithVatCZK    NUMERIC,
  itemTotalPriceWithoutVat    NUMERIC,
  itemVatRate                 NUMERIC,

  -- Cost + margin
  itemUnitPurchasePrice       NUMERIC,
  itemTotalPurchasePrice      NUMERIC,
  itemTotalPurchasePriceCZK   NUMERIC,
  itemMargin                  NUMERIC,
  itemMarginCZK               NUMERIC,
  itemMarginPercent           NUMERIC,

  itemDiscountPercent         NUMERIC,

  payload_json                STRING
)
PARTITION BY orderDate
CLUSTER BY client_id, itemCode
OPTIONS (
  description = "Shoptet order line items (product type only). Source: n8n transform from CSV export.",
  require_partition_filter = TRUE
);
