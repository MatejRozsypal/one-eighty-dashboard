-- 213_client_ad_currency.sql
-- =============================================================================
-- Ends the hardcoded per-client ad-currency CASE, and normalises ad spend into
-- the client's own currency before it reaches the P&L.
--
-- WHY THIS EXISTS
--
-- An ad account bills in whatever currency it was created with, which has
-- nothing to do with what the shop sells in. For the first two clients the two
-- happened to agree (Manami CZK/CZK, Dobias USD/USD), so three views could get
-- away with:
--
--     CASE WHEN client_id='manami' THEN 'CZK'
--          WHEN client_id='dobias' THEN 'USD' ELSE 'UNKNOWN' END
--
-- Venev sells in EUR and its Meta account bills in CZK. That breaks the CASE
-- twice over: it has no branch for venev (-> 'UNKNOWN'), and even with one
-- added, `mart_daily_kpis` FULL OUTER JOINs shop revenue to ad spend ON
-- currency. A EUR revenue row and a CZK spend row never meet, so every day
-- splits into two half-rows and `cm3` -- revenue minus COGS minus paid spend --
-- comes out equal to `cm1`, with the marketing spend simply absent. Nothing
-- errors. The dashboard shows a P&L that has quietly stopped subtracting ads.
--
-- WHAT THIS DOES
--
--   1. `ref.clients` gains `meta_currency` and `gads_currency` -- the currency
--      each ad account bills in, which the registry never recorded.
--   2. `mart_daily_kpis` converts spend and ad-reported revenue from the ad
--      currency into the client's currency at that month's rate, so the row
--      carries exactly one currency again and CM2/CM3/MER/aMER/CAC are
--      single-currency arithmetic.
--   3. `mart_meta_campaign_perf` / `mart_meta_ad_perf` read the currency from
--      the registry instead of the CASE. These stay in the AD account's native
--      currency on purpose: they are ad-performance tables that reconcile
--      against Ads Manager, and the dashboard's display-time fx converts them
--      per row.
--
-- Raw stays untouched in the billed currency. Conversion at ingest would
-- destroy the ability to reconcile against Ads Manager, which is the same
-- reason `dashboard/lib/currency.ts` treats display conversion as a display
-- concern.
--
-- A MISSING RATE YIELDS NULL, NOT AN UNCONVERTED NUMBER. The fx join is a LEFT
-- JOIN and the factor is NULL when the month has no rate, so spend propagates
-- to NULL and the metric visibly disappears. Passing the unconverted figure
-- through would put CZK into a EUR column and look entirely plausible.
-- `ref.fx_rates` expires monthly -- runbooks/23_fx_rates_refresh.md.
--
-- Supersedes the mart_daily_kpis statement in 203_add_google_spend_to_mart.sql
-- and the two meta views in 300_create_mart_views.sql.
-- =============================================================================

ALTER TABLE `oneeighty-warehouse.ref.clients`
  ADD COLUMN IF NOT EXISTS meta_currency STRING
    OPTIONS (description = "ISO-4217 the Meta ad account bills in. Set when the ad account is created and cannot be changed retroactively; it is unrelated to the shop's currency. NULL = no Meta account."),
  ADD COLUMN IF NOT EXISTS gads_currency STRING
    OPTIONS (description = "ISO-4217 the Google Ads account bills in (customer_currency_code in the DTS ads_Customer_* table). NULL = no Google Ads account.");

-- Values verified against the sources, not assumed:
--   manami meta  CZK  -- previous CASE
--   manami gads  CZK  -- raw_google_ads.ads_Customer_5865960448.customer_currency_code
--   dobias meta  USD  -- Graph API act_38180535, confirmed 2026-05-12 (runbook 08)
--   venev  meta  CZK  -- Graph API, confirmed 2026-08-03
UPDATE `oneeighty-warehouse.ref.clients`
SET meta_currency = CASE client_id
                      WHEN 'manami' THEN 'CZK'
                      WHEN 'dobias' THEN 'USD'
                      WHEN 'venev'  THEN 'CZK'
                    END,
    gads_currency = CASE client_id
                      WHEN 'manami' THEN 'CZK'
                    END,
    updated_at    = CURRENT_TIMESTAMP()
