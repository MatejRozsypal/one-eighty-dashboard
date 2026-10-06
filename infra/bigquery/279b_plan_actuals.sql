-- =============================================================================
-- 279b_plan_actuals.sql
-- Promo pacing (package pp1): one canonical actuals contract for WooCommerce, Shoptet
-- and Shopify. Everything in the plan layer (271 seasonal split, 272 payday fit and
-- code windows, 273 pacing) reads mart.plan_actuals_daily only (279c).
--
-- Change (additive)
--   NEW VIEW  mart.plan_orders_v         one row per VALID order, all platforms, same columns
--   NEW VIEW  mart.plan_order_lines_v    lines of valid orders + attribution keys (pp2 rules)
--   NEW VIEW  mart.plan_actuals_daily_v  THE canonical daily contract: client x local date,
--                                        zero-filled first valid order to as_of; + Meta
--                                        spend and coupon code windows
--   NEW VIEW  mart.plan_actuals_monthly_v  monthly roll-up, last 36 months (Target view)
--   NEW PROC  mart.sp_refresh_plan_actuals()  snapshots the four views into tables
--             mart.plan_orders, plan_order_lines, plan_actuals_daily, plan_actuals_monthly
--             (__next, ASSERTs, COPY swap). Downstream objects read these snapshots, so
--             each hourly run computes the canonical logic once (~800 MB).
--
-- Canonical rules (identical for every platform)
--   order date    client local date (ref.clients.timezone). Woo: date_created_gmt in
--                 client tz (= stg order_date, 0 mismatches). Shopify: processed_at in
--                 client tz (stg uses the UTC date; 25 % of Dobias orders shift a day).
--                 Shoptet: orderDate (export carries a local date only).
--   valid order   checkout completed AND not cancelled / voided / failed AND not fully
--                 refunded AND gross total (what the customer pays) > 0. Awaiting payment
--                 (bank transfer, COD) is valid until the shop cancels it.
--   net revenue   goods after ALL discounts (coupons, fee / loyalty lines, order-level),
--                 ex VAT, ex shipping, minus the ex-VAT part of refunds, booked on the
--                 ORDER date. Refund ex VAT = refunded gross x (total - tax) / total.
--   new customer  first valid order ever of LOWER(TRIM(email)) per client; no email =
--                 never new. Ties on the same date broken by order_id.
--   units         product line quantities.
--   currency      client currency; order currency converted with ref.fx_rates for the
--                 month of the local order date, latest earlier month if missing.
--
-- Status mapping (raw status -> valid)
--   Woo      processing, completed, on-hold: valid. pending (unpaid checkout), failed,
--            cancelled, refunded, checkout-draft, trash: not valid (stg_woo_orders).
--   Shopify  financial_status paid, partially_paid, partially_refunded, pending,
--            authorized: valid. refunded, voided, any cancelled_at: not valid.
--   Shoptet  every status except cancellation (Stornována, cancelled, zrušeno): valid,
--            incl. payment reminders ("1.připomínka platby", "2. připomínka –> storno"
--            is still unpaid, not cancelled), Reklamace and tester-code statuses.
--   All      gross total = 0 (replacements, free samples, internal draft orders): not
--            valid. Test orders: Shopify test = true only (none since 2025-09; field
--            lives in payload_json, not read here, see report).
--
-- Platform field mapping (net revenue)
--   Woo      stg subtotal_price (ex tax, after coupons + fee-line discounts)
--            - stg total_refunded (refunds x net_ratio). Already client currency.
--   Shopify  subtotal_price_original x net_factor (tax share removed when prices
--            include tax) - total_refunded_original x (total - tax) / total, x fx.
--            total_refunded is NULL for all Dobias rows (not exported): treated as 0.
--   Shoptet  LEAST(productRevenue x vat_ratio, totalPriceWithoutVat) x fx, vat_ratio =
--            totalPriceWithoutVat / totalPriceWithVat. The export has no discount or
--            shipping lines: productRevenue is goods BEFORE order-level discounts,
--            total = goods - discount + shipping. LEAST is exact when an order has no
--            discount or no paid shipping, else it overstates by min(shipping, discount).
--            No refund data (0). Reads raw.raw_shoptet_orders (stg drops the reminder
--            status and does not expose the ex-VAT total).
--
-- Based on live views 2026-10-06: stg.stg_woo_orders, stg.stg_woo_order_items,
--   stg.stg_shopify_orders, stg.stg_shopify_order_items, raw.raw_shoptet_orders,
--   stg.stg_meta_campaign_insights, ref.clients, ref.fx_rates.
-- Affected clients: none (new views). Reconciliation vs mart_daily_kpis: see report 06.
-- QA copies: mart_qa.pp1_ prefix for every object above.
-- Deploy order: 277 (sections 1 and 2), 279a, 279b, 279c.
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
    o.utm_campaign
  FROM `oneeighty-warehouse.stg.stg_woo_orders` o
  JOIN clients c ON c.client_id = o.client_id
  LEFT JOIN woo_units u ON u.client_id = o.client_id AND u.order_id = o.order_id
),
-- Shopify: stg drops cancelled orders; amounts recomputed from shop-currency originals
shopify_units AS (
  SELECT client_id, order_id, SUM(quantity) AS units
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
    CAST(NULL AS STRING)                                 AS utm_campaign
  FROM shopify_base s
  LEFT JOIN shopify_units u ON u.client_id = s.client_id AND u.order_id = s.order_id
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
-- Shoptet: raw, latest row per order (stg drops "2. připomínka –> storno")
shoptet_raw AS (
  SELECT r.*, c.client_currency
  FROM `oneeighty-warehouse.raw.raw_shoptet_orders` r
  JOIN clients c ON c.client_id = r.client_id
  WHERE r.orderDate >= '2020-01-01'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY r.client_id, r.code ORDER BY r.ingested_at DESC) = 1
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
    CAST(NULL AS STRING)                                 AS utm_campaign
  FROM shoptet_raw s
  JOIN shoptet_fx x ON x.client_id = s.client_id AND x.code = s.code
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
  ingested_at
FROM valid;

-- Bootstrap snapshot (views below read it); refreshed by the procedure at the end.
CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_orders` CLUSTER BY client_id, order_date
AS SELECT *, CURRENT_TIMESTAMP() AS refreshed_at FROM `oneeighty-warehouse.mart.plan_orders_v`;

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_actuals_daily_v` AS
WITH
clients AS (
  SELECT client_id, currency, timezone, shop_platform, meta_currency
  FROM `oneeighty-warehouse.ref.clients`
),
params AS (                  -- evergreen coupon codes, never a campaign window
  SELECT c.client_id, IFNULL(p.evergreen_codes, r'^$') AS evergreen_codes
  FROM clients c
  LEFT JOIN UNNEST([
    STRUCT('ethia' AS client_id, r'^(MUJPRVNI|PRVNINAKUP10|ZNOVU10)$' AS evergreen_codes)
  ]) p ON p.client_id = c.client_id
),
o AS (SELECT * FROM `oneeighty-warehouse.mart.plan_orders`),   -- snapshot of plan_orders_v
bounds AS (
  SELECT o.client_id, MIN(o.order_date) AS first_date,
         LEAST(DATE_SUB(CURRENT_DATE(ANY_VALUE(c.timezone)), INTERVAL 1 DAY),
               DATE_SUB(DATE(MAX(o.ingested_at), ANY_VALUE(c.timezone)), INTERVAL 1 DAY)) AS as_of
  FROM o JOIN clients c ON c.client_id = o.client_id
  GROUP BY o.client_id
),
day_orders AS (
  SELECT client_id, order_date AS date,
         COUNT(*)                         AS orders,
         SUM(net_revenue)                 AS revenue,
         COUNTIF(is_new_customer)         AS new_customers,
         SUM(units)                       AS units
  FROM o GROUP BY 1, 2
),
code_windows AS (           -- campaign code: 5+ orders within at most 45 days
  SELECT o.client_id, code, MIN(o.order_date) AS s, MAX(o.order_date) AS e
  FROM o JOIN params p ON p.client_id = o.client_id, UNNEST(o.coupon_codes) AS code
  WHERE NOT REGEXP_CONTAINS(code, p.evergreen_codes)
  GROUP BY 1, 2
  HAVING COUNT(DISTINCT o.order_id) >= 5 AND DATE_DIFF(MAX(o.order_date), MIN(o.order_date), DAY) <= 45
),
code_days AS (
  SELECT DISTINCT client_id, d AS date FROM code_windows, UNNEST(GENERATE_DATE_ARRAY(s, e)) AS d
),
spend AS (
  SELECT m.client_id, m.date_start AS date,
         SUM(m.spend * IF(c.meta_currency = c.currency, NUMERIC '1', fx.rate)) AS meta_spend
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` m
  JOIN clients c ON c.client_id = m.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
    ON  fx.month_start   = DATE_TRUNC(m.date_start, MONTH)
    AND fx.from_currency = c.meta_currency
    AND fx.to_currency   = c.currency
  GROUP BY 1, 2
)
SELECT
  b.client_id,
  c.shop_platform                                AS platform,
  c.currency,
  d                                              AS date,
  IFNULL(x.orders, 0)                            AS orders,
  CAST(IFNULL(x.revenue, 0) AS FLOAT64)          AS revenue,
  IFNULL(x.new_customers, 0)                     AS new_customers,
  CAST(IFNULL(x.units, 0) AS FLOAT64)            AS units,
  CAST(IFNULL(s.meta_spend, 0) AS FLOAT64)       AS meta_spend,
  cd.date IS NOT NULL                            AS is_code_window,
  b.as_of
FROM bounds b
JOIN clients c ON c.client_id = b.client_id,
UNNEST(GENERATE_DATE_ARRAY(b.first_date, b.as_of)) AS d
LEFT JOIN day_orders x ON x.client_id = b.client_id AND x.date = d
LEFT JOIN spend s      ON s.client_id = b.client_id AND s.date = d
LEFT JOIN code_days cd ON cd.client_id = b.client_id AND cd.date = d;

CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_actuals_daily` CLUSTER BY client_id, date
AS SELECT *, CURRENT_TIMESTAMP() AS refreshed_at FROM `oneeighty-warehouse.mart.plan_actuals_daily_v`;

-- Order lines of valid orders, one key set per line for promo attribution (pp2 rules).
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_order_lines_v` AS
WITH
o AS (SELECT client_id, platform, order_id, order_date, fx_rate FROM `oneeighty-warehouse.mart.plan_orders`),
woo AS (
  SELECT i.client_id, CAST(i.order_id AS STRING) AS order_id, i.quantity, i.revenue,
         ARRAY(SELECT x FROM UNNEST([
           UPPER(NULLIF(TRIM(i.sku), '')),
           CONCAT('PID:', i.product_id),
           CONCAT('PID:', i.product_id, '/', i.variation_id),
           CONCAT('NAME:', UPPER(TRIM(i.item_name)))
         ]) x WHERE x IS NOT NULL) AS line_keys
  FROM `oneeighty-warehouse.stg.stg_woo_order_items` i
),
shopify AS (
  SELECT i.client_id, i.order_id, i.quantity, i.revenue_original * i.net_factor AS revenue_oc,
         ARRAY(SELECT DISTINCT x FROM UNNEST([
           UPPER(NULLIF(TRIM(i.sku), '')),
           CONCAT('NAME:', UPPER(TRIM(i.item_name))),
           CONCAT('NAME:', UPPER(TRIM(i.line_item_title)))
         ]) x WHERE x IS NOT NULL) AS line_keys
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items` i
),
shoptet AS (
  SELECT r.client_id, r.orderCode AS order_id, r.itemAmount AS quantity,
         r.itemTotalPriceWithoutVat AS revenue_oc,
         ARRAY(SELECT x FROM UNNEST([
           UPPER(NULLIF(TRIM(r.itemCode), '')),
           CONCAT('PID:', NULLIF(TRIM(r.itemCode), '')),
           CONCAT('NAME:', UPPER(TRIM(r.itemName)))
         ]) x WHERE x IS NOT NULL) AS line_keys
  FROM `oneeighty-warehouse.raw.raw_shoptet_order_items` r
  WHERE r.orderDate >= '2020-01-01'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY r.client_id, r.itemKey ORDER BY r.ingested_at DESC) = 1
)
SELECT *,
       -- gift line: unit price below 1 in client currency (Shoptet books gifts at 0.10 Kč)
       IFNULL(SAFE_DIVIDE(revenue, NULLIF(quantity, 0)), 0) < 1 AS is_gift
