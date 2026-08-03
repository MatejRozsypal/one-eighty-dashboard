-- 209_mart_orders_shoptet.sql
-- Extend mart.mart_orders to carry Shoptet (Manami) alongside Shopify (Dobias).
--
-- Until now this view read `stg_shopify_orders` and nothing else, so the whole
-- Orders screen was an empty state for every Shoptet client. Daily totals worked
-- on Snapshot, but there was no way to get from a total down to the orders
-- behind it -- which is the entire job of that screen.
--
-- Conventions follow `mart_daily_kpis` exactly, so an Orders total reconciles
-- against a Snapshot total for the same range:
--   revenue                = total_with_vat_czk     (Shoptet still includes VAT --
--                                                    METRICS.md known gap, not
--                                                    introduced here)
--   net_sales              = product_revenue_czk
--   gross_revenue_incl_tax = total_with_vat_czk
--
-- ── What Shoptet genuinely does not have ────────────────────────────────────
-- These are NULL rather than zero, because zero would claim we measured:
--   shipping_country/_province  the Shoptet order payload carries no address at
--                               all -- verified against raw_shoptet_orders.
--                               payload_json. Would need a different endpoint.
--   shipping_revenue, tax_collected   not separable from total_with_vat_czk.
--   total_discounts             not exposed.
--   fulfillment_status          folded into `status`.
--   cancelled_at, processed_at  no such timestamps; cancellation shows up as
--                               status = 'Stornována'.
--
-- ── Two new columns, both populated for BOTH platforms ──────────────────────
--   platform           'shopify' | 'shoptet'. The UI needs to know which of the
--                      NULLs above are structural rather than missing data, so
--                      it can drop a column instead of printing a row of dashes.
--   market_currency    the currency the customer actually transacted in, before
--                      any normalisation. This is the honest market split for
--                      Shoptet: Manami sells CZ in CZK and SK/EU in EUR, so it
--                      carries real signal, while `shipping_country` would have
--                      to be invented. Note it is NOT the same as `currency`,
--                      which is the currency the amounts are expressed in.
--   order_margin       per-order gross profit. Shoptet reports it directly;
--                      Shopify needs the order-items join, same shape as
--                      mart_customer_lifetime. NULL where lines carry no cost.

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_orders` AS
WITH shopify_order_costs AS (
  SELECT client_id, order_id, SUM(line_cost) AS order_cogs
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, order_id
)

-- Dobias via Shopify. Column list and semantics unchanged from the original
-- view; only `platform`, `market_currency` and `order_margin` are added.
SELECT
  'shopify'                                    AS platform,
  o.client_id,
  o.order_date                                 AS date,
  o.order_id,
  o.order_number,
  o.currency,
  o.currency_original                          AS market_currency,
  o.customer_email,
  o.shipping_country,
  o.shipping_province,
  o.subtotal_price + COALESCE(o.total_shipping, 0) AS revenue,
  o.subtotal_price                             AS net_sales,
  COALESCE(o.total_shipping, 0)                AS shipping_revenue,
  COALESCE(o.total_tax, 0)                     AS tax_collected,
  o.total_price                                AS gross_revenue_incl_tax,
  o.total_discounts,
  CASE WHEN c.order_cogs IS NULL THEN NULL
       ELSE o.subtotal_price - c.order_cogs END AS order_margin,
  o.financial_status,
  o.fulfillment_status,
  o.source_name,
  o.is_returning_customer,
  o.cancelled_at,
  o.processed_at
FROM `oneeighty-warehouse.stg.stg_shopify_orders` o
LEFT JOIN shopify_order_costs c USING (client_id, order_id)
WHERE o.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)

UNION ALL

-- Manami via Shoptet.
SELECT
  'shoptet'                    AS platform,
  client_id,
  order_date                   AS date,
  order_code                   AS order_id,
  order_code                   AS order_number,
  -- Amounts below are the *_czk columns, already normalised by Shoptet's own
  -- exchange_rate, so the currency of the figures is always CZK even when the
  -- customer paid in EUR. That is what `market_currency` preserves.
  'CZK'                        AS currency,
  currency                     AS market_currency,
  email                        AS customer_email,
  CAST(NULL AS STRING)         AS shipping_country,
  CAST(NULL AS STRING)         AS shipping_province,
  total_with_vat_czk           AS revenue,
  product_revenue_czk          AS net_sales,
  CAST(NULL AS NUMERIC)        AS shipping_revenue,
  CAST(NULL AS NUMERIC)        AS tax_collected,
  total_with_vat_czk           AS gross_revenue_incl_tax,
  CAST(NULL AS NUMERIC)        AS total_discounts,
  margin_czk                   AS order_margin,
  status                       AS financial_status,
  CAST(NULL AS STRING)         AS fulfillment_status,
  source                       AS source_name,
  is_returning_customer,
  CAST(NULL AS TIMESTAMP)      AS cancelled_at,
  CAST(NULL AS TIMESTAMP)      AS processed_at
FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);
