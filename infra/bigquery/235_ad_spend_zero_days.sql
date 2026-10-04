-- =============================================================================
-- 235_ad_spend_zero_days.sql
-- Registry of days on which a platform ran no ads: spend is 0, not missing.
--
-- Problem
--   mart.mart_daily_kpis leaves meta_spend / google_spend NULL on a day that has
--   a shop row but no ad row. The Reports gap rule (METRICS.md, amendment 21)
--   treats a NULL spend as missing data, so every rollup that touches such a day
--   is "Missing days" or excluded. For a client that was simply not advertising
--   (Venev before its first Meta spend) that is wrong: no ads means spend 0.
--   Other NULL spends are real ingestion holes (Dobias Meta Dec 2025 to Mar 2026,
--   RawBark Google 2026-09-17 and a few other RawBark days) and must stay NULL.
--
-- Rule
--   NEW ref.ad_spend_zero_days (client_id, platform 'meta' | 'google', date_from,
--   date_to, note, updated_by, updated_at): "no ads ran in this range, spend is 0,
--   not missing". mart.mart_daily_kpis fills a NULL spend with 0 on a day covered
--   by it, and only there:
--     meta_spend   = COALESCE(meta_spend,   0 if the day is a meta zero day)
--     google_spend = COALESCE(google_spend, 0 if the day is a google zero day)
--     paid_spend   = COALESCE(paid_spend,   0 if the day is a meta or google zero day)
--   Properties (all verified, qa/235_regression.sql):
--     * Fills NULL only. A spend that has a value is never replaced, so a registry
--       row over days with real spend is harmless.
--     * Never creates a row. A day with neither a shop row nor an ad row has no
--       row in the mart and stays absent (it contributes nothing to any sum and
--       is not counted as a gap either).
--     * Overlapping ranges do not fan out (the zero days are SELECT DISTINCT).
--     * date_to is NOT NULL on purpose: a zero range is always closed. An inverted
--       range (date_to < date_from) expands to nothing.
--     * Ad outcomes (meta_revenue, purchases, clicks, impressions, reach, google_*)
--       stay NULL; the Reports rule already reads a NULL outcome on a day with
--       spend as zero. cm1, cm2 and cm3 do not change: they already subtract
--       COALESCE(paid_spend, 0).
--     * Schema identical (34 columns, same names, order and types).
--   Use ranges in the past. Dashboard freshness probes (context.ts ads_last,
--   health.ts meta_last) read "last day with a non-NULL spend", so a zero range
--   that touches the last days would make ads look fresh.
--
-- Seed (owner decision 2026-10-04, Venev, platform meta)
--   2022-07-25 to 2025-12-03   Venev's first Meta spend date in the mart is
--                              2025-12-04; every shop day before it has no ad row.
--                              2022-07-25 is Venev's first mart day. 606 rows.
--   2026-08-10                 owner confirmed no Meta ads that day. The mart has no
--                              row for Venev on 2026-08-10 (no order, no ad row),
--                              so today this seed row changes nothing; it only
--                              takes effect if a row ever exists for that day.
--   NOT seeded (open question to the owner, see reports/fx1.md): 17 Venev shop days
--   AFTER 2025-12-04 with NULL Meta spend (2025-12-19, 2025-12-26, 2026-01-06,
--   2026-03-08..10, 03-12, 03-25, 04-14, 04-18, 04-28, 05-12, 05-18, 06-02, 06-10,
--   06-23, 2026-08-12). They stay NULL (missing) until the owner confirms them.
--
-- Based on the live view definition read from INFORMATION_SCHEMA.VIEWS on
-- 2026-10-04 (mart.mart_daily_kpis md5 9dc5140218469a887bed32050d1bbf0e, equal to
-- the 234 body, so 234 is deployed). The view body below is that text plus five
-- edits (two CTEs meta_zero_days and google_zero_days; COALESCE on meta_spend,
-- google_spend, paid_spend; two LEFT JOINs). md5 of the body below:
-- 9a5405191e68a9be6d52f8f6b5e8cfdc.
--
-- Dependants (live INFORMATION_SCHEMA, 2026-10-04): mart.mart_monthly_kpis (SUMs the
-- daily view, picks it up with no text change: 41 Venev months 2022-07..2025-11 go
-- from NULL to 0 spend, nothing else moves) and stg.stg_customer_orders (reads
-- revenue and cogs only, unaffected).
--
-- Affected clients: Venev only (606 daily rows, 41 monthly rows). dobias, ethia,
-- manami, rawbark: zero diff (whole-row EXCEPT DISTINCT both directions).
-- Regression: qa/235_regression.sql (candidates mart_qa.fx1_*), results in its comments.
--
-- Deploy order: statements 1 to 3 (table, seed, view), in this order, the view
-- reads the table. Idempotent (CREATE IF NOT EXISTS, seed WHERE NOT EXISTS,
-- CREATE OR REPLACE VIEW).
-- Rollback: re-run the pre-235 view text (= the 234 body, md5
-- 9dc5140218469a887bed32050d1bbf0e, stored as the view in 234_cm3_zero_order_days.sql);
-- the registry table can stay (nothing else reads it).
-- =============================================================================