WHERE client_id IN ('manami', 'dobias', 'venev');

-- =============================================================================
-- mart_daily_kpis
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_daily_kpis` AS
WITH client_ccy AS (
  SELECT client_id, currency AS client_currency, meta_currency, gads_currency
  FROM `oneeighty-warehouse.ref.clients`
),
shopify_orders_daily AS (
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

  -- Shoptet branch (Manami)
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
    SUM(product_revenue_czk) - SUM(margin_czk) AS cogs,
    COUNT(DISTINCT order_code)         AS orders,
    COUNT(DISTINCT email)              AS unique_customers,
    COUNTIF(is_returning_customer IS FALSE) AS new_customer_orders,
    COUNTIF(is_returning_customer IS TRUE)  AS returning_customer_orders
  FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  GROUP BY client_id, order_date
),

-- Ad spend, one row per insight row, carrying the factor that takes it from the
-- ad account's currency into the client's. The factor is applied BEFORE the
-- SUM so a range spanning several months converts each month at its own rate --
-- the same rule dashboard/lib/currency.ts follows, and the reason fx_rates is
-- keyed by month rather than holding a single current rate.
meta_rows AS (
  SELECT
    m.client_id,
    m.date_start           AS date,
    c.client_currency      AS currency,
    IF(c.meta_currency = c.client_currency, NUMERIC '1', r.rate) AS fx,
    m.spend, m.purchase_value, m.purchases, m.impressions, m.clicks, m.reach
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` m
  JOIN client_ccy c ON c.client_id = m.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` r
    ON  r.month_start   = DATE_TRUNC(m.date_start, MONTH)
    AND r.from_currency = c.meta_currency
    AND r.to_currency   = c.client_currency
  WHERE m.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
),
meta_daily AS (
  SELECT
    client_id, date, currency,
    SUM(spend          * fx) AS meta_spend,
    SUM(purchase_value * fx) AS meta_revenue,
    SUM(purchases)           AS meta_purchases,
    SUM(impressions)         AS meta_impressions,
    SUM(clicks)              AS meta_clicks,
    SUM(reach)               AS meta_reach
  FROM meta_rows
  GROUP BY client_id, date, currency
),
google_rows AS (
  SELECT
    g.client_id,
    g.date_start      AS date,
    c.client_currency AS currency,
    -- spend/purchase_value are FLOAT64 on the Google side, so the NUMERIC rate
    -- is cast rather than left to implicit coercion.
    CAST(IF(c.gads_currency = c.client_currency, NUMERIC '1', r.rate) AS FLOAT64) AS fx,
    g.spend, g.purchase_value, g.purchases, g.impressions, g.clicks
  FROM `oneeighty-warehouse.stg.stg_google_ads_campaign_insights` g
  JOIN client_ccy c ON c.client_id = g.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` r
    ON  r.month_start   = DATE_TRUNC(g.date_start, MONTH)
    AND r.from_currency = c.gads_currency
    AND r.to_currency   = c.client_currency
  WHERE g.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
),
google_daily AS (
  SELECT
    client_id, date, currency,
    SUM(spend          * fx) AS google_spend,
    SUM(purchase_value * fx) AS google_revenue,
    SUM(purchases)           AS google_purchases,
    SUM(impressions)         AS google_impressions,
    SUM(clicks)              AS google_clicks
  FROM google_rows
  GROUP BY client_id, date, currency
),
paid_daily AS (
  -- Both sides are now in the client's currency, so this join can no longer
  -- fail to match on currency the way it would have for a EUR/CZK client.
  SELECT
    COALESCE(m.client_id, g.client_id) AS client_id,
    COALESCE(m.date,      g.date)      AS date,
    COALESCE(m.currency,  g.currency)  AS currency,
    m.meta_spend, m.meta_revenue, m.meta_purchases, m.meta_impressions, m.meta_clicks, m.meta_reach,
    g.google_spend, g.google_revenue, g.google_purchases, g.google_impressions, g.google_clicks,
    COALESCE(m.meta_spend, 0) + CAST(COALESCE(g.google_spend, 0) AS NUMERIC) AS paid_spend
  FROM meta_daily m
  FULL OUTER JOIN google_daily g
    ON m.client_id = g.client_id AND m.date = g.date AND m.currency = g.currency
)
SELECT
  COALESCE(s.client_id, p.client_id) AS client_id,
  COALESCE(s.date,      p.date)      AS date,
  COALESCE(s.currency,  p.currency)  AS currency,

  -- Revenue components
  s.revenue,
  s.new_customer_revenue,
  s.returning_customer_revenue,
  s.net_sales,
  s.new_customer_net_sales,
  s.returning_customer_net_sales,
  s.shipping_revenue,
  s.tax_collected,
  s.gross_revenue_incl_tax,

  -- Cost
  s.cogs,

  -- Orders
  s.orders, s.unique_customers, s.new_customer_orders, s.returning_customer_orders,

  -- Meta — now in the client's currency, not the ad account's
  p.meta_spend, p.meta_revenue, p.meta_purchases, p.meta_impressions, p.meta_clicks, p.meta_reach,

  -- Google — likewise
  p.google_spend, p.google_revenue, p.google_purchases, p.google_impressions, p.google_clicks,

  -- Total paid media — denominator for MER / aMER / CAC
  p.paid_spend,

  -- Variable cost placeholders
  CAST(0 AS NUMERIC) AS cm1_other_costs,
  CAST(0 AS NUMERIC) AS fulfillment_cost,

  -- CM stack — CM3 nets ALL paid media
  s.revenue - s.cogs - 0                                                       AS cm1,
  s.revenue - s.cogs - 0 - 0                                                   AS cm2,
  s.revenue - s.cogs - 0 - 0 - COALESCE(p.paid_spend, 0)                       AS cm3