FROM (
  SELECT o.client_id, o.platform, o.order_id, o.order_date, l.quantity, l.revenue, l.line_keys
  FROM o JOIN woo l ON l.client_id = o.client_id AND l.order_id = o.order_id
  WHERE o.platform = 'woocommerce'
  UNION ALL
  SELECT o.client_id, o.platform, o.order_id, o.order_date, l.quantity, l.revenue_oc * o.fx_rate, l.line_keys
  FROM o JOIN shopify l ON l.client_id = o.client_id AND l.order_id = o.order_id
  WHERE o.platform = 'shopify'
  UNION ALL
  SELECT o.client_id, o.platform, o.order_id, o.order_date, l.quantity, l.revenue_oc * o.fx_rate, l.line_keys
  FROM o JOIN shoptet l ON l.client_id = o.client_id AND l.order_id = o.order_id
  WHERE o.platform = 'shoptet'
);

-- Closed and current months per client (Target view run-rate, last 36 months).
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_actuals_monthly_v` AS
SELECT
  client_id, ANY_VALUE(platform) AS platform, ANY_VALUE(currency) AS currency,
  month_start,
  LAST_DAY(month_start)                           AS month_end,
  COUNT(*)                                        AS days_with_data,
  SUM(orders)                                     AS orders,
  SUM(revenue)                                    AS revenue,
  SUM(new_customers)                              AS new_customers,
  SUM(units)                                      AS units,
  SUM(meta_spend)                                 AS meta_spend,
  SAFE_DIVIDE(SUM(revenue), SUM(orders))          AS aov,
  ROUND(100 * SAFE_DIVIDE(SUM(meta_spend), SUM(revenue)), 2) AS mer_pct,
  COUNTIF(is_code_window)                         AS code_window_days,
  ANY_VALUE(as_of) >= LAST_DAY(month_start)       AS is_closed,
  ANY_VALUE(as_of)                                AS as_of
FROM (
  SELECT *, DATE_TRUNC(date, MONTH) AS month_start
  FROM `oneeighty-warehouse.mart.plan_actuals_daily`
  WHERE date >= DATE_SUB(DATE_TRUNC(as_of, MONTH), INTERVAL 36 MONTH))
GROUP BY client_id, month_start;

-- Snapshot the canonical views into small tables (253 pattern). Called first by
-- mart.sp_refresh_plan_pacing() (279c). About 800 MB per run, all clients.
CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_plan_actuals`()
BEGIN
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_orders__next`
  CLUSTER BY client_id, order_date
  AS SELECT *, CURRENT_TIMESTAMP() AS refreshed_at FROM `oneeighty-warehouse.mart.plan_orders_v`;
  ASSERT (SELECT COUNT(*) FROM `oneeighty-warehouse.mart.plan_orders__next`) > 0 AS 'plan_orders: no rows';
  ASSERT NOT EXISTS (SELECT 1 FROM `oneeighty-warehouse.mart.plan_orders__next`
                     GROUP BY client_id, order_id HAVING COUNT(*) > 1) AS 'plan_orders: duplicate order';
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_orders` COPY `oneeighty-warehouse.mart.plan_orders__next`;
  DROP TABLE `oneeighty-warehouse.mart.plan_orders__next`;

  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_order_lines__next`
  CLUSTER BY client_id, order_id
  AS SELECT *, CURRENT_TIMESTAMP() AS refreshed_at FROM `oneeighty-warehouse.mart.plan_order_lines_v`;
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_order_lines` COPY `oneeighty-warehouse.mart.plan_order_lines__next`;
  DROP TABLE `oneeighty-warehouse.mart.plan_order_lines__next`;

  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_actuals_daily__next`
  CLUSTER BY client_id, date
  AS SELECT *, CURRENT_TIMESTAMP() AS refreshed_at FROM `oneeighty-warehouse.mart.plan_actuals_daily_v`;
  ASSERT NOT EXISTS (SELECT 1 FROM `oneeighty-warehouse.mart.plan_actuals_daily__next`
                     GROUP BY client_id, date HAVING COUNT(*) > 1) AS 'plan_actuals_daily: duplicate day';
  ASSERT NOT EXISTS (
    SELECT 1
    FROM (SELECT client_id, SUM(orders) AS n, ANY_VALUE(as_of) AS as_of
          FROM `oneeighty-warehouse.mart.plan_actuals_daily__next` GROUP BY client_id) d
    JOIN `oneeighty-warehouse.mart.plan_orders` o
      ON o.client_id = d.client_id AND o.order_date <= d.as_of
    GROUP BY d.client_id, d.n
    HAVING COUNT(*) != d.n) AS 'plan_actuals_daily: orders do not reconcile to plan_orders';
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_actuals_daily` COPY `oneeighty-warehouse.mart.plan_actuals_daily__next`;
  DROP TABLE `oneeighty-warehouse.mart.plan_actuals_daily__next`;

  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_actuals_monthly`
  CLUSTER BY client_id
  AS SELECT *, CURRENT_TIMESTAMP() AS refreshed_at FROM `oneeighty-warehouse.mart.plan_actuals_monthly_v`;
END;

CALL `oneeighty-warehouse.mart.sp_refresh_plan_actuals`();
