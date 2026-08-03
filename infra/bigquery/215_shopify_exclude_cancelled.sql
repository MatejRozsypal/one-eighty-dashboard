-- 215_shopify_exclude_cancelled.sql
-- =============================================================================
-- Excludes cancelled orders from the Shopify staging layer, and normalises the
-- two spellings of order status that the warehouse has been carrying.
--
-- WHY: CANCELLED ORDERS WERE COUNTED AS REVENUE
--
-- `mart_daily_kpis` began life as a table (migration 100) whose source query
-- filtered:
--
--     WHERE financial_status IN ('paid', 'partially_refunded')
--
-- Migration 203 rewrote it as a view to add Google Ads spend, and the filter did
-- not survive the rewrite. Since then every order has counted as revenue
-- regardless of state, for every client. Venev made it visible: 355 of its
-- orders are VOIDED, all 355 carry a cancelReason (CUSTOMER / STAFF / FRAUD /
-- OTHER), and they are EUR 18,378 of reported revenue that no one ever paid.
--
-- WHY NOT FILTER ON PAYMENT STATUS
--
-- Because it would delete real money. Venev sells on `Dobierka` (cash on
-- delivery) and `Bank Deposit`. With COD the courier collects the cash, so
-- Shopify never learns the order was paid and leaves it PENDING or
-- PARTIALLY_PAID forever — 268 fulfilled PARTIALLY_PAID orders are exactly this.
-- A `financial_status = 'PAID'` filter is correct for a card-paying US store and
-- wrong for a Czech one. Cancellation, by contrast, means the same thing
-- everywhere, which is why it is the criterion chosen here.
--
-- What is deliberately NOT excluded: the 715 unfulfilled PENDING orders from
-- 2022 (~EUR 31k), where a customer chose bank transfer and never paid. They are
-- almost certainly not revenue either, but "unfulfilled and unpaid" is a
-- judgement about intent, and it was decided to keep the conservative rule.
-- Revisit if 2022 ever matters commercially.
--
-- WHY IN stg AND NOT IN THE MARTS
--
-- Twelve mart views read these two staging views. Adding a predicate to twelve
-- places guarantees that the thirteenth, written next month, forgets it, and
-- then two dashboard pages disagree about revenue with no visible reason. One
-- filter here moves all twelve together.
--
-- The cancelled rows are NOT lost — `raw.raw_shopify_orders` keeps every one of
-- them, which is where the diagnosis above was done. A cancellation-rate metric
-- (worth building: 8.5% of Venev's orders) reads raw, or gets its own stg view.
--
-- THE TWO ALPHABETS
--
-- `financial_status` and `fulfillment_status` arrive in two vocabularies:
-- lowercase `paid` / `fulfilled` from the REST API, which is what the n8n daily
-- sync calls, and uppercase `PAID` / `FULFILLED` from the GraphQL Bulk API,
-- which is what backfills use. Dobias holds 109,357 rows of the first and 71,432
-- of the second. Any filter or GROUP BY on these columns is therefore silently
-- wrong on half the data — including migration 100's original lowercase-only
-- filter, which would have matched nothing at all in a bulk-loaded client.
--
-- Venev has not caught this yet: its history came from one bulk export, so it is
-- uniformly uppercase. It would have started drifting the moment its n8n cron
-- was switched on. Normalising here closes it for every client, present and
-- future. REST also returns an empty fulfillment_status for unfulfilled orders
-- where GraphQL returns UNFULFILLED; the empty string becomes NULL.
--
-- KNOCK-ON: NEW VS RETURNING SHIFTS SLIGHTLY
--
-- `is_returning_customer` is derived from each customer's order sequence, so
-- removing rows renumbers it: a customer whose first-ever order was cancelled
-- now has their second order counted as their first. That is the right answer —
-- a cancelled order is not a purchase, so it should not consume someone's
-- first-time status — but it means new/returning splits, cohort assignment and
-- CAC move a little for every client, not only Venev. Expect small changes in
-- `mart_customer_cohorts`, `mart_customer_payback` and the aMER family.
--
-- Supersedes the stg_shopify_orders statement in 214.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shopify_orders` AS
WITH client_ccy AS (
  SELECT client_id, currency AS client_currency
  FROM `oneeighty-warehouse.ref.clients`
),
deduped AS (
  SELECT * EXCEPT(rn, is_returning_customer, order_date)
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, order_id ORDER BY ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_shopify_orders`
    WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
      -- Cancelled orders are not business. See the header for why this is the
      -- criterion rather than payment status, and where the rows went.
      AND cancelled_at IS NULL
  ) WHERE rn = 1
),
joined AS (
  SELECT
    d.*,
    c.client_currency,
    DATE(d.processed_at) AS order_date_raw_processed,
    IF(d.currency = c.client_currency, CAST(1.0 AS NUMERIC), fx.rate) AS fx_rate
  FROM deduped d
  JOIN client_ccy c
    ON c.client_id = d.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
    ON  fx.from_currency = d.currency
    AND fx.to_currency   = c.client_currency
    AND fx.month_start   = DATE_TRUNC(DATE(d.processed_at), MONTH)
)
SELECT
  client_id, ingested_at, ingest_source, order_id, order_number,
  order_date_raw_processed AS order_date,
  DATE(created_at)         AS order_created_date,
  created_at, updated_at, processed_at,
  currency        AS currency_original,
  client_currency AS currency,
  fx_rate,
  CASE WHEN source_name = 'Matrixify App' THEN 'canada_migrated' ELSE 'us_native' END AS store_origin,
  presentment_currency,
  subtotal_price  AS subtotal_price_original,
  total_shipping  AS total_shipping_original,
  total_tax       AS total_tax_original,
  total_discounts AS total_discounts_original,
  total_price     AS total_price_original,
  total_refunded  AS total_refunded_original,
  subtotal_price  * fx_rate AS subtotal_price,
  total_shipping  * fx_rate AS total_shipping,
  total_tax       * fx_rate AS total_tax,
  total_discounts * fx_rate AS total_discounts,
  total_price     * fx_rate AS total_price,
  total_refunded  * fx_rate AS total_refunded,
  customer_id, customer_email, shipping_country, shipping_province,
  -- One vocabulary. REST says 'paid', GraphQL says 'PAID'; both mean paid.
  UPPER(financial_status)                     AS financial_status,
  NULLIF(UPPER(fulfillment_status), '')       AS fulfillment_status,
  cancelled_at, source_name,
  payload_json, line_items,
  CASE
    WHEN customer_email IS NULL OR TRIM(customer_email) = '' THEN CAST(NULL AS BOOL)
    ELSE ROW_NUMBER() OVER (
      PARTITION BY client_id, LOWER(TRIM(customer_email))
      ORDER BY processed_at, order_id
    ) > 1
  END AS is_returning_customer
FROM joined;
