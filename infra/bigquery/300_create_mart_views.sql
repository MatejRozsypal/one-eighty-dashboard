-- 300_create_mart_views.sql
-- Mart layer. Pre-aggregated, cross-source, dashboard-ready views.
-- Looker Studio queries mart.* exclusively — never stg.* or raw.* directly.
-- No blending needed in Looker — every view here is a single self-contained source.
--
-- Run order: AFTER 200_create_stg_views.sql.
--
-- Re-running this file is safe — every statement is CREATE OR REPLACE.
--
-- =============================================================================
-- 2026-05-20 — formula audit pass (see PROJECT_LOG.md):
--   * Revenue redefined as net sales + shipping (what the customer pays us,
--     ex-tax). For Shopify: subtotal_price + total_shipping. For Shoptet:
--     total_with_vat_czk (VAT-netting deferred — Shoptet doesn't expose
--     shipping ex-VAT cleanly).
--   * gross_profit (=CM1) rewritten to use SUM(subtotal_price) − SUM(line_cost)
--     directly, avoiding the order-level discount allocation bug in the line-
--     item view (~6% gross-profit overstate previously).
--   * Contribution margin stack (D2C standard):
--       CM1 = Revenue − COGS           (product viability)
--       CM2 = CM1 − Fulfillment costs  (shipping, packaging, payment fees, returns)
--       CM3 = CM2 − Marketing spend    (Meta today; Google / affiliates later)
--     Fulfillment costs not yet wired — fulfillment_cost is a placeholder = 0,
--     so CM2 currently equals CM1. CM3 is the live "true after-marketing" margin.
--   * EBITDA NOT computed in warehouse — Looker subtracts OpEx 30% × revenue
--     as a calc field. Dropped net_profit_naive and net_profit_estimated.
--   * Email ctr_pct (was actually click-to-open rate) renamed to
--     click_rate_pct with the correct formula: unique_clicks / delivered.
--   * Meta pre-divided per-day metrics (ctr, cpc, purchase_roas) renamed
--     with _per_day suffix so chart authors know not to sum/average them
--     across rows. The component metrics (spend, clicks, impressions,
--     purchases, purchase_value) remain available for Looker re-aggregation.
--
-- Column-name carry-overs:
--   * stg_shoptet_orders uses snake_case (order_date, total_with_vat_czk),
--     while raw_shoptet_orders uses camelCase (orderDate, totalPriceWithVatCZK).
--     Mart references the snake_case stg names.
--   * raw_meta_*_insights tables don't have a `currency` column (omitted during
--     the streaming-insert schema fix). Currency is hardcoded per client_id via
--     CASE: manami → CZK, dobias → USD (Meta ad account currencies).
--   * raw_ecomail_automations doesn't have `status`. mart_email_flow_perf
--     CAST(NULL AS STRING) for Ecomail side of the UNION.
--   * Ecomail and Klaviyo use different field names for the same concepts;
--     mart_email_*_perf normalizes them so Looker queries one view regardless
--     of platform.
-- =============================================================================

