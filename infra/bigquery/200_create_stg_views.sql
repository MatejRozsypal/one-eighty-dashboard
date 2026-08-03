-- 200_create_stg_views.sql
-- Deduplicated views over the raw layer. Looker Studio and any other
-- BI tool should query stg.* — NEVER raw.* — to get one row per natural
-- key, always with the most recent ingested_at version of that row.
--
-- All views WHERE-filter on the underlying partition column to satisfy
-- the raw tables' require_partition_filter=TRUE. Window is 36 months
-- (generous enough for YoY + comparison-over-prior-year analytics,
-- tight enough that query bytes stay small).
--
-- Run order: AFTER all raw DDL (001–011) and after at least one ingest
-- run per workflow so the underlying tables exist.
--
-- Re-running this file is safe — every statement is CREATE OR REPLACE.

-- =============================================================================
-- META ADS — period metrics, dedup by (client, entity, date_start)
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_meta_campaign_insights` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, campaign_id, date_start ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_meta_campaign_insights`
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_meta_ad_insights` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, ad_id, date_start ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_meta_ad_insights`
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

-- =============================================================================
-- ECOMAIL — campaigns dedup by campaign_id (cumulative state),
-- automations + lists dedup by (entity, snapshot_date) preserving history
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_ecomail_campaigns` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, campaign_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_ecomail_campaigns`
  WHERE DATE(sent_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_ecomail_automations` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, pipeline_id, snapshot_date ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_ecomail_automations`
  WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_ecomail_lists` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, list_id, snapshot_date ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_ecomail_lists`
  WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

-- =============================================================================
-- KLAVIYO — campaigns by campaign_id, flows + forms by (entity, snapshot_date)
-- =============================================================================
-- stg_klaviyo_campaigns — JOINs metadata (raw_klaviyo_campaigns) with the latest
-- snapshot of performance metrics (raw_klaviyo_campaign_reports).
-- Reasoning: Klaviyo's /api/campaigns/ endpoint returns metadata only (name,
-- send_time, recipients). All performance stats (delivered, opens, clicks,
-- conversions, revenue) require a separate POST to /api/campaign-values-reports/
-- with a conversion_metric_id (Shopify "Placed Order" = Vyfqq8 for Dobias).
-- The report endpoint is bound to a 1-year max timeframe and needs chunked calls
-- for longer history. See runbook 15 for backfill pattern.
--
-- Currency override: Dobias was wrongly tagged CAD in raw_klaviyo_campaigns
-- (n8n default from when we thought Dobias was Canadian). Real conversion
-- currency is USD (Shopify's "Placed Order" sends USD per Dobias's USD shop).
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_klaviyo_campaigns` AS
WITH metadata AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, campaign_id ORDER BY ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_klaviyo_campaigns`
    WHERE DATE(send_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  ) WHERE rn = 1
),
reports AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, campaign_id ORDER BY ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_klaviyo_campaign_reports`
    WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  ) WHERE rn = 1
)
SELECT
  m.client_id, m.ingested_at, m.campaign_id, m.campaign_name,
  COALESCE(r.send_channel, m.channel) AS channel,
  m.status, m.send_time, m.list_id, m.list_name, m.segment_id,
  COALESCE(CAST(r.recipients AS INT64),     m.recipients)     AS recipients,
  COALESCE(CAST(r.delivered AS INT64),      m.delivered)      AS delivered,
  COALESCE(CAST(r.bounced AS INT64),        m.bounces)        AS bounces,
  COALESCE(CAST(r.opens AS INT64),          m.opens)          AS opens,
  COALESCE(CAST(r.opens_unique AS INT64),   m.unique_opens)   AS unique_opens,
  COALESCE(r.open_rate,                     m.open_rate)      AS open_rate,
  COALESCE(CAST(r.clicks AS INT64),         m.clicks)         AS clicks,
  COALESCE(CAST(r.clicks_unique AS INT64),  m.unique_clicks)  AS unique_clicks,
  COALESCE(r.click_rate,                    m.click_rate)     AS click_rate,
  COALESCE(CAST(r.unsubscribes AS INT64),   m.unsubscribes)   AS unsubscribes,
  COALESCE(CAST(r.spam_complaints AS INT64), m.spam_complaints) AS spam_complaints,
  COALESCE(CAST(r.conversions AS INT64),    m.conversions)    AS conversions,
  COALESCE(r.conversion_value,              m.revenue)        AS revenue,
  r.conversion_rate,
  r.revenue_per_recipient,
  r.average_order_value,
  CASE WHEN m.client_id = 'dobias' THEN 'USD' ELSE m.currency END AS currency,
  m.payload_json
FROM metadata m
LEFT JOIN reports r USING(client_id, campaign_id);

-- stg_klaviyo_flows — JOINs metadata + aggregated flow performance reports.
--
-- Performance metrics come from raw_klaviyo_flow_reports (via /api/flow-values-
-- reports/ endpoint). Aggregation: take latest snapshot per (flow_id,
-- flow_message_id, period_window), then SUM across messages and across
-- non-overlapping periods to get flow-level totals.
--
-- IMPORTANT: KEEP PERIODS NON-OVERLAPPING when backfilling or running ongoing
-- sync. Otherwise SUM double-counts. Current backfill: 2024-05-23 → 2025-05-22
-- + 2025-05-23 → 2026-05-22 (two clean 12-month chunks). Future ongoing sync
-- should use explicit calendar months or similar non-overlapping windows.
-- See runbook 16.
--
-- Currency override: Dobias was tagged CAD in raw_klaviyo_flows (same n8n
-- default issue as campaigns); real conversion currency is USD.
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_klaviyo_flows` AS
WITH latest_per_period AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT *,
      ROW_NUMBER() OVER (
        PARTITION BY client_id, flow_id, flow_message_id, report_timeframe_start, report_timeframe_end
        ORDER BY ingested_at DESC
      ) AS rn
    FROM `oneeighty-warehouse.raw.raw_klaviyo_flow_reports`
    WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  ) WHERE rn = 1
),
flow_totals AS (
  SELECT
    client_id, flow_id,
    SUM(recipients)        AS recipients,
    SUM(delivered)         AS delivered,
    SUM(bounced)           AS bounces,
    SUM(opens)             AS opens,
    SUM(opens_unique)      AS unique_opens,
    SUM(clicks)            AS clicks,
    SUM(clicks_unique)     AS unique_clicks,
    SUM(unsubscribes)      AS unsubscribes,
    SUM(spam_complaints)   AS spam_complaints,
    SUM(conversions)       AS conversions,
    SUM(conversion_value)  AS revenue,
    ANY_VALUE(send_channel) AS send_channel,
    MAX(ingested_at)       AS latest_report_ingested_at
  FROM latest_per_period
  GROUP BY client_id, flow_id
),
metadata AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, flow_id, snapshot_date ORDER BY ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_klaviyo_flows`
    WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  ) WHERE rn = 1
),
metadata_latest AS (
  SELECT * EXCEPT(rn2) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, flow_id ORDER BY snapshot_date DESC) AS rn2
    FROM metadata
  ) WHERE rn2 = 1
)
SELECT
  m.client_id, m.ingested_at, m.flow_id, m.flow_name, m.status, m.snapshot_date,
  COALESCE(t.send_channel, m.trigger_type)                   AS channel,
  COALESCE(CAST(t.recipients AS INT64),    m.emails_sent)    AS emails_sent,
  COALESCE(CAST(t.delivered AS INT64),     m.delivered)      AS delivered,
  CAST(t.bounces AS INT64)                                   AS bounces,
  COALESCE(CAST(t.opens AS INT64),         m.opens)          AS opens,
  COALESCE(CAST(t.unique_opens AS INT64),  m.unique_opens)   AS unique_opens,
  m.open_rate,
  COALESCE(CAST(t.clicks AS INT64),        m.clicks)         AS clicks,
  COALESCE(CAST(t.unique_clicks AS INT64), m.unique_clicks)  AS unique_clicks,
  m.click_rate,
  CAST(t.unsubscribes AS INT64)                              AS unsubscribes,
  CAST(t.spam_complaints AS INT64)                           AS spam_complaints,
  COALESCE(CAST(t.conversions AS INT64),   m.conversions)    AS conversions,
  COALESCE(t.revenue,                       m.revenue)       AS revenue,
  CASE WHEN m.client_id = 'dobias' THEN 'USD' ELSE m.currency END AS currency,
  t.latest_report_ingested_at,
  m.payload_json
FROM metadata_latest m
LEFT JOIN flow_totals t USING(client_id, flow_id);

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_klaviyo_forms` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, form_id, snapshot_date ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_klaviyo_forms`
  WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

-- =============================================================================
-- INSTAGRAM
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_instagram_media` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, media_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_instagram_media`
  WHERE DATE(posted_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_instagram_account_insights` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, ig_business_id, metric_date, metric_name ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_instagram_account_insights`
  WHERE metric_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

-- =============================================================================
-- SHOPIFY (forward-compatible — views ready before Dobias data lands)
-- =============================================================================
-- stg_shopify_orders — deduped, USD-converted, FX-rate-aware, store_origin-tagged.
--
-- KEY CHANGES (2026-05-25):
-- 1. Matrixify filter REMOVED. Those ~48k orders are real Canadian-store
--    historical data migrated via Matrixify in March 2026 — not duplicates.
--    Earlier hypothesis was wrong (see PROJECT_LOG).
-- 2. order_date is now DATE(processed_at) — the canonical "when customer placed
--    the order" date. For migrated CA orders this preserves the original CA
--    store dates (going back to 2013). The old order_date (= created_at) is
--    preserved as `order_created_date` for audit.
-- 3. USD conversion via ref.fx_rates joined by month. Original CAD amounts
--    preserved in *_original columns. Primary columns (subtotal_price etc.)
--    now always in USD. `currency` column always returns 'USD' for Dobias.
-- 4. `store_origin` column: 'canada_migrated' for Matrixify orders, 'us_native'
--    for everything else.
-- 5. is_returning_customer rederived via processed_at order sequence by email.
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shopify_orders` AS
WITH deduped AS (
  SELECT * EXCEPT(rn, is_returning_customer, order_date)
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, order_id ORDER BY ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_shopify_orders`
    WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  ) WHERE rn = 1
),
joined AS (
  SELECT d.*,
    DATE(d.processed_at) AS order_date_raw_processed,
    fx.rate AS fx_rate_lookup
  FROM deduped d
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
    ON fx.from_currency = d.currency
   AND fx.to_currency  = 'USD'
   AND fx.month_start  = DATE_TRUNC(DATE(d.processed_at), MONTH)
)
SELECT
  client_id, ingested_at, ingest_source, order_id, order_number,
  order_date_raw_processed AS order_date,
  DATE(created_at)         AS order_created_date,
  created_at, updated_at, processed_at,
  currency AS currency_original,
  'USD'    AS currency,
  CASE WHEN currency = 'USD' THEN CAST(1.0 AS NUMERIC) ELSE fx_rate_lookup END AS fx_rate_to_usd,
  CASE WHEN source_name = 'Matrixify App' THEN 'canada_migrated' ELSE 'us_native' END AS store_origin,
  presentment_currency,
  subtotal_price  AS subtotal_price_original,
  total_shipping  AS total_shipping_original,
  total_tax       AS total_tax_original,
  total_discounts AS total_discounts_original,
  total_price     AS total_price_original,
  CASE WHEN currency = 'USD' THEN subtotal_price
       WHEN currency = 'CAD' AND fx_rate_lookup IS NOT NULL THEN subtotal_price * fx_rate_lookup END AS subtotal_price,
  CASE WHEN currency = 'USD' THEN total_shipping
       WHEN currency = 'CAD' AND fx_rate_lookup IS NOT NULL THEN total_shipping * fx_rate_lookup END AS total_shipping,
  CASE WHEN currency = 'USD' THEN total_tax
       WHEN currency = 'CAD' AND fx_rate_lookup IS NOT NULL THEN total_tax * fx_rate_lookup END AS total_tax,
  CASE WHEN currency = 'USD' THEN total_discounts
       WHEN currency = 'CAD' AND fx_rate_lookup IS NOT NULL THEN total_discounts * fx_rate_lookup END AS total_discounts,
  CASE WHEN currency = 'USD' THEN total_price
       WHEN currency = 'CAD' AND fx_rate_lookup IS NOT NULL THEN total_price * fx_rate_lookup END AS total_price,
  customer_id, customer_email, shipping_country, shipping_province,
  financial_status, fulfillment_status, cancelled_at, source_name,
  payload_json, line_items,
  CASE
    WHEN customer_email IS NULL OR TRIM(customer_email) = '' THEN CAST(NULL AS BOOL)
    ELSE ROW_NUMBER() OVER (
      PARTITION BY client_id, LOWER(TRIM(customer_email))
      ORDER BY processed_at, order_id
    ) > 1
  END AS is_returning_customer
FROM joined;

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shopify_products` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, product_id, variant_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_shopify_products`
  WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shopify_customers` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, customer_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_shopify_customers`
  WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

-- stg_shopify_order_items — one row per Shopify order line item, with cost of
-- goods joined from stg_shopify_products. The Shopify parallel to the
-- pre-existing stg_shoptet_order_items.
--   Cost match: normalized SKU (UPPER + strip the 'DD-' brand prefix), because
--   order line items carry the SKU as it was at order time and Dr. Dobias's
--   SKU formats drifted over the years (DD- prefix added; variant IDs changed
--   in Shopify's 2024 product-model migration, so they don't join).
--   unit_cost / line_cost / margin are NULL where the SKU can't be matched to
--   a costed product (bundles, discontinued items, chaotic legacy SKUs) —
--   never zero, so a partial-coverage figure is never mistaken for the truth.
-- Line items inherit fx_rate from parent order (via stg_shopify_orders).
-- Revenue is USD-converted. Cost is in shop's primary currency (USD already)
-- so no conversion. Margin = USD revenue - USD cost. Original-currency
-- amounts preserved as *_original audit columns.
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shopify_order_items` AS
WITH prod AS (
  SELECT client_id,
    TRIM(UPPER(REGEXP_REPLACE(sku, r'^DD-', ''))) AS norm_sku,
    MAX(cost)        AS cost,
    ANY_VALUE(title) AS product_title
  FROM `oneeighty-warehouse.stg.stg_shopify_products`
  WHERE sku IS NOT NULL AND sku != ''
  GROUP BY client_id, norm_sku
)
SELECT
  o.client_id, o.order_id, o.order_date,
  o.currency_original, o.currency, o.fx_rate_to_usd, o.store_origin,
  JSON_VALUE(li, '$.sku')                                            AS sku,
  COALESCE(prod.product_title, JSON_VALUE(li, '$.title'), 'Unknown')  AS item_name,
  JSON_VALUE(li, '$.title')                                          AS line_item_title,
  CASE
    WHEN o.client_id = 'dobias' AND REGEXP_CONTAINS(
      COALESCE(prod.product_title, JSON_VALUE(li, '$.title'), ''), r' H\+'
    ) THEN 'human'
    WHEN o.client_id = 'dobias' THEN 'canine'
    ELSE NULL
  END                                                                AS product_line,
  CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC)                      AS quantity,
  -- Native-currency line economics (audit)
  CAST(JSON_VALUE(li, '$.price') AS NUMERIC)                         AS unit_price_original,
  COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0)    AS line_discount_original,
  CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC) * CAST(JSON_VALUE(li, '$.price') AS NUMERIC)
    - COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0)  AS revenue_original,
  -- USD-converted (PRIMARY)
  CASE WHEN o.fx_rate_to_usd IS NULL THEN NULL
       ELSE CAST(JSON_VALUE(li, '$.price') AS NUMERIC) * o.fx_rate_to_usd END AS unit_price,
  CASE WHEN o.fx_rate_to_usd IS NULL THEN NULL
       ELSE COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0) * o.fx_rate_to_usd END AS line_discount,
  CASE WHEN o.fx_rate_to_usd IS NULL THEN NULL
       ELSE (CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC) * CAST(JSON_VALUE(li, '$.price') AS NUMERIC)
             - COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0)) * o.fx_rate_to_usd END AS revenue,
  -- Cost is already USD (stored in shop's primary currency = USD)
  prod.cost                                                          AS unit_cost,
  CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC) * prod.cost           AS line_cost,
  CASE WHEN prod.cost IS NOT NULL AND o.fx_rate_to_usd IS NOT NULL THEN
       (CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC) * CAST(JSON_VALUE(li, '$.price') AS NUMERIC)
        - COALESCE(CAST(JSON_VALUE(li, '$.total_discount') AS NUMERIC), 0)) * o.fx_rate_to_usd
       - CAST(JSON_VALUE(li, '$.quantity') AS NUMERIC) * prod.cost
  END                                                                AS margin
FROM `oneeighty-warehouse.stg.stg_shopify_orders` o,
  UNNEST(JSON_QUERY_ARRAY(o.line_items)) AS li
LEFT JOIN prod
  ON prod.client_id = o.client_id
  AND JSON_VALUE(li, '$.sku') IS NOT NULL AND JSON_VALUE(li, '$.sku') != ''
  AND prod.norm_sku = TRIM(UPPER(REGEXP_REPLACE(JSON_VALUE(li, '$.sku'), r'^DD-', '')));

-- =============================================================================
-- FACEBOOK
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_facebook_posts` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, post_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_facebook_posts`
  WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;
