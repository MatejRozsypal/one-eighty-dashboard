-- 100_mart_daily_kpis.sql
-- The canonical metric table that powers Looker + frontend.
-- One row per (client_id, date). Refreshed every 15 min via scheduled query.
--
-- Run order: AFTER raw tables exist and have data.

-- =============================================================================
-- Step 1: Create the mart table
-- =============================================================================
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.mart.mart_daily_kpis` (
  client_id            STRING    NOT NULL,
  date                 DATE      NOT NULL,
  currency             STRING    NOT NULL,    -- raw native — frontend converts for display

  -- Revenue
  orders               INT64,
  revenue              NUMERIC,
  net_revenue          NUMERIC,                -- revenue - discounts
  aov                  NUMERIC,                -- avg order value

  -- Customers
  new_customers        INT64,
  returning_customers  INT64,
  return_customer_rate NUMERIC,

  -- Profit (computed when cost_price available)
  cogs                 NUMERIC,
  gross_profit         NUMERIC,
  gross_margin_pct     NUMERIC,

  -- Email
  email_revenue        NUMERIC,
  email_orders         INT64,
  email_send_count     INT64,
  email_open_rate      NUMERIC,
  email_click_rate     NUMERIC,

  -- Ad spend (placeholders — populated when Meta / Google Ads workflows exist)
  meta_spend           NUMERIC,
  meta_revenue         NUMERIC,
  meta_roas            NUMERIC,
  gads_spend           NUMERIC,
  gads_revenue         NUMERIC,
  gads_roas            NUMERIC,

  -- Combined paid metrics
  total_ad_spend       NUMERIC,
  mer                  NUMERIC,                -- marketing efficiency ratio = revenue / total_ad_spend

  -- Audit
  refreshed_at         TIMESTAMP NOT NULL
)
PARTITION BY date
CLUSTER BY client_id
OPTIONS (
  description = "Canonical daily KPIs per client. Refreshed every 15 min by scheduled query. Powers Looker + frontend.",
  require_partition_filter = TRUE
);

-- =============================================================================
-- Step 2: The merge query (run as scheduled query every 15 min)
--
-- Save this as a BigQuery Scheduled Query:
--   1. BigQuery Console → Scheduled Queries → CREATE SCHEDULED QUERY
--   2. Schedule: Every 15 minutes
--   3. Destination: nothing (this is a MERGE, writes to existing table)
--   4. Region: EU
--   5. Service account: sa-n8n-writer (needs editor on mart)
--
-- Cost: scans only the latest 7 days of partitions, so it's free even at 15-min cadence.
-- =============================================================================

MERGE INTO `oneeighty-warehouse.mart.mart_daily_kpis` AS target
USING (
  WITH
    -- Latest row per Shopify order (orders are append-only with multiple rows per webhook update)
    latest_shopify AS (
      SELECT * EXCEPT(rn) FROM (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY client_id, order_id ORDER BY ingested_at DESC) rn
        FROM `oneeighty-warehouse.raw.raw_shopify_orders`
        WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
      ) WHERE rn = 1
    ),

    -- Latest row per Shoptet order
    latest_shoptet AS (
      SELECT * EXCEPT(rn) FROM (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY client_id, order_id ORDER BY ingested_at DESC) rn
        FROM `oneeighty-warehouse.raw.raw_shoptet_orders`
        WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
      ) WHERE rn = 1
    ),

    -- Unified orders (Shopify ∪ Shoptet)
    unified_orders AS (
      SELECT client_id, order_date AS date, order_id, customer_id, total_price AS total,
             total_discounts AS discount, currency, is_returning_customer
      FROM latest_shopify
      WHERE financial_status IN ('paid', 'partially_refunded')
      UNION ALL
      SELECT client_id, order_date, order_id, customer_id, total,
             discount, currency, is_returning_customer
      FROM latest_shoptet
      WHERE status NOT IN ('cancelled', 'storno')
    ),

    -- Daily order rollup
    order_kpis AS (
      SELECT
        client_id,
        date,
        ANY_VALUE(currency) AS currency,
        COUNT(DISTINCT order_id) AS orders,
        SUM(total) AS revenue,
        SUM(total - COALESCE(discount, 0)) AS net_revenue,
        SAFE_DIVIDE(SUM(total), COUNT(DISTINCT order_id)) AS aov,
        COUNT(DISTINCT IF(NOT is_returning_customer, customer_id, NULL)) AS new_customers,
        COUNT(DISTINCT IF(is_returning_customer, customer_id, NULL)) AS returning_customers,
        SAFE_DIVIDE(
          COUNT(DISTINCT IF(is_returning_customer, customer_id, NULL)),
          COUNT(DISTINCT customer_id)
        ) AS return_customer_rate
      FROM unified_orders
      GROUP BY client_id, date
    ),

    -- Email rollup (Ecomail + Klaviyo campaigns by send date)
    email_campaigns_unified AS (
      SELECT client_id, DATE(sent_at) AS date,
             revenue, conversions AS orders, recipients AS sends, open_rate, click_rate
      FROM `oneeighty-warehouse.raw.raw_ecomail_campaigns`
      WHERE sent_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
      UNION ALL
      SELECT client_id, DATE(send_time) AS date,
             revenue, conversions AS orders, recipients AS sends, open_rate, click_rate
      FROM `oneeighty-warehouse.raw.raw_klaviyo_campaigns`
      WHERE send_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
    ),

    email_kpis AS (
      SELECT
        client_id,
        date,
        SUM(revenue) AS email_revenue,
        SUM(orders) AS email_orders,
        SUM(sends) AS email_send_count,
        AVG(open_rate) AS email_open_rate,
        AVG(click_rate) AS email_click_rate
      FROM email_campaigns_unified
      GROUP BY client_id, date
    )

  SELECT
    COALESCE(o.client_id, e.client_id) AS client_id,
    COALESCE(o.date, e.date) AS date,
    COALESCE(o.currency, 'UNKNOWN') AS currency,

    o.orders, o.revenue, o.net_revenue, o.aov,
    o.new_customers, o.returning_customers, o.return_customer_rate,

    -- COGS / profit placeholders (real values come when product cost data is wired)
    CAST(NULL AS NUMERIC) AS cogs,
    CAST(NULL AS NUMERIC) AS gross_profit,
    CAST(NULL AS NUMERIC) AS gross_margin_pct,

    e.email_revenue, e.email_orders, e.email_send_count,
    e.email_open_rate, e.email_click_rate,

    -- Ad spend placeholders
    CAST(NULL AS NUMERIC) AS meta_spend,
    CAST(NULL AS NUMERIC) AS meta_revenue,
    CAST(NULL AS NUMERIC) AS meta_roas,
    CAST(NULL AS NUMERIC) AS gads_spend,
    CAST(NULL AS NUMERIC) AS gads_revenue,
    CAST(NULL AS NUMERIC) AS gads_roas,

    -- Computed combined metrics
    CAST(NULL AS NUMERIC) AS total_ad_spend,
    CAST(NULL AS NUMERIC) AS mer,

    CURRENT_TIMESTAMP() AS refreshed_at

  FROM order_kpis o
  FULL OUTER JOIN email_kpis e
    ON o.client_id = e.client_id AND o.date = e.date
) AS source
ON  target.client_id = source.client_id
AND target.date = source.date
AND target.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)

WHEN MATCHED THEN UPDATE SET
  currency             = source.currency,
  orders               = source.orders,
  revenue              = source.revenue,
  net_revenue          = source.net_revenue,
  aov                  = source.aov,
  new_customers        = source.new_customers,
  returning_customers  = source.returning_customers,
  return_customer_rate = source.return_customer_rate,
  email_revenue        = source.email_revenue,
  email_orders         = source.email_orders,
  email_send_count     = source.email_send_count,
  email_open_rate      = source.email_open_rate,
  email_click_rate     = source.email_click_rate,
  refreshed_at         = source.refreshed_at

WHEN NOT MATCHED THEN INSERT (
  client_id, date, currency,
  orders, revenue, net_revenue, aov,
  new_customers, returning_customers, return_customer_rate,
  cogs, gross_profit, gross_margin_pct,
  email_revenue, email_orders, email_send_count, email_open_rate, email_click_rate,
  meta_spend, meta_revenue, meta_roas, gads_spend, gads_revenue, gads_roas,
  total_ad_spend, mer,
  refreshed_at
) VALUES (
  source.client_id, source.date, source.currency,
  source.orders, source.revenue, source.net_revenue, source.aov,
  source.new_customers, source.returning_customers, source.return_customer_rate,
  source.cogs, source.gross_profit, source.gross_margin_pct,
  source.email_revenue, source.email_orders, source.email_send_count,
  source.email_open_rate, source.email_click_rate,
  source.meta_spend, source.meta_revenue, source.meta_roas,
  source.gads_spend, source.gads_revenue, source.gads_roas,
  source.total_ad_spend, source.mer,
  source.refreshed_at
);