-- =============================================================================
-- mart_customer_lifetime
-- One row per (client_id, customer_email, currency). Cumulative lifetime
-- revenue, margin, order count per currency.
-- Lifetime_revenue uses Shopify subtotal+shipping (net sales+shipping, ex-tax)
-- so it lines up with the new revenue definition.
-- =============================================================================
-- Includes both LIFETIME metrics (all orders in our 36-month data window)
-- and Y1 metrics (orders within 365 days of customer's first order). Y1 is
-- maturity-controlled — apples-to-apples across cohorts, eliminates the
-- "older cohorts have higher LTV simply because they've had more time" trap.
-- Use is_y1_complete = TRUE to filter to customers whose Y1 window is fully past.
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_lifetime` AS
WITH shopify_order_costs AS (
  SELECT client_id, order_id, SUM(line_cost) AS order_cogs
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  GROUP BY client_id, order_id
),
all_orders AS (
  -- Manami via Shoptet
  SELECT
    client_id,
    LOWER(email) AS customer_key,
    order_date,
    total_with_vat_czk AS order_revenue,
    margin_czk         AS order_margin,
    'CZK'              AS currency
  FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
    AND email IS NOT NULL AND email != ''
  UNION ALL
  -- Dobias via Shopify
  SELECT
    o.client_id,
    LOWER(o.customer_email) AS customer_key,
    o.order_date,
    o.subtotal_price + COALESCE(o.total_shipping, 0) AS order_revenue,
    CASE WHEN c.order_cogs IS NULL THEN NULL
         ELSE o.subtotal_price - c.order_cogs END AS order_margin,
    o.currency
  FROM `oneeighty-warehouse.stg.stg_shopify_orders` o
  LEFT JOIN shopify_order_costs c USING (client_id, order_id)
  WHERE o.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
    AND o.customer_email IS NOT NULL AND o.customer_email != ''
),
with_first_date AS (
  SELECT *,
    MIN(order_date) OVER (PARTITION BY client_id, customer_key, currency) AS customer_first_order_date
  FROM all_orders
)
SELECT
  client_id,
  customer_key AS customer_email,
  currency,
  -- Lifetime metrics (all orders in 36-month data window)
  COUNT(*)                                  AS total_orders,
  SUM(order_revenue)                        AS lifetime_revenue,
  SUM(order_margin)                         AS lifetime_gross_profit,
  -- Y1 metrics (orders within 365 days of first order — same maturity per customer)
  COUNTIF(DATE_DIFF(order_date, customer_first_order_date, DAY) <= 365)             AS y1_orders,
  SUM(CASE WHEN DATE_DIFF(order_date, customer_first_order_date, DAY) <= 365
           THEN order_revenue END)                                                  AS y1_revenue,
  SUM(CASE WHEN DATE_DIFF(order_date, customer_first_order_date, DAY) <= 365
           THEN order_margin END)                                                   AS y1_gross_profit,
  -- Maturity flag — TRUE when customer has had a full 365-day Y1 window
  DATE_DIFF(CURRENT_DATE(), MIN(order_date), DAY) >= 365                            AS is_y1_complete,
  -- Identifying / behavioral
  MIN(order_date)                           AS first_order_date,
  MAX(order_date)                           AS last_order_date,
  DATE_DIFF(MAX(order_date), MIN(order_date), DAY) AS days_active,
  COUNT(*) > 1                              AS is_returning,
  SAFE_DIVIDE(SUM(order_revenue), COUNT(*)) AS aov,
  SAFE_DIVIDE(SUM(order_margin),  COUNT(*)) AS avg_margin_per_order
FROM with_first_date
GROUP BY client_id, customer_key, currency;

-- =============================================================================
-- mart_customer_cohorts
-- Cohort-by-first-order-month aggregation, per currency.
--
-- cohort_repeat_rate_pct is the TRUE Returning Customer Rate:
--   unique customers in this cohort with ≥2 lifetime orders / cohort size.
-- This is age- and growth-independent, unlike the period-based RCR in
-- mart_daily_kpis.return_customer_rate_period (which inflates with business
-- tenure and deflates during growth). Use this for cohort comparisons.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_customer_cohorts` AS
SELECT
  client_id,
  DATE_TRUNC(first_order_date, MONTH) AS cohort_month,
  currency,
  COUNT(*)                            AS customer_count,
  COUNTIF(is_y1_complete)             AS y1_complete_customers,
  -- Lifetime aggregates (grows with cohort age — NOT comparable across cohorts)
  SUM(lifetime_revenue)               AS cohort_total_revenue,
  SUM(lifetime_gross_profit)          AS cohort_total_gross_profit,
  SUM(total_orders)                   AS cohort_total_orders,
  ROUND(AVG(lifetime_revenue), 2)     AS ltv,
  ROUND(AVG(lifetime_gross_profit), 2) AS ltgp,
  ROUND(AVG(total_orders), 2)         AS avg_orders_per_customer,
  -- Y1 aggregates (maturity-corrected — comparable across cohorts).
  -- Only counts customers whose Y1 window is fully past (is_y1_complete=TRUE).
  -- AVG_IF(...,is_y1_complete) excludes immature customers automatically.
  ROUND(AVG(IF(is_y1_complete, y1_revenue, NULL)), 2)        AS y1_ltv,
  ROUND(AVG(IF(is_y1_complete, y1_gross_profit, NULL)), 2)   AS y1_ltgp,
  ROUND(AVG(IF(is_y1_complete, y1_orders, NULL)), 2)         AS y1_orders_per_customer,
  -- Returning behavior
  COUNTIF(is_returning)                                      AS returning_customers,
  SAFE_DIVIDE(COUNTIF(is_returning), COUNT(*)) * 100         AS cohort_repeat_rate_pct
FROM `oneeighty-warehouse.mart.mart_customer_lifetime`
GROUP BY client_id, cohort_month, currency;

-- =============================================================================
-- mart_daily_kpis
-- Profitability + Shop Performance — daily P&L per (client_id, date, currency).
-- Looker reads this directly.
--
-- Revenue definition (NEW):
--   revenue = net_sales + shipping_revenue  (what the customer pays ex-tax)
--   Shopify: subtotal_price + total_shipping
--   Shoptet: total_with_vat_czk (VAT-netting deferred — see header)
--
-- Margin stack — monotonically non-increasing: revenue ≥ CM1 ≥ CM2 ≥ CM3
--
--   Revenue          = net sales + shipping income (what customer pays ex-tax)
--   cogs             = SUM(line_cost) from stg_shopify_order_items (Shopify)
--                    = product_revenue_czk − margin_czk (Shoptet, implicit)
--   cm1_other_costs  = PLACEHOLDER 0 until wired. Covers:
--                        inbound freight + duties + product packaging
--                        + payment processing fees
--   fulfillment_cost = PLACEHOLDER 0 until wired. Covers:
--                        outbound fulfillment (shipping cost, handling)
--                        + returns processing
--
--   CM1 = Revenue − COGS − cm1_other_costs              (Gross contribution margin)
--   CM2 = CM1 − fulfillment_cost                        (After-fulfillment margin)
--   CM3 = CM2 − meta_spend                              (After-marketing margin —
--                                                        live ROI of paid acquisition)
--   EBITDA = CM3 − (revenue × opex_pct).
--            NOT computed here. Looker calc field: cm3 − revenue*0.30
--            (or join ref.clients.opex_pct when per-client tuning lands).
--
--   With both placeholders = 0 today: CM1 = CM2 (will diverge when costs wired).
--   CM3 is the live after-marketing figure. When placeholder columns are
--   populated with real cost data, CM1/CM2/CM3 update automatically — no
--   formula changes needed.
--
--   ONLY cm1, cm2, cm3 are exposed as columns (dollar values). Percentages
--   intentionally NOT pre-computed — derive in Looker as `cm1 / revenue * 100`
--   etc. This keeps one canonical CM figure per level.
--
-- Currency policy: native, no FX. Manami=CZK throughout. Dobias=USD throughout.
-- Meta attaches only to the matching-currency shop row (FULL OUTER JOIN).
--
-- Shopify cost coverage at handoff: ~99.85% of revenue is costed. Gross_profit
-- partial only for the long tail of unmatched bundles / legacy SKUs.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_daily_kpis` AS
WITH shopify_orders_daily AS (
  -- Aggregate revenue + order metrics directly from order header (avoids the
  -- line-item discount-allocation issue).
  SELECT
    client_id,
    order_date                       AS date,
    currency,
    SUM(subtotal_price + COALESCE(total_shipping, 0)) AS revenue,
    SUM(IF(is_returning_customer IS FALSE, subtotal_price + COALESCE(total_shipping, 0), 0)) AS new_customer_revenue,
    SUM(IF(is_returning_customer IS TRUE,  subtotal_price + COALESCE(total_shipping, 0), 0)) AS returning_customer_revenue,
    SUM(subtotal_price)              AS net_sales,
    SUM(IF(is_returning_customer IS FALSE, subtotal_price, 0)) AS new_customer_net_sales,
    SUM(IF(is_returning_customer IS TRUE,  subtotal_price, 0)) AS returning_customer_net_sales,
    SUM(COALESCE(total_shipping, 0)) AS shipping_revenue,
    SUM(COALESCE(total_tax, 0))      AS tax_collected,
    SUM(total_price)                 AS gross_revenue_incl_tax,
    COUNT(DISTINCT order_id)         AS orders,
    COUNT(DISTINCT customer_email)   AS unique_customers,
    COUNTIF(is_returning_customer IS FALSE) AS new_customer_orders,
    COUNTIF(is_returning_customer IS TRUE)  AS returning_customer_orders
  FROM `oneeighty-warehouse.stg.stg_shopify_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  GROUP BY client_id, order_date, currency
),
shopify_cogs_daily AS (
  -- COGS = SUM(line_cost). Pulled separately to keep the discount-allocation
  -- bug in stg_shopify_order_items revenue field from contaminating gross_profit.
  SELECT client_id, order_date AS date, currency, SUM(line_cost) AS cogs
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  GROUP BY client_id, order_date, currency
),
shop_daily AS (
  -- Shopify branch
  SELECT
    o.client_id, o.date, o.currency,
    o.revenue, o.new_customer_revenue, o.returning_customer_revenue,
    o.net_sales, o.new_customer_net_sales, o.returning_customer_net_sales,
    o.shipping_revenue, o.tax_collected, o.gross_revenue_incl_tax,
    COALESCE(c.cogs, 0) AS cogs,
    o.orders, o.unique_customers, o.new_customer_orders, o.returning_customer_orders
  FROM shopify_orders_daily o
  LEFT JOIN shopify_cogs_daily c USING (client_id, date, currency)

  UNION ALL

  -- Shoptet branch (Manami). Shoptet exposes margin_czk directly; revenue
  -- includes VAT until we add VAT-netting. shipping_revenue unknown.
  SELECT
    client_id,
    order_date AS date,
    'CZK'      AS currency,
    SUM(total_with_vat_czk)            AS revenue,
    SUM(IF(is_returning_customer IS FALSE, total_with_vat_czk, 0)) AS new_customer_revenue,
    SUM(IF(is_returning_customer IS TRUE,  total_with_vat_czk, 0)) AS returning_customer_revenue,
    SUM(product_revenue_czk)           AS net_sales,
    SUM(IF(is_returning_customer IS FALSE, product_revenue_czk, 0)) AS new_customer_net_sales,
    SUM(IF(is_returning_customer IS TRUE,  product_revenue_czk, 0)) AS returning_customer_net_sales,
    CAST(NULL AS NUMERIC)              AS shipping_revenue,
    CAST(NULL AS NUMERIC)              AS tax_collected,
    SUM(total_with_vat_czk)            AS gross_revenue_incl_tax,
    SUM(product_revenue_czk) - SUM(margin_czk) AS cogs,  -- implicit COGS = net_sales − Shoptet margin
    COUNT(DISTINCT order_code)         AS orders,
    COUNT(DISTINCT email)              AS unique_customers,
    COUNTIF(is_returning_customer IS FALSE) AS new_customer_orders,
    COUNTIF(is_returning_customer IS TRUE)  AS returning_customer_orders
  FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  GROUP BY client_id, order_date
),
meta_daily AS (
  SELECT
    client_id,
    date_start AS date,
    CASE WHEN client_id='manami' THEN 'CZK'
         WHEN client_id='dobias' THEN 'USD'
         ELSE 'UNKNOWN' END                AS currency,
    SUM(spend)          AS meta_spend,
    SUM(purchase_value) AS meta_revenue,
    SUM(purchases)      AS meta_purchases,
    SUM(impressions)    AS meta_impressions,
    SUM(clicks)         AS meta_clicks,
    SUM(reach)          AS meta_reach
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights`
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  GROUP BY client_id, date_start
)
SELECT
  COALESCE(s.client_id, m.client_id) AS client_id,
  COALESCE(s.date,      m.date)      AS date,
  COALESCE(s.currency,  m.currency)  AS currency,

  -- Revenue components
  s.revenue,                          -- net sales + shipping (ex-tax)
  s.new_customer_revenue,             -- revenue from first-time customer orders
  s.returning_customer_revenue,       -- revenue from repeat-customer orders
  s.net_sales,                        -- products only, ex-tax, ex-shipping. AOV denominator.
  s.new_customer_net_sales,           -- first-time-customer merch sales, ex-shipping. AOV-new num.
  s.returning_customer_net_sales,     -- repeat-customer merch sales, ex-shipping. AOV-returning num.
  s.shipping_revenue,
  s.tax_collected,
  s.gross_revenue_incl_tax,           -- old definition kept for transparency / refund reconciliation

  -- Cost
  s.cogs,

  -- Orders
  s.orders, s.unique_customers, s.new_customer_orders, s.returning_customer_orders,

  -- Meta
  m.meta_spend, m.meta_revenue, m.meta_purchases, m.meta_impressions, m.meta_clicks, m.meta_reach,

  -- Variable cost placeholders — populate when data lands; CM formulas unchanged
  CAST(0 AS NUMERIC)                                                                                AS cm1_other_costs,    -- inbound freight + duties + packaging + payment processing fees
  CAST(0 AS NUMERIC)                                                                                AS fulfillment_cost,   -- outbound fulfillment + returns processing
  -- CM stack — monotonically non-increasing: revenue ≥ CM1 ≥ CM2 ≥ CM3
  s.revenue - s.cogs - 0                                                                            AS cm1,                -- Revenue − COGS − cm1_other_costs
  s.revenue - s.cogs - 0 - 0                                                                        AS cm2,                -- CM1 − fulfillment_cost
  s.revenue - s.cogs - 0 - 0 - COALESCE(m.meta_spend, 0)                                            AS cm3,                -- CM2 − marketing

  -- All ratio metrics intentionally omitted (AOV, CPA, ROAS, MER, aMER, CAC,
  -- CTR, CPC, RCR, CM%-of-revenue). Per-day pre-divided ratios aggregate
  -- incorrectly across multi-day ranges. Define them as Looker calc fields
  -- using SUM(numerator) / SUM(denominator). See METRICS.md for exact formulas.

FROM shop_daily s
FULL OUTER JOIN meta_daily m
  ON s.client_id = m.client_id
 AND s.date      = m.date
 AND s.currency  = m.currency;

-- =============================================================================
-- mart_sku_perf — Shop Performance — Top-SKUs bar + SKU table.
-- product_line classifies Dobias products: 'human' = H+ supplements, 'canine'
-- = everything else (default for Dobias). NULL for Manami/Shoptet (no line concept).
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_sku_perf` AS
SELECT
  client_id,
  order_date AS date,
  item_name  AS sku_name,
  variant,
  CAST(NULL AS STRING) AS product_line,
  SUM(quantity)        AS units_sold,
  SUM(revenue_czk)     AS revenue,
  SUM(cost_czk)        AS cost,
  SUM(margin_czk)      AS margin,
  SAFE_DIVIDE(SUM(margin_czk), SUM(revenue_czk)) * 100 AS margin_pct,
  'CZK' AS currency
FROM `oneeighty-warehouse.stg.stg_shoptet_order_items`
WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
GROUP BY client_id, order_date, item_name, variant

UNION ALL

SELECT
  client_id,
  order_date AS date,
  item_name  AS sku_name,
  sku        AS variant,
  product_line,
  SUM(quantity)  AS units_sold,
  SUM(revenue)   AS revenue,
  SUM(line_cost) AS cost,
  SUM(margin)    AS margin,
  SAFE_DIVIDE(SUM(margin), SUM(revenue)) * 100 AS margin_pct,
  currency
FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
GROUP BY client_id, order_date, item_name, sku, product_line, currency;

-- =============================================================================
-- mart_product_perf — Products table (one row per product per date).
-- product_line column same convention as mart_sku_perf.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_product_perf` AS
SELECT
  client_id,
  order_date AS date,
  item_name  AS product_name,
  CAST(NULL AS STRING) AS product_line,
  SUM(quantity)    AS units_sold,
  SUM(revenue_czk) AS revenue,
  SUM(margin_czk)  AS margin,
  'CZK' AS currency
FROM `oneeighty-warehouse.stg.stg_shoptet_order_items`
WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
GROUP BY client_id, order_date, item_name

UNION ALL

SELECT
  client_id,
  order_date AS date,
  item_name  AS product_name,
  product_line,
  SUM(quantity) AS units_sold,
  SUM(revenue)  AS revenue,
  SUM(margin)   AS margin,
  currency
FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
GROUP BY client_id, order_date, item_name, product_line, currency;

-- =============================================================================
-- mart_orders — one row per Shopify order. Order-level grain for Looker
-- filtering by shipping_country, customer, financial_status, source_name.
--
-- revenue here uses the new definition: subtotal_price + total_shipping
-- (net sales + shipping, ex-tax). gross_revenue_incl_tax kept for transparency.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_orders` AS
SELECT
  client_id,
  order_date AS date,
  order_id,
  order_number,
  currency,
  customer_email,
  shipping_country,
  shipping_province,
  subtotal_price + COALESCE(total_shipping, 0) AS revenue,        -- net sales + shipping
  subtotal_price                               AS net_sales,
  COALESCE(total_shipping, 0)                  AS shipping_revenue,
  COALESCE(total_tax, 0)                       AS tax_collected,
  total_price                                  AS gross_revenue_incl_tax,
  total_discounts,
  financial_status,
  fulfillment_status,
  source_name,
  is_returning_customer,
  cancelled_at,
  processed_at
FROM `oneeighty-warehouse.stg.stg_shopify_orders`
WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH);