FROM shop_daily s
FULL OUTER JOIN paid_daily p
  ON s.client_id = p.client_id
 AND s.date      = p.date
 AND s.currency  = p.currency;

-- =============================================================================
-- mart_meta_campaign_perf — registry-driven currency, otherwise unchanged.
-- Stays in the ad account's native currency: this table is read against Ads
-- Manager, and the dashboard converts per row at display time.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_meta_campaign_perf` AS
SELECT
  i.client_id,
  i.date_start AS date,
  i.campaign_id, i.campaign_name, i.ad_account_id,
  -- Aggregatable components
  i.spend, i.purchase_value AS revenue, i.purchases, i.impressions, i.clicks, i.reach,
  i.add_to_cart, i.initiate_checkout, i.landing_page_views, i.link_clicks, i.video_views,
  -- Pre-divided per-day fields — DO NOT SUM/AVG across rows in Looker;
  -- recompute from the sums above instead. Frequency is non-reaggregatable
  -- across days even by SUM(impressions)/SUM(reach) because reach is non-additive.
  i.frequency     AS frequency_per_day,
  i.ctr           AS ctr_per_day,
  i.cpc           AS cpc_per_day,
  i.purchase_roas AS roas_per_day,
  SAFE_DIVIDE(i.spend, i.purchases)          AS cost_per_purchase_per_day,
  SAFE_DIVIDE(i.purchase_value, i.purchases) AS aov_meta_per_day,
  c.meta_currency AS currency
FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` i
JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
WHERE i.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH);

-- =============================================================================
-- mart_meta_ad_perf — same change.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_meta_ad_perf` AS
SELECT
  i.client_id,
  i.date_start AS date,
  i.ad_id, i.ad_name, i.campaign_id, i.adset_id, i.ad_account_id,
  i.spend, i.purchase_value AS revenue, i.purchases, i.impressions, i.clicks, i.reach,
  i.add_to_cart, i.initiate_checkout, i.landing_page_views, i.link_clicks, i.video_views,
  i.video_play_actions, i.video_thruplays,
  i.frequency                          AS frequency_per_day,
  i.ctr                                AS ctr_per_day,
  i.cpc                                AS cpc_per_day,
  SAFE_DIVIDE(i.spend, i.purchases)      AS cost_per_purchase_per_day,
  SAFE_DIVIDE(i.purchase_value, i.spend) AS roas_per_day,
  c.meta_currency AS currency
FROM `oneeighty-warehouse.stg.stg_meta_ad_insights` i
JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
WHERE i.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH);