-- 1. Registry table
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.ad_spend_zero_days` (
  client_id   STRING    NOT NULL,                 -- ref.clients.client_id
  platform    STRING    NOT NULL,                 -- 'meta' | 'google'
  date_from   DATE      NOT NULL,
  date_to     DATE      NOT NULL,                 -- inclusive, never open ended
  note        STRING,                             -- why, who confirmed
  updated_by  STRING    NOT NULL,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP() NOT NULL
)
OPTIONS (description = 'Days on which a platform ran no ads: mart.mart_daily_kpis shows spend 0 instead of NULL (missing) on them. Fills NULL only, never creates rows. Only for days the owner confirmed as no ads; real ingestion holes stay NULL. See METRICS.md.');

-- 2. Seed (idempotent): Venev, Meta, owner decision 2026-10-04
INSERT INTO `oneeighty-warehouse.ref.ad_spend_zero_days`
  (client_id, platform, date_from, date_to, note, updated_by)
SELECT * FROM UNNEST([
  STRUCT('venev' AS client_id, 'meta' AS platform, DATE '2022-07-25' AS date_from, DATE '2025-12-03' AS date_to,
         'No Meta ads before the first Meta spend (2025-12-04). Owner decision 2026-10-04.' AS note,
         'matej@oneeighty.cz' AS updated_by),
  STRUCT('venev', 'meta', DATE '2026-08-10', DATE '2026-08-10',
         'Owner confirmed no Meta ads on this day (2026-10-04). No mart row exists for it today.',
         'matej@oneeighty.cz')
]) AS s
WHERE NOT EXISTS (
  SELECT 1 FROM `oneeighty-warehouse.ref.ad_spend_zero_days` z
  WHERE z.client_id = s.client_id AND z.platform = s.platform
    AND z.date_from = s.date_from AND z.date_to = s.date_to);

-- Template for later rows (only for days the owner confirmed as no ads):
--   INSERT INTO `oneeighty-warehouse.ref.ad_spend_zero_days`
--     (client_id, platform, date_from, date_to, note, updated_by)
--   VALUES ('<client_id>', '<meta|google>', DATE '<from>', DATE '<to>', '<why, who confirmed>', '<your email>');

-- 3. View
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_daily_kpis` AS
WITH client_ccy AS (
  SELECT client_id, currency AS client_currency, meta_currency, gads_currency
  FROM `oneeighty-warehouse.ref.clients`
),
shopify_orders_daily AS (
  SELECT
    client_id, order_date AS date, currency,
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
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_date, currency
),
shopify_cogs_daily AS (
  SELECT client_id, order_date AS date, currency, SUM(line_cost) AS cogs
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_date, currency
),
woo_orders_daily AS (
  SELECT
    client_id, order_date AS date, currency,
    SUM(net_revenue) AS revenue,
    SUM(IF(is_returning_customer IS FALSE, net_revenue, 0)) AS new_customer_revenue,
    SUM(IF(is_returning_customer IS TRUE,  net_revenue, 0)) AS returning_customer_revenue,
    SUM(subtotal_price)              AS net_sales,
    SUM(IF(is_returning_customer IS FALSE, subtotal_price, 0)) AS new_customer_net_sales,
    SUM(IF(is_returning_customer IS TRUE,  subtotal_price, 0)) AS returning_customer_net_sales,
    SUM(COALESCE(total_shipping, 0)) AS shipping_revenue,
    SUM(COALESCE(total_tax, 0))      AS tax_collected,
    SUM(total_price)                 AS gross_revenue_incl_tax,
    SUM(fulfillment_variable)        AS fulfillment_cost,
    COUNT(DISTINCT order_id)         AS orders,
    COUNT(DISTINCT customer_email)   AS unique_customers,
    COUNTIF(is_returning_customer IS FALSE) AS new_customer_orders,
    COUNTIF(is_returning_customer IS TRUE)  AS returning_customer_orders
  FROM `oneeighty-warehouse.stg.stg_woo_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_date, currency
),
woo_cogs_daily AS (
  SELECT client_id, order_date AS date, currency, SUM(line_cost) AS cogs
  FROM `oneeighty-warehouse.stg.stg_woo_order_items`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_date, currency
),
shop_daily AS (
  SELECT
    o.client_id, o.date, o.currency,
    o.revenue, o.new_customer_revenue, o.returning_customer_revenue,
    o.net_sales, o.new_customer_net_sales, o.returning_customer_net_sales,
    o.shipping_revenue, o.tax_collected, o.gross_revenue_incl_tax,
    COALESCE(c.cogs, 0) AS cogs,
    CAST(0 AS NUMERIC)  AS fulfillment_cost,
    o.orders, o.unique_customers, o.new_customer_orders, o.returning_customer_orders
  FROM shopify_orders_daily o
  LEFT JOIN shopify_cogs_daily c USING (client_id, date, currency)

  UNION ALL

  SELECT
    client_id, order_date AS date, 'CZK' AS currency,
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
    CAST(0 AS NUMERIC)                 AS fulfillment_cost,
    COUNT(DISTINCT order_code)         AS orders,
    COUNT(DISTINCT email)              AS unique_customers,
    COUNTIF(is_returning_customer IS FALSE) AS new_customer_orders,
    COUNTIF(is_returning_customer IS TRUE)  AS returning_customer_orders
  FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_date

  UNION ALL

  SELECT
    o.client_id, o.date, o.currency,
    o.revenue, o.new_customer_revenue, o.returning_customer_revenue,
    o.net_sales, o.new_customer_net_sales, o.returning_customer_net_sales,
    o.shipping_revenue, o.tax_collected, o.gross_revenue_incl_tax,
    c.cogs              AS cogs,
    o.fulfillment_cost,
    o.orders, o.unique_customers, o.new_customer_orders, o.returning_customer_orders
  FROM woo_orders_daily o
  LEFT JOIN woo_cogs_daily c USING (client_id, date, currency)
),
meta_rows AS (
  SELECT
    m.client_id, m.date_start AS date, c.client_currency AS currency,
    IF(c.meta_currency = c.client_currency, NUMERIC '1', r.rate) AS fx,
    m.spend, m.purchase_value, m.purchases, m.impressions, m.clicks, m.reach
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` m
  JOIN client_ccy c ON c.client_id = m.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` r
    ON  r.month_start   = DATE_TRUNC(m.date_start, MONTH)
    AND r.from_currency = c.meta_currency
    AND r.to_currency   = c.client_currency
  WHERE m.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
),
meta_daily AS (
  SELECT client_id, date, currency,
    SUM(spend * fx) AS meta_spend, SUM(purchase_value * fx) AS meta_revenue,
    SUM(purchases) AS meta_purchases, SUM(impressions) AS meta_impressions,
    SUM(clicks) AS meta_clicks, SUM(reach) AS meta_reach
  FROM meta_rows GROUP BY client_id, date, currency
),
google_rows AS (
  SELECT
    g.client_id, g.date_start AS date, c.client_currency AS currency,
    CAST(IF(c.gads_currency = c.client_currency, NUMERIC '1', r.rate) AS FLOAT64) AS fx,
    g.spend, g.purchase_value, g.purchases, g.impressions, g.clicks
  FROM `oneeighty-warehouse.stg.stg_google_ads_campaign_insights` g
  JOIN client_ccy c ON c.client_id = g.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` r
    ON  r.month_start   = DATE_TRUNC(g.date_start, MONTH)
    AND r.from_currency = c.gads_currency
    AND r.to_currency   = c.client_currency
  WHERE g.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
),
google_daily AS (
  SELECT client_id, date, currency,
    SUM(spend * fx) AS google_spend, SUM(purchase_value * fx) AS google_revenue,
    SUM(purchases) AS google_purchases, SUM(impressions) AS google_impressions,
    SUM(clicks) AS google_clicks
  FROM google_rows GROUP BY client_id, date, currency
),
paid_daily AS (
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
),
-- Clients that have cost data: at least one shop day with a non-NULL cogs.
-- Shopify and Shoptet always have one (cogs is coalesced to 0 or computed);
-- a Woo client has one only when some line is costed (migration 228), so
-- RawBark is absent here until its cost list is loaded.
client_cost_data AS (
  SELECT DISTINCT client_id
  FROM shop_daily
  WHERE cogs IS NOT NULL
),
-- Registry of days on which a platform ran no ads (ref.ad_spend_zero_days, 235).
-- One row per client and day, expanded from the date ranges. Used only to fill a
-- NULL spend with 0 on a row that already exists; it never creates a row and
-- never replaces a spend that has a value.
meta_zero_days AS (
  SELECT DISTINCT z.client_id, d AS date
  FROM `oneeighty-warehouse.ref.ad_spend_zero_days` AS z, UNNEST(GENERATE_DATE_ARRAY(z.date_from, z.date_to)) AS d
  WHERE z.platform = 'meta'
),
google_zero_days AS (
  SELECT DISTINCT z.client_id, d AS date
  FROM `oneeighty-warehouse.ref.ad_spend_zero_days` AS z, UNNEST(GENERATE_DATE_ARRAY(z.date_from, z.date_to)) AS d
  WHERE z.platform = 'google'
)
SELECT
  COALESCE(s.client_id, p.client_id) AS client_id,
  COALESCE(s.date,      p.date)      AS date,
  COALESCE(s.currency,  p.currency)  AS currency,
  s.revenue, s.new_customer_revenue, s.returning_customer_revenue,
  s.net_sales, s.new_customer_net_sales, s.returning_customer_net_sales,
  s.shipping_revenue, s.tax_collected, s.gross_revenue_incl_tax,
  s.cogs,
  s.orders, s.unique_customers, s.new_customer_orders, s.returning_customer_orders,
  COALESCE(p.meta_spend, IF(mz.client_id IS NOT NULL, CAST(0 AS NUMERIC), NULL)) AS meta_spend,
  p.meta_revenue, p.meta_purchases, p.meta_impressions, p.meta_clicks, p.meta_reach,
  COALESCE(p.google_spend, IF(gz.client_id IS NOT NULL, CAST(0 AS FLOAT64), NULL)) AS google_spend,
  p.google_revenue, p.google_purchases, p.google_impressions, p.google_clicks,
  COALESCE(p.paid_spend, IF(mz.client_id IS NOT NULL OR gz.client_id IS NOT NULL, CAST(0 AS NUMERIC), NULL)) AS paid_spend,
  CAST(0 AS NUMERIC) AS cm1_other_costs,
  COALESCE(s.fulfillment_cost, 0) AS fulfillment_cost,
  -- Day with paid spend and no shop row at all (s.client_id IS NULL) for a client
  -- with cost data: no orders means revenue 0, COGS 0, fulfilment 0, so the day
  -- costs exactly its paid spend. Without a cost-data client (RawBark) it stays NULL.
  IF(s.client_id IS NULL AND k.client_id IS NOT NULL,
     CAST(0 AS NUMERIC),
     s.revenue - s.cogs - 0)                                      AS cm1,
  IF(s.client_id IS NULL AND k.client_id IS NOT NULL,
     CAST(0 AS NUMERIC) - COALESCE(s.fulfillment_cost, 0),
     s.revenue - s.cogs - 0 - COALESCE(s.fulfillment_cost, 0))    AS cm2,
  IF(s.client_id IS NULL AND k.client_id IS NOT NULL,
     CAST(0 AS NUMERIC) - COALESCE(s.fulfillment_cost, 0) - COALESCE(p.paid_spend, 0),
     s.revenue - s.cogs - 0 - COALESCE(s.fulfillment_cost, 0) - COALESCE(p.paid_spend, 0)) AS cm3
FROM shop_daily s
FULL OUTER JOIN paid_daily p
  ON s.client_id = p.client_id AND s.date = p.date AND s.currency = p.currency
LEFT JOIN client_cost_data k
  ON k.client_id = COALESCE(s.client_id, p.client_id)
LEFT JOIN meta_zero_days mz
  ON mz.client_id = COALESCE(s.client_id, p.client_id) AND mz.date = COALESCE(s.date, p.date)
LEFT JOIN google_zero_days gz
  ON gz.client_id = COALESCE(s.client_id, p.client_id) AND gz.date = COALESCE(s.date, p.date);