-- =============================================================================
-- mart_meta_campaign_perf — Facebook Ads campaign table.
-- Pre-divided per-day metrics renamed with _per_day suffix to flag them as
-- non-aggregatable across rows. Looker should recompute from the underlying
-- sums (spend, clicks, impressions, purchases, purchase_value).
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_meta_campaign_perf` AS
SELECT
  client_id,
  date_start AS date,
  campaign_id, campaign_name, ad_account_id,
  -- Aggregatable components
  spend, purchase_value AS revenue, purchases, impressions, clicks, reach,
  add_to_cart, initiate_checkout, landing_page_views, link_clicks, video_views,
  -- Pre-divided per-day fields — DO NOT SUM/AVG across rows in Looker;
  -- recompute from the sums above instead. Frequency is non-reaggregatable
  -- across days even by SUM(impressions)/SUM(reach) because reach is non-additive.
  frequency     AS frequency_per_day,
  ctr           AS ctr_per_day,
  cpc           AS cpc_per_day,
  purchase_roas AS roas_per_day,
  SAFE_DIVIDE(spend, purchases)          AS cost_per_purchase_per_day,
  SAFE_DIVIDE(purchase_value, purchases) AS aov_meta_per_day,
  CASE WHEN client_id='manami' THEN 'CZK' WHEN client_id='dobias' THEN 'USD' ELSE 'UNKNOWN' END AS currency
FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights`
WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH);

