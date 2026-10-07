-- =============================================================================
-- 279i_plan_order_cogs.sql
-- Promo pacing (package pm1): cost of goods per order in the canonical order
-- contract, so a promo can be read on margin and not only on revenue.
--
-- Change (additive, one new column)
--   REPLACE VIEW mart.plan_orders_v   + order_cogs NUMERIC
--
-- order_cogs = cost of the goods of that order, in client currency, ex VAT,
-- on the same definition mart_daily_kpis uses per platform (METRICS.md,
-- Contribution Margin stack):
--   Woo       SUM(stg_woo_order_items.line_cost). NULL when the order has no
--             line at all, or when ANY line has no cost: a partly costed order
--             understates COGS and would overstate margin (METRICS.md known
--             gap "Partial COGS days (Woo)"). Checked 2026-10-07: Ethia has 0
--             uncosted lines since 2025-09, RawBark has no cost on any line,
--             so RawBark order_cogs is NULL on every order.
--   Shopify   SUM(stg_shopify_order_items.line_cost) in order currency x fx,
--             same rule for uncosted lines.
--   Shoptet   stg_shoptet_orders.product_revenue_czk - margin_czk, converted
--             CZK -> client currency. Shoptet COGS is implicit (revenue minus
--             the margin the export reports) and stg already nets the
--             imputed-cost adjustment of migration 260 (Manami 2026: 85
--             orders, 18 137.95 CZK), so this equals the mart COGS to the
--             crown. The CZK pair is used on purpose: the order-currency
--             `margin` of stg_shoptet_orders divides the adjustment by
--             `exchange_rate` the wrong way round for a non-CZK order, which
--             turns 2 EUR orders of January 2026 into about 245 000 of COGS
--             each. Nothing else in the warehouse reads that column.
--             NULL for an order stg does not carry (plan_orders keeps the
--             payment-reminder statuses stg drops) and for a Shoptet client
--             whose currency has no CZK rate.
--
-- NULL is never 0: a client without cost data reads n/a everywhere downstream.
--
-- Not changed: every other column of plan_orders_v, plan_order_lines_v,
--   plan_actuals_daily_v, plan_actuals_monthly_v, sp_refresh_plan_actuals,
--   sp_refresh_plan_pacing. plan_orders is a snapshot table created with
--   CREATE OR REPLACE by the procedure, so it simply gains the column.
--
-- Based on: 279b as deployed 2026-10-06 (plan_orders_v) plus 279f / 279g / 279h.
-- Affected clients: ethia and manami gain order_cogs; rawbark NULL (no costs);
--   dobias and venev unaffected in the plan layer (no plan rows).
-- QA copies: mart_qa.pm1_plan_orders(_v).
-- Deploy order: after 279h. Then 279j. No CALL here: 279j ends with the refresh.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_orders_v` AS
WITH
clients AS (
  SELECT client_id, currency AS client_currency, timezone, shop_platform
  FROM `oneeighty-warehouse.ref.clients`
),
fx AS (
  SELECT from_currency, to_currency, month_start, rate FROM `oneeighty-warehouse.ref.fx_rates`
),
-- WooCommerce: stg keeps processing / completed / on-hold, amounts in client currency
woo_units AS (
  SELECT client_id, order_id, SUM(quantity) AS units
  FROM `oneeighty-warehouse.stg.stg_woo_order_items`
  GROUP BY 1, 2
),
woo_cogs AS (                -- NULL when any line is uncosted (never a partial sum)
  SELECT client_id, order_id,
         IF(COUNTIF(line_cost IS NULL) > 0, NULL, SUM(line_cost)) AS order_cogs
  FROM `oneeighty-warehouse.stg.stg_woo_order_items`
  GROUP BY 1, 2
),
woo AS (
  SELECT
    o.client_id, 'woocommerce' AS platform, CAST(o.order_id AS STRING) AS order_id,
    DATE(o.date_created_gmt, c.timezone)                  AS order_date,
    o.ingested_at,
    NULLIF(LOWER(TRIM(o.customer_email)), '')            AS customer_key,
    o.subtotal_price                                     AS goods_net,
    IFNULL(o.total_refunded, 0)                          AS refund_net,
    o.total_discounts                                    AS total_discounts,
    IFNULL(o.fee_discounts, 0)                           AS fee_discounts,
    o.fx_rate                                            AS fx_rate,
    o.total_price > 0                                    AS is_valid,
    CAST(IFNULL(u.units, 0) AS NUMERIC)                  AS units,
    ARRAY(SELECT UPPER(TRIM(x)) FROM UNNEST(JSON_VALUE_ARRAY(o.coupon_codes)) AS x
          WHERE TRIM(x) != '')                           AS coupon_codes,
    o.utm_campaign,
    g.order_cogs                                         AS order_cogs
  FROM `oneeighty-warehouse.stg.stg_woo_orders` o
  JOIN clients c ON c.client_id = o.client_id
  LEFT JOIN woo_units u ON u.client_id = o.client_id AND u.order_id = o.order_id
  LEFT JOIN woo_cogs  g ON g.client_id = o.client_id AND g.order_id = o.order_id
),
-- Shopify: stg drops cancelled orders; amounts recomputed from shop-currency originals
shopify_units AS (
  SELECT client_id, order_id, SUM(quantity) AS units
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
  GROUP BY 1, 2
),
shopify_cogs AS (
  SELECT client_id, order_id,
         IF(COUNTIF(line_cost IS NULL) > 0, NULL, SUM(line_cost)) AS order_cogs_oc
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
  GROUP BY 1, 2
),
shopify_base AS (
  SELECT s.*, c.client_currency, DATE(s.processed_at, c.timezone) AS local_date
  FROM `oneeighty-warehouse.stg.stg_shopify_orders` s
  JOIN clients c ON c.client_id = s.client_id
),
shopify AS (
  SELECT
    s.client_id, 'shopify' AS platform, s.order_id,
    s.local_date AS order_date,
    s.ingested_at,
    NULLIF(LOWER(TRIM(s.customer_email)), '')            AS customer_key,
    s.subtotal_price_original * s.net_factor * r.rate    AS goods_net,
    IFNULL(s.total_refunded_original, 0)
      * IFNULL(SAFE_DIVIDE(s.total_price_original - s.total_tax_original, s.total_price_original), 1)
      * r.rate                                           AS refund_net,
    IFNULL(s.total_discounts_original, 0) * s.net_factor * r.rate AS total_discounts,
    NUMERIC '0'                                          AS fee_discounts,
    r.rate                                               AS fx_rate,
    s.total_price_original > 0
      AND UPPER(s.financial_status) NOT IN ('REFUNDED', 'VOIDED')   AS is_valid,
    CAST(IFNULL(u.units, 0) AS NUMERIC)                  AS units,
    ARRAY<STRING>[]                                      AS coupon_codes,
    CAST(NULL AS STRING)                                 AS utm_campaign,
    g.order_cogs_oc * r.rate                             AS order_cogs
  FROM shopify_base s
  LEFT JOIN shopify_units u ON u.client_id = s.client_id AND u.order_id = s.order_id
  LEFT JOIN shopify_cogs  g ON g.client_id = s.client_id AND g.order_id = s.order_id
  LEFT JOIN (
    SELECT b.client_id, b.order_id,
           IF(b.currency_original = b.client_currency, NUMERIC '1', f.rate) AS rate
    FROM shopify_base b
    LEFT JOIN fx f
      ON f.from_currency = b.currency_original AND f.to_currency = b.client_currency
     AND f.month_start <= DATE_TRUNC(b.local_date, MONTH)
    WHERE TRUE
    QUALIFY ROW_NUMBER() OVER (PARTITION BY b.client_id, b.order_id ORDER BY f.month_start DESC) = 1
  ) r ON r.client_id = s.client_id AND r.order_id = s.order_id
),
-- Shoptet: raw, latest row per order (stg drops the second payment reminder status)
shoptet_raw AS (
  SELECT r.*, c.client_currency
  FROM `oneeighty-warehouse.raw.raw_shoptet_orders` r
  JOIN clients c ON c.client_id = r.client_id
  WHERE r.orderDate >= '2020-01-01'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY r.client_id, r.code ORDER BY r.ingested_at DESC) = 1
),
shoptet_cogs AS (            -- implicit COGS in CZK, imputed-cost adjustment already netted
  SELECT client_id, order_code, product_revenue_czk - margin_czk AS order_cogs_czk
  FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
),
shoptet_czk AS (             -- CZK -> client currency (1 for a CZK client), NULL if no rate
  SELECT b.client_id, b.code,
         IF(b.client_currency = 'CZK', NUMERIC '1', f.rate) AS czk_rate
  FROM shoptet_raw b
  LEFT JOIN fx f
    ON f.from_currency = 'CZK' AND f.to_currency = b.client_currency
   AND f.month_start <= DATE_TRUNC(b.orderDate, MONTH)
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (PARTITION BY b.client_id, b.code ORDER BY f.month_start DESC) = 1
),
shoptet_fx AS (
  SELECT b.client_id, b.code,
         IF(b.currency = b.client_currency, NUMERIC '1', f.rate) AS rate
  FROM shoptet_raw b
  LEFT JOIN fx f
    ON f.from_currency = b.currency AND f.to_currency = b.client_currency
   AND f.month_start <= DATE_TRUNC(b.orderDate, MONTH)
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (PARTITION BY b.client_id, b.code ORDER BY f.month_start DESC) = 1
),
shoptet AS (
  SELECT
    s.client_id, 'shoptet' AS platform, s.code AS order_id,
    s.orderDate AS order_date,
    s.ingested_at,
    NULLIF(LOWER(TRIM(s.email)), '')                     AS customer_key,
    LEAST(s.productRevenue * IFNULL(SAFE_DIVIDE(s.totalPriceWithoutVat, s.totalPriceWithVat), 1),
          s.totalPriceWithoutVat) * x.rate               AS goods_net,
    NUMERIC '0'                                          AS refund_net,
    GREATEST(s.productRevenue * IFNULL(SAFE_DIVIDE(s.totalPriceWithoutVat, s.totalPriceWithVat), 1)
             - s.totalPriceWithoutVat, 0) * x.rate      AS total_discounts,
    NUMERIC '0'                                          AS fee_discounts,
    x.rate                                               AS fx_rate,
    s.totalPriceWithVat > 0
      AND NOT REGEXP_CONTAINS(LOWER(TRIM(IFNULL(s.statusName, ''))), r'^(stornov|storno$|cancel|zrušen)')
                                                         AS is_valid,
    CAST(IFNULL(s.totalQuantity, 0) AS NUMERIC)          AS units,
    ARRAY<STRING>[]                                      AS coupon_codes,
    CAST(NULL AS STRING)                                 AS utm_campaign,
    g.order_cogs_czk * z.czk_rate                        AS order_cogs
  FROM shoptet_raw s
  JOIN shoptet_fx x ON x.client_id = s.client_id AND x.code = s.code
  LEFT JOIN shoptet_czk  z ON z.client_id = s.client_id AND z.code = s.code
  LEFT JOIN shoptet_cogs g ON g.client_id = s.client_id AND g.order_code = s.code
),
all_orders AS (
  SELECT * FROM woo UNION ALL SELECT * FROM shopify UNION ALL SELECT * FROM shoptet
),
valid AS (
  SELECT a.* EXCEPT (is_valid) FROM all_orders a WHERE a.is_valid
)
SELECT
  client_id,
  platform,
  order_id,
  order_date,
  customer_key,
  customer_key IS NOT NULL
    AND ROW_NUMBER() OVER (PARTITION BY client_id, customer_key ORDER BY order_date, order_id) = 1
                                                         AS is_new_customer,
  goods_net,
  refund_net,
  goods_net - refund_net                                 AS net_revenue,
  total_discounts,
  fee_discounts,
  fx_rate,
  units,
  coupon_codes,
  utm_campaign,
  ingested_at,
  CAST(order_cogs AS NUMERIC)                            AS order_cogs
FROM valid;
