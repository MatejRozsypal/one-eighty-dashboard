-- 300_create_mart_views.sql
-- Mart layer. Pre-aggregated, cross-source, dashboard-ready views.
-- Looker Studio queries mart.* exclusively — never stg.* or raw.* directly.
-- No blending needed in Looker — every view here is a single self-contained source.
--
-- Run order: AFTER 200_create_stg_views.sql.
--
-- Re-running this file is safe — every statement is CREATE OR REPLACE.
--
-- Column name notes (lessons learned during build):
--   - The existing stg_shoptet_orders and stg_shoptet_order_items views from
--     pre-warehouse work use snake_case aliases (order_date, total_with_vat_czk)
--     while raw_shoptet_orders uses camelCase (orderDate, totalPriceWithVatCZK).
--     Mart references the snake_case stg names.
--   - raw_meta_*_insights tables don't have a `currency` column (omitted during
--     the streaming-insert schema fix). Currency is hardcoded per client_id via
--     CASE: manami → CZK, dobias → USD (Meta ad account currencies).
--   - raw_ecomail_automations doesn't have `status`. mart_email_flow_perf
--     CAST(NULL AS STRING) for Ecomail side of the UNION.
--   - Ecomail and Klaviyo use different field names for the same concepts;
--     mart_email_*_perf normalizes them into a unified shape so Looker can
--     query one view regardless of client's email platform.