-- =============================================================================
-- mart_meta_ad_perf — Facebook Ads ad table. Same _per_day convention.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_meta_ad_perf` AS
SELECT
  client_id,
  date_start AS date,
  ad_id, ad_name, campaign_id, adset_id, ad_account_id,
  spend, purchase_value AS revenue, purchases, impressions, clicks, reach,
  add_to_cart, initiate_checkout, landing_page_views, link_clicks, video_views,
  video_play_actions, video_thruplays,
  frequency                          AS frequency_per_day,
  ctr                                AS ctr_per_day,
  cpc                                AS cpc_per_day,
  SAFE_DIVIDE(spend, purchases)      AS cost_per_purchase_per_day,
  SAFE_DIVIDE(purchase_value, spend) AS roas_per_day,
  CASE WHEN client_id='manami' THEN 'CZK' WHEN client_id='dobias' THEN 'USD' ELSE 'UNKNOWN' END AS currency
FROM `oneeighty-warehouse.stg.stg_meta_ad_insights`
WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH);

-- =============================================================================
-- mart_email_campaign_perf — unified Ecomail + Klaviyo campaigns.
--
-- NOTE: click_rate_pct = unique_clicks / delivered (true click rate, not CTOR).
-- The previous ctr_pct field was a misnamed click-to-open rate; removed in this
-- pass to avoid double-counting / confusion.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_campaign_perf` AS
SELECT
  client_id, 'ecomail' AS platform, campaign_id, title AS campaign_name,
  DATE(sent_at) AS send_date, sent_at,
  inject AS sent, delivery AS delivered, bounce AS bounces,
  open AS unique_opens, total_open AS total_opens, open_rate,
  click AS unique_clicks, total_click AS total_clicks, click_rate,
  unsub AS unsubscribes, spam AS spam_complaints,
  conversions, conversions_value AS revenue,
  SAFE_DIVIDE(open, delivery)  * 100         AS open_rate_pct,
  SAFE_DIVIDE(click, delivery) * 100         AS click_rate_pct,
  SAFE_DIVIDE(conversions, delivery) * 100   AS conversion_rate_pct,
  SAFE_DIVIDE(conversions_value, inject)     AS revenue_per_email,
  currency
