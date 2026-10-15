-- =============================================================================
-- 297_market_scouting_signals.sql
-- Markets Scouting: raw signals for the opportunity index, per client x
-- unsold country. The index itself (weights, normalisation, coverage) lives in
-- the query layer (dashboard/lib/markets/opportunity.ts) so it is testable
-- and visible; this view only counts.
--
-- Windows are fixed, not the page period: an opportunity is structural.
--   orders      last 365 complete days, mart.market_orders, market = OTHER
--   GA4         last 90 complete days, mart.market_ga4_country_daily (296)
--   search      latest as_of per client x country x term, core terms only
--
-- Creates
--   1. ref.market_search_demand  head search terms per client x country with
--      monthly volume (Ahrefs). Filled after the owner confirms the terms
--      (docs/sessions/2026-10-15/markets/SEARCH-TERMS-DRAFT.md).
--   2. mart.market_scouting_signals  view
-- =============================================================================

CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.market_search_demand`
(
  client_id STRING NOT NULL,
  iso2 STRING NOT NULL,
  term STRING NOT NULL,
  language STRING,
  is_core BOOL NOT NULL OPTIONS(description = "Core terms feed the opportunity index; the rest are context."),
  monthly_volume INT64 OPTIONS(description = "Average monthly searches in that country (Ahrefs Keywords Explorer)."),
  source STRING NOT NULL,
  as_of DATE NOT NULL,
  note STRING,
  updated_at TIMESTAMP NOT NULL
)
CLUSTER BY client_id, iso2
OPTIONS (description = 'Head search terms per client x country with monthly volume, for the Markets opportunity index. Migration 297.');

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.market_scouting_signals`
OPTIONS (description = 'Opportunity index inputs per client x unsold country: organic orders (365 d), GA4 engaged and unpaid engaged sessions (90 d) with day coverage, core search volume. Sold markets (ref.client_markets) excluded. Migration 297.')
AS
WITH
as_of AS (
  SELECT DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) AS d
),
sold AS (
  SELECT client_id, market FROM `oneeighty-warehouse.ref.client_markets`
),
orders AS (
  SELECT o.client_id, o.country AS iso2,
    COUNT(*)                                            AS orders_365,
    COUNTIF(o.is_new_customer)                          AS new_customers_365,
    SUM(o.net_revenue)                                  AS net_revenue_365,
    SAFE_DIVIDE(SUM(IF(o.is_new_customer, o.net_sales, 0)), COUNTIF(o.is_new_customer)) AS aov_new_365
  FROM `oneeighty-warehouse.mart.market_orders` o, as_of a
  WHERE o.market = 'OTHER' AND o.country IS NOT NULL
    AND o.order_date BETWEEN DATE_SUB(a.d, INTERVAL 364 DAY) AND a.d
  GROUP BY o.client_id, o.country
),
ga4_days AS (            -- days with any GA4 data for the client in the window
  SELECT g.client_id, COUNT(DISTINCT g.date) AS ga4_days_90
  FROM `oneeighty-warehouse.mart.market_ga4_country_daily` g, as_of a
  WHERE g.date BETWEEN DATE_SUB(a.d, INTERVAL 89 DAY) AND a.d
  GROUP BY g.client_id
),
ga4 AS (
  SELECT g.client_id, g.iso2,
    SUM(g.sessions)                AS sessions_90,
    SUM(g.engaged_sessions)        AS engaged_sessions_90,
    SUM(g.unpaid_engaged_sessions) AS unpaid_engaged_sessions_90,
    SUM(g.add_to_cart_sessions)    AS add_to_cart_sessions_90,
    SUM(g.purchases)               AS ga4_purchases_90
  FROM `oneeighty-warehouse.mart.market_ga4_country_daily` g, as_of a
  WHERE g.iso2 IS NOT NULL
    AND g.date BETWEEN DATE_SUB(a.d, INTERVAL 89 DAY) AND a.d
  GROUP BY g.client_id, g.iso2
),
search AS (
  SELECT client_id, iso2,
    SUM(monthly_volume)   AS search_volume_core,
    COUNT(*)              AS search_terms_core,
    MAX(as_of)            AS search_as_of
  FROM (
    SELECT * FROM `oneeighty-warehouse.ref.market_search_demand`
    WHERE is_core
    QUALIFY ROW_NUMBER() OVER (PARTITION BY client_id, iso2, term ORDER BY as_of DESC, updated_at DESC) = 1
  )
  GROUP BY client_id, iso2
),
keys AS (
  SELECT client_id, iso2 FROM orders
  UNION DISTINCT SELECT client_id, iso2 FROM ga4
  UNION DISTINCT SELECT client_id, iso2 FROM search
)
SELECT
  k.client_id,
  k.iso2,
  IFNULL(o.orders_365, 0)                 AS orders_365,
  IFNULL(o.new_customers_365, 0)          AS new_customers_365,
  IFNULL(o.net_revenue_365, 0)            AS net_revenue_365,
  o.aov_new_365,
  d.ga4_days_90,
  IF(d.ga4_days_90 IS NULL, NULL, IFNULL(g.sessions_90, 0))                AS sessions_90,
  IF(d.ga4_days_90 IS NULL, NULL, IFNULL(g.engaged_sessions_90, 0))        AS engaged_sessions_90,
  IF(d.ga4_days_90 IS NULL, NULL, IFNULL(g.unpaid_engaged_sessions_90, 0)) AS unpaid_engaged_sessions_90,
  IF(d.ga4_days_90 IS NULL, NULL, IFNULL(g.add_to_cart_sessions_90, 0))    AS add_to_cart_sessions_90,
  IF(d.ga4_days_90 IS NULL, NULL, IFNULL(g.ga4_purchases_90, 0))           AS ga4_purchases_90,
  s.search_volume_core,
  s.search_terms_core,
  s.search_as_of
FROM keys k
LEFT JOIN orders o   USING (client_id, iso2)
LEFT JOIN ga4 g      USING (client_id, iso2)
LEFT JOIN search s   USING (client_id, iso2)
LEFT JOIN ga4_days d ON d.client_id = k.client_id
LEFT JOIN sold x     ON x.client_id = k.client_id AND x.market = k.iso2
WHERE x.market IS NULL;