-- =============================================================================
-- mart_daily_kpis
-- Profitability + Shop Performance — daily revenue + meta spend + computed KPIs.
-- One row per (client_id, date). Looker pulls scorecards + time series here.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_daily_kpis` AS
WITH shop_daily AS (
  -- Manami via Shoptet
  SELECT
    client_id,
    order_date AS date,
    SUM(total_with_vat_czk)            AS revenue,
    SUM(margin_czk)                    AS gross_profit,
    SUM(product_revenue_czk)           AS product_revenue,
    COUNT(DISTINCT order_code)         AS orders,
    COUNT(DISTINCT email)              AS unique_customers,
    COUNTIF(NOT is_returning_customer) AS new_customer_orders,
    COUNTIF(is_returning_customer)     AS returning_customer_orders,
    'CZK'                              AS shop_currency
  FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  GROUP BY client_id, order_date

  UNION ALL

  -- Dobias via Shopify (empty until token arrives)
  SELECT
    client_id,
    order_date AS date,
    SUM(total_price)                   AS revenue,
    CAST(NULL AS NUMERIC)              AS gross_profit,  -- needs product cost join, pending
    SUM(subtotal_price)                AS product_revenue,
    COUNT(DISTINCT order_id)           AS orders,
    COUNT(DISTINCT customer_email)     AS unique_customers,
    COUNTIF(NOT is_returning_customer) AS new_customer_orders,
    COUNTIF(is_returning_customer)     AS returning_customer_orders,
    ANY_VALUE(currency)                AS shop_currency
  FROM `oneeighty-warehouse.stg.stg_shopify_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  GROUP BY client_id, order_date
),
meta_daily AS (
  SELECT
    client_id,
    date_start AS date,
    SUM(spend)          AS meta_spend,
    SUM(purchase_value) AS meta_revenue,
    SUM(purchases)      AS meta_purchases,
    SUM(impressions)    AS meta_impressions,
    SUM(clicks)         AS meta_clicks,
    SUM(reach)          AS meta_reach,
    CASE WHEN client_id='manami' THEN 'CZK'
         WHEN client_id='dobias' THEN 'USD'
         ELSE 'UNKNOWN' END AS meta_currency
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights`
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  GROUP BY client_id, date_start
)
SELECT
  COALESCE(s.client_id, m.client_id) AS client_id,
  COALESCE(s.date, m.date)           AS date,

  -- Shop
  s.revenue, s.gross_profit, s.product_revenue, s.orders, s.unique_customers,
  s.new_customer_orders, s.returning_customer_orders, s.shop_currency,

  -- Meta
  m.meta_spend, m.meta_revenue, m.meta_purchases, m.meta_impressions, m.meta_clicks, m.meta_reach, m.meta_currency,

  -- Computed shop-side
  SAFE_DIVIDE(s.revenue, s.orders)                              AS aov,
  SAFE_DIVIDE(s.returning_customer_orders, s.orders)            AS return_customer_rate,

  -- Computed cross-source — MER and net_profit only meaningful when currencies match.
  -- Manami both CZK ✓ / Dobias shop CAD + meta USD ✗ → Looker should label both per page.
  SAFE_DIVIDE(s.revenue, m.meta_spend)                          AS mer,
  s.gross_profit - COALESCE(m.meta_spend, 0)                    AS net_profit_naive,

  -- Computed meta-side
  SAFE_DIVIDE(m.meta_revenue, m.meta_spend)                     AS meta_roas,
  SAFE_DIVIDE(m.meta_clicks, m.meta_impressions) * 100          AS meta_ctr_pct,
  SAFE_DIVIDE(m.meta_spend, m.meta_clicks)                      AS meta_cpc,
  SAFE_DIVIDE(m.meta_spend, m.meta_purchases)                   AS meta_cost_per_purchase

FROM shop_daily s
FULL OUTER JOIN meta_daily m
  ON s.client_id = m.client_id AND s.date = m.date;

-- =============================================================================
-- mart_sku_perf — Shop Performance — Top-SKUs bar + SKU table (Manami only;
-- Shopify line_items live in payload_json STRING and need parsing, deferred).
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_sku_perf` AS
SELECT
  client_id,
  order_date AS date,
  item_name  AS sku_name,
  variant,
  SUM(quantity)        AS units_sold,
  SUM(revenue_czk)     AS revenue,
  SUM(cost_czk)        AS cost,
  SUM(margin_czk)      AS margin,
  SAFE_DIVIDE(SUM(margin_czk), SUM(revenue_czk)) * 100 AS margin_pct,
  'CZK' AS currency
FROM `oneeighty-warehouse.stg.stg_shoptet_order_items`
WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
GROUP BY client_id, order_date, item_name, variant;

-- =============================================================================
-- mart_product_perf — Products table (one row per product per date).
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_product_perf` AS
SELECT
  client_id,
  order_date AS date,
  item_name  AS product_name,
  SUM(quantity)    AS units_sold,
  SUM(revenue_czk) AS revenue,
  SUM(margin_czk)  AS margin,
  'CZK' AS currency
FROM `oneeighty-warehouse.stg.stg_shoptet_order_items`
WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
GROUP BY client_id, order_date, item_name;

-- =============================================================================
-- mart_meta_campaign_perf — Facebook Ads campaign table.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_meta_campaign_perf` AS
SELECT
  client_id,
  date_start AS date,
  campaign_id, campaign_name, ad_account_id,
  spend, purchase_value AS revenue, purchases, impressions, clicks, reach, frequency,
  ctr, cpc, purchase_roas AS roas,
  add_to_cart, initiate_checkout, landing_page_views, link_clicks, video_views,
  SAFE_DIVIDE(spend, purchases)          AS cost_per_purchase,
  SAFE_DIVIDE(purchase_value, purchases) AS aov_meta,
  CASE WHEN client_id='manami' THEN 'CZK' WHEN client_id='dobias' THEN 'USD' ELSE 'UNKNOWN' END AS currency
FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights`
WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH);

-- =============================================================================
-- mart_meta_ad_perf — Facebook Ads ad table.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_meta_ad_perf` AS
SELECT
  client_id,
  date_start AS date,
  ad_id, ad_name, campaign_id, adset_id, ad_account_id,
  spend, purchase_value AS revenue, purchases, impressions, clicks, reach, frequency, ctr, cpc,
  add_to_cart, initiate_checkout, landing_page_views, link_clicks, video_views,
  video_play_actions, video_thruplays,
  SAFE_DIVIDE(spend, purchases)      AS cost_per_purchase,
  SAFE_DIVIDE(purchase_value, spend) AS roas,
  CASE WHEN client_id='manami' THEN 'CZK' WHEN client_id='dobias' THEN 'USD' ELSE 'UNKNOWN' END AS currency
FROM `oneeighty-warehouse.stg.stg_meta_ad_insights`
WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH);