FROM `oneeighty-warehouse.stg.stg_ecomail_campaigns`

UNION ALL

SELECT
  client_id, 'klaviyo' AS platform, campaign_id, campaign_name,
  DATE(send_time) AS send_date, send_time AS sent_at,
  recipients AS sent, delivered, bounces,
  unique_opens, opens AS total_opens, open_rate,
  unique_clicks, clicks AS total_clicks, click_rate,
  unsubscribes, spam_complaints,
  conversions, revenue,
  SAFE_DIVIDE(unique_opens,  delivered) * 100  AS open_rate_pct,
  SAFE_DIVIDE(unique_clicks, delivered) * 100  AS click_rate_pct,
  SAFE_DIVIDE(conversions,   delivered) * 100  AS conversion_rate_pct,
  SAFE_DIVIDE(revenue, recipients)             AS revenue_per_email,
  currency
FROM `oneeighty-warehouse.stg.stg_klaviyo_campaigns`
WHERE channel = 'email';  -- exclude SMS / push; create separate marts when needed

-- =============================================================================
-- mart_email_flow_perf — unified Ecomail pipelines + Klaviyo flows.
--
-- IMPORTANT: takes ONLY the latest snapshot per flow. Both platforms' flows
-- APIs return CUMULATIVE counters (emails_sent / opens / conversions / revenue
-- are totals since the flow started, not deltas per snapshot). Snapshot-by-day
-- persists history in raw + stg, but summing here would multiply each event by
-- the number of snapshots that captured it. The "latest snapshot only" rule
-- gives the correct "cumulative-as-of-now" totals that aggregate cleanly in
-- Looker.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_flow_perf` AS
WITH latest_ecomail AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, pipeline_id ORDER BY snapshot_date DESC) AS rn
    FROM `oneeighty-warehouse.stg.stg_ecomail_automations`
  ) WHERE rn = 1
),
latest_klaviyo AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, flow_id ORDER BY snapshot_date DESC) AS rn
    FROM `oneeighty-warehouse.stg.stg_klaviyo_flows`
  ) WHERE rn = 1
)
SELECT
  client_id, 'ecomail' AS platform, pipeline_id AS flow_id, name AS flow_name,
  CAST(NULL AS STRING) AS status,
  snapshot_date AS latest_snapshot_date,
  COALESCE(send, inject) AS emails_sent,
  CAST(inject * COALESCE(delivery_rate, 1) AS INT64) AS delivered_approx,
  total_open AS opens, open AS unique_opens, open_rate,
  total_click AS clicks, click AS unique_clicks, click_rate,
  conversions, conversions_value AS revenue,
  SAFE_DIVIDE(open,        CAST(inject * COALESCE(delivery_rate, 1) AS INT64)) * 100 AS open_rate_pct,
  SAFE_DIVIDE(click,       CAST(inject * COALESCE(delivery_rate, 1) AS INT64)) * 100 AS click_rate_pct,
  SAFE_DIVIDE(conversions, CAST(inject * COALESCE(delivery_rate, 1) AS INT64)) * 100 AS conversion_rate_pct,
  'CZK' AS currency
FROM latest_ecomail

UNION ALL

SELECT
  client_id, 'klaviyo' AS platform, flow_id, flow_name, status, snapshot_date AS latest_snapshot_date,
  emails_sent, delivered AS delivered_approx,
  opens, unique_opens, open_rate, clicks, unique_clicks, click_rate,
  conversions, revenue,
  SAFE_DIVIDE(unique_opens,  delivered) * 100  AS open_rate_pct,
  SAFE_DIVIDE(unique_clicks, delivered) * 100  AS click_rate_pct,
  SAFE_DIVIDE(conversions,   delivered) * 100  AS conversion_rate_pct,
  currency
FROM latest_klaviyo;

-- =============================================================================
-- mart_email_subscribers — Subscribed-count scorecard (Ecomail only).
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_subscribers` AS
SELECT
  client_id, 'ecomail' AS platform, snapshot_date, list_id, list_name,
  subscribed AS total_subscribers, active_subscribers, unsubscribed,
  hard_bounced + COALESCE(soft_bounced, 0) AS bounced,
  complained AS spam_complained, unconfirmed, currency
