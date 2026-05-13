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
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
) WHERE rn = 1;

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_meta_ad_insights` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, ad_id, date_start ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_meta_ad_insights`
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
) WHERE rn = 1;

-- =============================================================================
-- ECOMAIL — campaigns dedup by campaign_id (cumulative state),
-- automations + lists dedup by (entity, snapshot_date) preserving history
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_ecomail_campaigns` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, campaign_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_ecomail_campaigns`
  WHERE DATE(sent_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
) WHERE rn = 1;

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_ecomail_automations` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, pipeline_id, snapshot_date ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_ecomail_automations`
  WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
) WHERE rn = 1;

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_ecomail_lists` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, list_id, snapshot_date ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_ecomail_lists`
  WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
) WHERE rn = 1;

-- =============================================================================
-- KLAVIYO — campaigns by campaign_id, flows + forms by (entity, snapshot_date)
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_klaviyo_campaigns` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, campaign_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_klaviyo_campaigns`
  WHERE DATE(send_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
) WHERE rn = 1;

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_klaviyo_flows` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, flow_id, snapshot_date ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_klaviyo_flows`
  WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
) WHERE rn = 1;

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_klaviyo_forms` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, form_id, snapshot_date ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_klaviyo_forms`
  WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
) WHERE rn = 1;

-- =============================================================================
-- INSTAGRAM
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_instagram_media` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, media_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_instagram_media`
  WHERE DATE(posted_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
) WHERE rn = 1;

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_instagram_account_insights` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, ig_business_id, metric_date, metric_name ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_instagram_account_insights`
  WHERE metric_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
) WHERE rn = 1;

-- =============================================================================
-- SHOPIFY (forward-compatible — views ready before Dobias data lands)
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shopify_orders` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, order_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_shopify_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
) WHERE rn = 1;

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shopify_products` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, product_id, variant_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_shopify_products`
  WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
) WHERE rn = 1;

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shopify_customers` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, customer_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_shopify_customers`
  WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
) WHERE rn = 1;

-- =============================================================================
-- FACEBOOK
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_facebook_posts` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, post_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_facebook_posts`
  WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
) WHERE rn = 1;