-- =============================================================================
-- mart_email_campaign_perf — unified Ecomail + Klaviyo campaigns.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_campaign_perf` AS
SELECT
  client_id, 'ecomail' AS platform, campaign_id, title AS campaign_name,
  DATE(sent_at) AS send_date, sent_at, inject AS sent, delivery AS delivered, bounce AS bounces,
  open AS unique_opens, total_open AS total_opens, open_rate,
  click AS unique_clicks, total_click AS total_clicks, click_rate,
  unsub AS unsubscribes, spam AS spam_complaints,
  conversions, conversions_value AS revenue,
  SAFE_DIVIDE(open, delivery) * 100        AS open_rate_pct,
  SAFE_DIVIDE(click, open) * 100           AS ctr_pct,
  SAFE_DIVIDE(conversions, delivery) * 100 AS conversion_rate_pct,
  SAFE_DIVIDE(conversions_value, inject)   AS revenue_per_email,
  currency
FROM `oneeighty-warehouse.stg.stg_ecomail_campaigns`

UNION ALL

SELECT
  client_id, 'klaviyo' AS platform, campaign_id, campaign_name,
  DATE(send_time) AS send_date, send_time AS sent_at, recipients AS sent, delivered, bounces,
  unique_opens, opens AS total_opens, open_rate,
  unique_clicks, clicks AS total_clicks, click_rate,
  unsubscribes, spam_complaints,
  conversions, revenue,
  SAFE_DIVIDE(unique_opens, delivered) * 100     AS open_rate_pct,
  SAFE_DIVIDE(unique_clicks, unique_opens) * 100 AS ctr_pct,
  SAFE_DIVIDE(conversions, delivered) * 100      AS conversion_rate_pct,
  SAFE_DIVIDE(revenue, recipients)               AS revenue_per_email,
  currency
FROM `oneeighty-warehouse.stg.stg_klaviyo_campaigns`;

-- =============================================================================
-- mart_email_flow_perf — unified Ecomail pipelines + Klaviyo flows.
-- Cumulative state from latest snapshot per flow.
-- Note: Klaviyo flow stats currently NULL — /api/flows/ returns metadata only.
-- Wire /api/flow-series-reports/ to populate.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_flow_perf` AS
SELECT
  client_id, 'ecomail' AS platform, pipeline_id AS flow_id, name AS flow_name,
  CAST(NULL AS STRING) AS status,                 -- Ecomail doesn't expose flow status
  snapshot_date,
  COALESCE(send, inject) AS emails_sent,
  CAST(inject * COALESCE(delivery_rate, 1) AS INT64) AS delivered_approx,
  total_open AS opens, open AS unique_opens, open_rate,
  total_click AS clicks, click AS unique_clicks, click_rate,
  conversions, conversions_value AS revenue,
  SAFE_DIVIDE(open, COALESCE(send, inject)) * 100        AS open_rate_pct,
  SAFE_DIVIDE(click, open) * 100                         AS ctr_pct,
  SAFE_DIVIDE(conversions, COALESCE(send, inject)) * 100 AS conversion_rate_pct,
  'CZK' AS currency
FROM `oneeighty-warehouse.stg.stg_ecomail_automations`

UNION ALL

SELECT
  client_id, 'klaviyo' AS platform, flow_id, flow_name, status, snapshot_date,
  emails_sent, delivered AS delivered_approx,
  opens, unique_opens, open_rate, clicks, unique_clicks, click_rate,
  conversions, revenue,
  SAFE_DIVIDE(unique_opens, delivered) * 100     AS open_rate_pct,
  SAFE_DIVIDE(unique_clicks, unique_opens) * 100 AS ctr_pct,
  SAFE_DIVIDE(conversions, delivered) * 100      AS conversion_rate_pct,
  currency
FROM `oneeighty-warehouse.stg.stg_klaviyo_flows`;

-- =============================================================================
-- mart_email_subscribers — Subscribed-count scorecard (Ecomail only; Klaviyo
-- lists not yet ingested).
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_subscribers` AS
SELECT
  client_id, 'ecomail' AS platform, snapshot_date, list_id, list_name,
  subscribed AS total_subscribers, active_subscribers, unsubscribed,
  hard_bounced + COALESCE(soft_bounced, 0) AS bounced,
  complained AS spam_complained, unconfirmed, currency
FROM `oneeighty-warehouse.stg.stg_ecomail_lists`;