FROM `oneeighty-warehouse.stg.stg_ecomail_lists`;

-- =============================================================================
-- mart_monthly_kpis
-- Monthly rollup of mart_daily_kpis with growth metrics (MoM on new customer
-- orders). One row per (client_id, month_start, currency).
--
-- mom_new_customer_orders_pct uses LAG over consecutive months — gap months
-- (no data at all for a client+currency) will be silently skipped. For healthy
-- businesses this is fine.
--
-- Average monthly growth (CAGR) over an arbitrary range is NOT pre-computed —
-- it depends on the user's selected window. Compute in Looker:
--    POWER(SUM_AT_LAST(new_customer_orders) / SUM_AT_FIRST(new_customer_orders),
--          1.0/COUNT(month_start)) - 1
-- or in SQL on top of this view:
--    POWER(MAX_BY(new_customer_orders, month_start) /
--          MIN_BY(new_customer_orders, month_start),
--          1.0/(DATE_DIFF(MAX(month_start), MIN(month_start), MONTH))) - 1
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_monthly_kpis` AS
WITH monthly AS (
  SELECT
    client_id,
    DATE_TRUNC(date, MONTH) AS month_start,
    currency,
    SUM(revenue)                     AS revenue,
    SUM(new_customer_revenue)        AS new_customer_revenue,
    SUM(returning_customer_revenue)  AS returning_customer_revenue,
    SUM(net_sales)                       AS net_sales,
    SUM(new_customer_net_sales)          AS new_customer_net_sales,
    SUM(returning_customer_net_sales)    AS returning_customer_net_sales,
    SUM(shipping_revenue)            AS shipping_revenue,
    SUM(tax_collected)               AS tax_collected,
    SUM(gross_revenue_incl_tax)      AS gross_revenue_incl_tax,
    SUM(cogs)                        AS cogs,
    SUM(orders)                      AS orders,
    SUM(new_customer_orders)         AS new_customer_orders,
    SUM(returning_customer_orders)   AS returning_customer_orders,
    SUM(unique_customers)            AS unique_customers_sum_of_daily,  -- NOTE: NOT a true monthly unique
    SUM(meta_spend)                  AS meta_spend,
    SUM(meta_revenue)                AS meta_revenue,
    SUM(meta_purchases)              AS meta_purchases,
    SUM(meta_impressions)            AS meta_impressions,
    SUM(meta_clicks)                 AS meta_clicks,
    SUM(meta_reach)                  AS meta_reach,
    SUM(cm1_other_costs)             AS cm1_other_costs,
    SUM(fulfillment_cost)            AS fulfillment_cost,
    SUM(cm1)                         AS cm1,
    SUM(cm2)                         AS cm2,
    SUM(cm3)                         AS cm3
  FROM `oneeighty-warehouse.mart.mart_daily_kpis`
  GROUP BY client_id, month_start, currency
)
SELECT
  m.*,
  -- Growth metrics — per-row by design, safe at monthly grain.
  -- If a Looker chart spans multiple months on these, treat as point-in-time
  -- per-month figures. AOV/CPA/ROAS/MER/aMER/CAC/CTR/CPC are intentionally
  -- omitted; define them as Looker calc fields. See METRICS.md.
  LAG(m.new_customer_orders)  OVER w                                          AS prev_month_new_customer_orders,
  LAG(m.new_customer_revenue) OVER w                                          AS prev_month_new_customer_revenue,
  LAG(m.revenue)              OVER w                                          AS prev_month_revenue,
  SAFE_DIVIDE(m.new_customer_orders,  LAG(m.new_customer_orders)  OVER w) - 1 AS mom_new_customer_orders_pct,
  SAFE_DIVIDE(m.new_customer_revenue, LAG(m.new_customer_revenue) OVER w) - 1 AS mom_new_customer_revenue_pct,
  SAFE_DIVIDE(m.revenue,              LAG(m.revenue)              OVER w) - 1 AS mom_revenue_pct
FROM monthly m
WINDOW w AS (PARTITION BY client_id, currency ORDER BY month_start);
