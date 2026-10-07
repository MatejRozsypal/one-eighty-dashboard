-- =============================================================================
-- 279j_plan_promo_impact.sql
-- Promo pacing (package pm1): honest promo impact. Fixes three broken columns,
-- puts the attributed orders on the same days as the store they are compared
-- with, and adds the detail and the margin a promo has to be judged on.
--
-- Change
--   REPLACE VIEW mart.plan_promo_orders_v   + platform, order_cogs,
--                                             discount_given, has_code
--   REPLACE VIEW mart.plan_promo_perf_v     fixes 1 to 3 below + new columns
--
-- Fix 1: attr_code_orders and attr_no_code_orders were 0 on EVERY row.
--   They counted `arm`, which 275 sets only on a promo flagged is_test
--   (`IF(is_test, IF(coupon_key IS NOT NULL, 'code', 'no_code'), NULL)`).
--   Exactly one promo is a test arm (Ethia F8, window from 2026-12-27), so
--   `arm` is NULL on all 456 attributed order rows and both COUNTIFs returned
--   zero, including H-LEDEN9 where all 49 orders carry the code. The split is
--   now taken from the order's own coupon array (`has_code`), which is what
--   the question "did they need the code" means, and `arm` keeps its job of
--   splitting a test promo.
--   The platform has to be able to answer at all: the Shoptet export carries
--   no discount code, so `has_coupon_data` is FALSE for a Shoptet client and
--   the split reads n/a instead of "0 with a code".
--
-- Fix 2: attr_discounted_orders counted only `match_type = 'window'`, so it
--   was 0 for every promo matched on a code, a SKU, a gift line or a UTM
--   campaign, and 0 for BF 2025 as well (its 6 window orders were full price).
--   It now counts every attributed order that carries a discount
--   (has_mechanic: an order-level discount, or a negative Woo fee line).
--
-- Fix 3: the attributed side ran one day ahead of the store side. attr came
--   from plan_promo_orders (every order, including today), store from
--   plan_actuals_daily (zero filled to as_of = yesterday), so a running promo
--   could show more attributed orders than the whole store contained: Manami
--   F12 read 48 attributed of 39 store orders and F14 27 of 18. Both sides are
--   now cut at the client's as_of, and the view carries `as_of` and
--   `days_elapsed` so the page can say which days the figures cover.
--
-- New: the promo detail (who bought, how it matched, what was given away) and
--   the margin. `is_storewide` says the promo had nothing to match on beyond
--   the window (or a store-wide mechanic), so its attributed orders ARE the
--   whole store in the window and must be read as such.
--   attr_cm1    = attr_revenue - attr_cogs of the attributed orders, and only
--                 when every one of them is costed (attr_orders_costed =
--                 attr_orders), never a partial sum. METRICS.md CM1 = revenue
--                 - COGS - cm1_other_costs, and cm1_other_costs is a hard 0
--                 in the mart. Revenue is the plan definition (goods ex VAT
--                 after discounts and refunds, no shipping), so this is the
--                 product margin of those baskets, not the Snapshot CM1 of
--                 the client. A client with no cost data (RawBark) reads NULL.
--   CM2         is not a separate number: mart fulfillment_cost is a 0
--                 placeholder and no plan client states a per-order fulfilment
--                 rate, so CM2 would equal CM1 to the crown.
--   attr_cm3    = attr_cm1 - attr_meta_spend, and attr_meta_spend is the spend
--                 of the Meta campaigns the task names in `UTM campaign`,
--                 inside the window, and ONLY for a promo that is not
--                 store-wide. Paid spend cannot otherwise be split between
--                 promos. For a store-wide promo the attributed set is the
--                 whole store, so taking one campaign's spend off it would
--                 read as a margin the window did not make; those rows stay
--                 NULL and store_cm3 answers instead. Today only the two
--                 historical Ethia promos whose seed carries campaign ids
--                 (H-RUZE10, and H-BF2025 which is store-wide and therefore
--                 excluded) can reach this path; no ClickUp promo fills the
--                 field yet.
--   store_cm3   = the mart CM3 of the whole store over the window days, the
--                 same CM3 the period tiles show (plan_actuals_daily, 279g),
--                 NULL when any elapsed day of the window has no cost data.
--                 This is the number that answers "did the window pay for the
--                 ads"; the promo's own CM1 answers "what did these baskets
--                 earn".
--   attr_discount_given  the price actually given away on the attributed
--                 orders (order discounts + negative fee lines). It is NOT
--                 subtracted again: attr_revenue is already net of it.
--
-- Not changed: every existing column keeps its name and meaning except the
--   three fixed above; ref.plan_promo_keys, plan_pacing_v (see 279k),
--   plan_targets_daily, and both refresh procedures.
--
-- Based on: 279d as deployed 2026-10-06, plus 279i (order_cogs) and 279g
--   (plan_actuals_daily cm3 / paid_spend).
-- Affected clients: ethia and manami (fixed columns, new columns); rawbark has
--   no plan rows for promos and no cost data.
-- QA copies: mart_qa.pm1_plan_promo_orders(_v), pm1_plan_promo_perf(_v).
-- Deploy order: after 279i. Then 279k, which CALLs the refresh.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_promo_orders_v` AS
WITH
ref_keys AS (               -- curated keys (pp2), win for their task_ids
  SELECT
    k.client_id, k.task_id, k.phase, k.mechanic, k.source, k.is_storewide,
    IFNULL(k.is_test, FALSE) AS is_test,
    k.window_start, k.window_end,
    k.coupon_codes, k.skus, k.gift_skus, k.utm_campaigns, k.clickup_status
  FROM `oneeighty-warehouse.ref.plan_promo_keys` k
),
plan_keys AS (              -- every other Promo task of mart.plan_input (all clients)
  SELECT
    p.client_id, p.task_id,
    REGEXP_EXTRACT(p.name, r'^(F[0-9]+) ') AS phase,
    p.mechanic, 'clickup' AS source,
    -- nothing to match on (no codes, SKUs, UTM): the promo is the whole store in the window
    p.coupon_codes IS NULL AND p.skus IS NULL AND p.utm_campaign IS NULL AS is_storewide,
    FALSE AS is_test,
    p.start_date AS window_start, p.end_date AS window_end,
    ARRAY(SELECT TRIM(x) FROM UNNEST(SPLIT(IFNULL(p.coupon_codes, ''), ',')) x WHERE TRIM(x) != '') AS coupon_codes,
    ARRAY(SELECT TRIM(x) FROM UNNEST(SPLIT(IFNULL(p.skus, ''), ',')) x WHERE TRIM(x) != '')         AS skus,
    ARRAY<STRING>[]                                                                                 AS gift_skus,
    ARRAY(SELECT TRIM(x) FROM UNNEST(SPLIT(IFNULL(p.utm_campaign, ''), ',')) x WHERE TRIM(x) != '') AS utm_campaigns,
    p.status AS clickup_status
  FROM `oneeighty-warehouse.mart.plan_input` p
  WHERE p.level = 'Promo'
    AND NOT EXISTS (SELECT 1 FROM ref_keys r WHERE r.client_id = p.client_id AND r.task_id = p.task_id)
),
keys AS (
  SELECT
    k.client_id, k.task_id, k.phase, k.mechanic, k.source, k.is_storewide, k.is_test,
    k.window_start, k.window_end,
    DATE_DIFF(k.window_end, k.window_start, DAY) + 1 AS window_days,
    ARRAY(SELECT UPPER(TRIM(x)) FROM UNNEST(k.coupon_codes) x WHERE TRIM(x) != '') AS coupon_keys,
    ARRAY(SELECT UPPER(TRIM(x)) FROM UNNEST(k.skus) x WHERE TRIM(x) != '') AS sku_keys,
    ARRAY(SELECT UPPER(TRIM(x)) FROM UNNEST(k.gift_skus) x WHERE TRIM(x) != '') AS gift_keys,
    ARRAY(SELECT LOWER(REPLACE(TRIM(x), '+', ' ')) FROM UNNEST(k.utm_campaigns) x WHERE TRIM(x) != '') AS utm_keys
  FROM (SELECT * FROM ref_keys UNION ALL SELECT * FROM plan_keys) k
  WHERE k.window_start IS NOT NULL
    AND k.window_end >= k.window_start
    AND IFNULL(k.clickup_status, '') NOT IN ('rejected', 'on hold')
),
orders AS (                 -- canonical valid orders, all platforms (279b, 279i)
  SELECT
    o.client_id, o.platform, o.order_id, o.order_date,
    o.net_revenue,
    o.total_discounts, o.fee_discounts,
    (IFNULL(o.total_discounts, 0) > 0 OR IFNULL(o.fee_discounts, 0) < 0) AS has_mechanic,
    -- price actually given away: order discounts plus negative fee lines (Woo loyalty)
    IFNULL(o.total_discounts, 0) + IF(IFNULL(o.fee_discounts, 0) < 0, -o.fee_discounts, 0) AS discount_given,
    o.is_new_customer,
    LOWER(REPLACE(TRIM(o.utm_campaign), '+', ' ')) AS utm_campaign,
    o.coupon_codes,
    ARRAY_LENGTH(o.coupon_codes) > 0 AS has_code,
    o.order_cogs
  FROM `oneeighty-warehouse.mart.plan_orders` o
  WHERE o.client_id IN (SELECT DISTINCT client_id FROM keys)
),
lines AS (                  -- canonical lines; gift = unit price < 1 (279b)
  SELECT l.client_id, l.order_id, l.quantity, l.revenue, l.is_gift AS is_zero, l.line_keys
  FROM `oneeighty-warehouse.mart.plan_order_lines` l
  WHERE l.client_id IN (SELECT DISTINCT client_id FROM keys)
),
cand AS (
  SELECT k.*, o.* EXCEPT (client_id),
    o.order_date BETWEEN k.window_start AND k.window_end AS in_window
  FROM keys k
  JOIN orders o
    ON o.client_id = k.client_id
   AND o.order_date BETWEEN k.window_start AND DATE_ADD(k.window_end, INTERVAL 60 DAY)
),
coupon_hit AS (
  SELECT c.client_id, c.task_id, c.order_id, MIN(oc) AS matched_key
  FROM cand c, UNNEST(c.coupon_codes) oc, UNNEST(c.coupon_keys) pk
  WHERE oc = pk OR (ENDS_WITH(pk, '*') AND STARTS_WITH(oc, RTRIM(pk, '*')))
  GROUP BY 1, 2, 3
),
line_hit AS (
  SELECT
    c.client_id, c.task_id, c.order_id,
    l.quantity, l.revenue, l.is_zero,
    (SELECT MIN(pk) FROM UNNEST(c.sku_keys) pk, UNNEST(l.line_keys) lk
      WHERE lk = pk OR (ENDS_WITH(pk, '*') AND STARTS_WITH(lk, RTRIM(pk, '*')))) AS sku_key,
    (SELECT MIN(pk) FROM UNNEST(c.gift_keys) pk, UNNEST(l.line_keys) lk
      WHERE lk = pk OR (ENDS_WITH(pk, '*') AND STARTS_WITH(lk, RTRIM(pk, '*')))) AS gift_key
  FROM cand c
  JOIN lines l ON l.client_id = c.client_id AND l.order_id = c.order_id
  WHERE c.in_window
    AND (ARRAY_LENGTH(c.sku_keys) > 0 OR ARRAY_LENGTH(c.gift_keys) > 0)
),
line_agg AS (
  SELECT client_id, task_id, order_id,
    MIN(IF(NOT is_zero, sku_key, NULL)) AS sku_key,
    MIN(IF(is_zero, COALESCE(gift_key, sku_key), NULL)) AS gift_key,
    SUM(IF(NOT is_zero AND sku_key IS NOT NULL, quantity, 0)) AS promo_units,
    SUM(IF(NOT is_zero AND sku_key IS NOT NULL, revenue, 0)) AS promo_line_revenue,
    SUM(IF(is_zero AND COALESCE(gift_key, sku_key) IS NOT NULL, quantity, 0)) AS gift_units
  FROM line_hit
  GROUP BY 1, 2, 3
),
utm_hit AS (
  SELECT c.client_id, c.task_id, c.order_id, MIN(pk) AS matched_key
  FROM cand c, UNNEST(c.utm_keys) pk
  WHERE c.in_window AND c.utm_campaign IS NOT NULL
    AND (c.utm_campaign = pk OR (ENDS_WITH(pk, '*') AND STARTS_WITH(c.utm_campaign, RTRIM(pk, '*'))))
  GROUP BY 1, 2, 3
),
matched AS (
  SELECT
    c.*,
    ch.matched_key AS coupon_key,
    la.sku_key, la.gift_key, la.promo_units, la.promo_line_revenue, la.gift_units,
    uh.matched_key AS utm_key,
    ARRAY(
      SELECT AS STRUCT t.match_type, t.match_rank, t.matched_key FROM UNNEST([
        STRUCT('coupon' AS match_type, 1 AS match_rank,
               IF(c.in_window, ch.matched_key, NULL) AS matched_key),
        STRUCT('sku', 2, la.sku_key),
        STRUCT('gift_sku', 3, la.gift_key),
        STRUCT('utm', 4, uh.matched_key),
        STRUCT('coupon_late', 5, IF(NOT c.in_window, ch.matched_key, NULL)),
        STRUCT('window', 6, IF(c.in_window AND c.is_storewide, 'window', NULL))
      ]) t
      WHERE t.matched_key IS NOT NULL
      ORDER BY t.match_rank
    ) AS hits
  FROM cand c
  LEFT JOIN coupon_hit ch USING (client_id, task_id, order_id)
  LEFT JOIN line_agg  la USING (client_id, task_id, order_id)
  LEFT JOIN utm_hit   uh USING (client_id, task_id, order_id)
),
best AS (
  SELECT
    m.*,
    m.hits[OFFSET(0)].match_type AS match_type,
    m.hits[OFFSET(0)].match_rank AS match_rank,
    m.hits[OFFSET(0)].matched_key AS matched_key,
    ARRAY(SELECT h.match_type FROM UNNEST(m.hits) h ORDER BY h.match_rank) AS match_types
  FROM matched m
  WHERE ARRAY_LENGTH(m.hits) > 0
)
SELECT
  b.client_id, b.task_id, b.phase, b.mechanic, b.source,
  b.window_start, b.window_end, b.window_days,
  b.order_id, b.order_date,
  b.match_type, b.match_rank, b.matched_key, b.match_types,
  ROW_NUMBER() OVER (
    PARTITION BY b.client_id, b.order_id
    ORDER BY b.match_rank, b.window_days, b.window_start DESC, b.task_id
  ) = 1 AS is_primary,
  COUNT(*) OVER (PARTITION BY b.client_id, b.order_id) AS n_promos,
  IF(b.is_test, IF(b.coupon_key IS NOT NULL, 'code', 'no_code'), NULL) AS arm,
  b.in_window,
  b.net_revenue, b.total_discounts, b.fee_discounts, b.has_mechanic,
  b.is_new_customer,
  b.coupon_codes,
  IFNULL(b.promo_units, 0) AS promo_units,
  IFNULL(b.promo_line_revenue, 0) AS promo_line_revenue,
  IFNULL(b.gift_units, 0) AS gift_units,
  -- pm1
  b.platform,
  b.has_code,
  b.discount_given,
  b.order_cogs
FROM best b;


CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_promo_perf_v` AS
WITH
ref_keys AS (
  SELECT k.client_id, k.task_id, k.phase, k.mechanic, k.source, k.clickup_status,
         k.window_start, k.window_end, k.mer_cap_pct,
         IFNULL(k.is_storewide, FALSE) AS is_storewide,
         IFNULL(ARRAY_LENGTH(k.coupon_codes), 0) + IFNULL(ARRAY_LENGTH(k.skus), 0)
           + IFNULL(ARRAY_LENGTH(k.gift_skus), 0)
           + IFNULL(ARRAY_LENGTH(k.utm_campaigns), 0) > 0 AS has_keys,
         IFNULL(k.utm_campaigns, ARRAY<STRING>[]) AS utm_campaigns
  FROM `oneeighty-warehouse.ref.plan_promo_keys` k
),
plan_keys AS (
  SELECT p.client_id, p.task_id, REGEXP_EXTRACT(p.name, r'^(F[0-9]+) ') AS phase, p.mechanic,
         'clickup' AS source, p.status AS clickup_status, p.start_date AS window_start,
         p.end_date AS window_end, p.mer_cap_pct,
         p.coupon_codes IS NULL AND p.skus IS NULL AND p.utm_campaign IS NULL AS is_storewide,
         NOT (p.coupon_codes IS NULL AND p.skus IS NULL AND p.utm_campaign IS NULL) AS has_keys,
         ARRAY(SELECT TRIM(x) FROM UNNEST(SPLIT(IFNULL(p.utm_campaign, ''), ',')) x WHERE TRIM(x) != '') AS utm_campaigns
  FROM `oneeighty-warehouse.mart.plan_input` p
  WHERE p.level = 'Promo'
    AND NOT EXISTS (SELECT 1 FROM ref_keys r WHERE r.client_id = p.client_id AND r.task_id = p.task_id)
),
as_of AS (                  -- the last day the plan layer measures, per client (279b)
  SELECT client_id, MAX(as_of) AS as_of
  FROM `oneeighty-warehouse.mart.plan_actuals_daily`
  GROUP BY 1
),
keys AS (
  SELECT
    k.client_id, k.task_id, k.phase, k.mechanic, k.source, k.clickup_status,
    k.window_start, k.window_end,
    DATE_DIFF(k.window_end, k.window_start, DAY) + 1 AS window_days,
    k.mer_cap_pct,
    CURRENT_DATE(c.timezone) AS today,
    a.as_of,
    k.is_storewide,
    k.has_keys,
    -- only WooCommerce carries a discount code in the warehouse; Shoptet and
    -- Shopify exports have none, so the code split cannot be answered there
    c.shop_platform = 'woocommerce' AS has_coupon_data,
    ARRAY(SELECT LOWER(REPLACE(TRIM(x), '+', ' ')) FROM UNNEST(k.utm_campaigns) x WHERE TRIM(x) != '') AS utm_keys
  FROM (SELECT * FROM ref_keys UNION ALL SELECT * FROM plan_keys) k
  JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
  JOIN as_of a USING (client_id)
  WHERE k.window_start IS NOT NULL
    AND k.window_end >= k.window_start
    AND IFNULL(k.clickup_status, '') NOT IN ('rejected', 'on hold')
),
days AS (
  SELECT k.*, d AS date, DATE_DIFF(d, k.window_start, DAY) + 1 AS day_index
  FROM keys k, UNNEST(GENERATE_DATE_ARRAY(k.window_start, k.window_end)) d
),
span AS (
  SELECT client_id, MIN(window_start) AS d0, MAX(window_end) AS d1 FROM keys GROUP BY 1
),
store_day AS (              -- canonical daily actuals (279b, 279g); runs to as_of only
  SELECT a.client_id, a.date,
    a.orders AS store_orders,
    CAST(a.revenue AS NUMERIC) AS store_revenue,
    a.new_customers AS store_new_customers,
    CAST(a.units AS NUMERIC) AS store_units
  FROM `oneeighty-warehouse.mart.plan_actuals_daily` a
  JOIN span s ON s.client_id = a.client_id AND a.date BETWEEN s.d0 AND s.d1
),
kpi_day AS (                -- Meta spend, net revenue, paid spend and CM3, same table
  SELECT a.client_id, a.date,
    CAST(a.meta_spend AS NUMERIC) AS meta_spend,
    CAST(a.revenue AS NUMERIC)    AS kpi_net_sales,
    CAST(a.paid_spend AS NUMERIC) AS store_paid_spend,
    CAST(a.cm3 AS NUMERIC)        AS store_cm3_raw,
    a.is_cm3_measured
  FROM `oneeighty-warehouse.mart.plan_actuals_daily` a
  JOIN span s ON s.client_id = a.client_id AND a.date BETWEEN s.d0 AND s.d1
),
attr_day AS (
  SELECT o.client_id, o.task_id, o.order_date AS date,
    COUNT(*) AS attr_orders,
    SUM(o.net_revenue) AS attr_revenue,
    COUNTIF(o.is_new_customer) AS attr_new_customers,
    SUM(o.promo_units) AS attr_units,
    SUM(o.gift_units) AS attr_gift_units,
    -- fix 1: the order's own code, not the test arm
    COUNTIF(o.has_code) AS attr_code_orders,
    COUNTIF(NOT o.has_code) AS attr_no_code_orders,
    -- fix 2: every discounted attributed order, not only window matches
    COUNTIF(o.has_mechanic) AS attr_discounted_orders,
    COUNTIF(o.is_primary) AS prim_orders,
    SUM(IF(o.is_primary, o.net_revenue, 0)) AS prim_revenue,
    -- pm1 detail
    COUNTIF(NOT o.is_new_customer) AS attr_returning_customers,
    SUM(o.discount_given) AS attr_discount_given,
    SUM(o.promo_line_revenue) AS attr_promo_line_revenue,
    COUNTIF(o.order_cogs IS NOT NULL) AS attr_orders_costed,
    SUM(o.order_cogs) AS attr_cogs,
    COUNTIF(o.match_type = 'coupon')   AS attr_orders_coupon,
    COUNTIF(o.match_type = 'sku')      AS attr_orders_sku,
    COUNTIF(o.match_type = 'gift_sku') AS attr_orders_gift_sku,
    COUNTIF(o.match_type = 'utm')      AS attr_orders_utm,
    COUNTIF(o.match_type = 'window')   AS attr_orders_window
  FROM `oneeighty-warehouse.mart.plan_promo_orders` o
  JOIN as_of x ON x.client_id = o.client_id
  WHERE o.in_window AND o.order_date <= x.as_of      -- fix 3
  GROUP BY 1, 2, 3
),
late AS (
  SELECT o.client_id, o.task_id, COUNT(*) AS late_orders, SUM(o.net_revenue) AS late_revenue
  FROM `oneeighty-warehouse.mart.plan_promo_orders` o
  JOIN as_of x ON x.client_id = o.client_id
  WHERE NOT o.in_window AND o.order_date <= x.as_of
  GROUP BY 1, 2
),
-- Meta spend that can be put on one promo: only the campaigns the task names
-- in `UTM campaign` (exact id, or a prefix ending in *). NULL when the field
-- is empty or no id matches, because paid spend cannot otherwise be split.
promo_spend AS (
  SELECT k.client_id, k.task_id, m.date_start AS date,
         SUM(m.spend * IF(c.meta_currency = c.currency, NUMERIC '1', fx.rate)) AS attr_meta_spend
  FROM keys k
  JOIN `oneeighty-warehouse.ref.clients` c ON c.client_id = k.client_id
  JOIN `oneeighty-warehouse.stg.stg_meta_campaign_insights` m
    ON  m.client_id = k.client_id
    AND m.date_start BETWEEN k.window_start AND LEAST(k.window_end, k.as_of)
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
    ON  fx.month_start   = DATE_TRUNC(m.date_start, MONTH)
    AND fx.from_currency = c.meta_currency
    AND fx.to_currency   = c.currency
  WHERE ARRAY_LENGTH(k.utm_keys) > 0
    AND NOT k.is_storewide
    AND EXISTS (SELECT 1 FROM UNNEST(k.utm_keys) pk
                WHERE m.campaign_id = pk
                   OR (ENDS_WITH(pk, '*') AND STARTS_WITH(m.campaign_id, RTRIM(pk, '*'))))
  GROUP BY 1, 2, 3
),
day_rows AS (
  SELECT
    d.client_id, d.task_id, d.phase, d.mechanic, d.source, d.clickup_status,
    'day' AS grain, d.date, d.day_index, d.window_start, d.window_end, d.window_days,
    d.date < d.today AS is_complete,
    IFNULL(a.attr_orders, 0) AS attr_orders,
    IFNULL(a.attr_revenue, 0) AS attr_revenue,
    IFNULL(a.attr_new_customers, 0) AS attr_new_customers,
    IFNULL(a.attr_units, 0) AS attr_units,
    IFNULL(a.attr_gift_units, 0) AS attr_gift_units,
    IFNULL(a.attr_code_orders, 0) AS attr_code_orders,
    IFNULL(a.attr_no_code_orders, 0) AS attr_no_code_orders,
    IFNULL(a.attr_discounted_orders, 0) AS attr_discounted_orders,
    IFNULL(a.prim_orders, 0) AS prim_orders,
    IFNULL(a.prim_revenue, 0) AS prim_revenue,
    CAST(NULL AS INT64) AS late_orders,
    CAST(NULL AS NUMERIC) AS late_revenue,
    IFNULL(s.store_orders, 0) AS store_orders,
    IFNULL(s.store_revenue, 0) AS store_revenue,
    IFNULL(s.store_new_customers, 0) AS store_new_customers,
    k.meta_spend, k.kpi_net_sales,
    d.mer_cap_pct,
    -- pm1
    d.as_of,
    d.date <= d.as_of AS is_elapsed,
    d.is_storewide,
    d.has_keys,
    d.has_coupon_data,
    IFNULL(a.attr_returning_customers, 0) AS attr_returning_customers,
    IFNULL(a.attr_discount_given, 0) AS attr_discount_given,
    IFNULL(a.attr_promo_line_revenue, 0) AS attr_promo_line_revenue,
    IFNULL(a.attr_orders_costed, 0) AS attr_orders_costed,
    a.attr_cogs AS attr_cogs,
    IFNULL(a.attr_orders_coupon, 0) AS attr_orders_coupon,
    IFNULL(a.attr_orders_sku, 0) AS attr_orders_sku,
    IFNULL(a.attr_orders_gift_sku, 0) AS attr_orders_gift_sku,
    IFNULL(a.attr_orders_utm, 0) AS attr_orders_utm,
    IFNULL(a.attr_orders_window, 0) AS attr_orders_window,
    ps.attr_meta_spend AS attr_meta_spend,
    IFNULL(s.store_units, 0) AS store_units,
    k.store_paid_spend,
    k.store_cm3_raw,
    IF(d.date <= d.as_of, IFNULL(k.is_cm3_measured, FALSE), TRUE) AS store_cm3_measured
  FROM days d
  LEFT JOIN attr_day a USING (client_id, task_id, date)
  LEFT JOIN store_day s ON s.client_id = d.client_id AND s.date = d.date
  LEFT JOIN kpi_day k ON k.client_id = d.client_id AND k.date = d.date
  LEFT JOIN promo_spend ps
    ON ps.client_id = d.client_id AND ps.task_id = d.task_id AND ps.date = d.date
),
total_rows AS (
  SELECT
    r.client_id, r.task_id, r.phase, r.mechanic, r.source, r.clickup_status,
    'total' AS grain, CAST(NULL AS DATE) AS date, CAST(NULL AS INT64) AS day_index,
    r.window_start, r.window_end, r.window_days,
    LOGICAL_AND(r.is_complete) AS is_complete,
    SUM(r.attr_orders), SUM(r.attr_revenue), SUM(r.attr_new_customers), SUM(r.attr_units),
    SUM(r.attr_gift_units), SUM(r.attr_code_orders), SUM(r.attr_no_code_orders),
    SUM(r.attr_discounted_orders), SUM(r.prim_orders), SUM(r.prim_revenue),
    ANY_VALUE(IFNULL(l.late_orders, 0)), ANY_VALUE(IFNULL(l.late_revenue, 0)),
    SUM(r.store_orders), SUM(r.store_revenue), SUM(r.store_new_customers),
    SUM(r.meta_spend), SUM(r.kpi_net_sales),
    ANY_VALUE(r.mer_cap_pct),
    -- pm1
    ANY_VALUE(r.as_of),
    LOGICAL_OR(r.is_elapsed),
    ANY_VALUE(r.is_storewide),
    ANY_VALUE(r.has_keys),
    ANY_VALUE(r.has_coupon_data),
    SUM(r.attr_returning_customers), SUM(r.attr_discount_given),
    SUM(r.attr_promo_line_revenue), SUM(r.attr_orders_costed), SUM(r.attr_cogs),
    SUM(r.attr_orders_coupon), SUM(r.attr_orders_sku), SUM(r.attr_orders_gift_sku),
    SUM(r.attr_orders_utm), SUM(r.attr_orders_window),
    SUM(r.attr_meta_spend),
    SUM(r.store_units), SUM(r.store_paid_spend), SUM(r.store_cm3_raw),
    LOGICAL_AND(r.store_cm3_measured)
  FROM day_rows r
  LEFT JOIN late l USING (client_id, task_id)
  GROUP BY r.client_id, r.task_id, r.phase, r.mechanic, r.source, r.clickup_status,
           r.window_start, r.window_end, r.window_days
),
all_rows AS (
  SELECT * FROM day_rows
  UNION ALL
  SELECT * FROM total_rows
),
cm AS (
  SELECT
    a.*,
    -- CM1 only on a fully costed set of attributed orders, never a partial sum
    IF(a.attr_orders > 0 AND a.attr_orders_costed = a.attr_orders,
       a.attr_revenue - a.attr_cogs, NULL) AS attr_cm1,
    IF(a.store_cm3_measured, a.store_cm3_raw, NULL) AS store_cm3,
    DATE_DIFF(LEAST(a.window_end, a.as_of), a.window_start, DAY) + 1 AS days_elapsed_raw
  FROM all_rows a
)
SELECT
  c.* EXCEPT (store_cm3_raw, days_elapsed_raw),
  GREATEST(LEAST(c.days_elapsed_raw, c.window_days), 0) AS days_elapsed,
  SAFE_DIVIDE(c.attr_orders, NULLIF(c.store_orders, 0)) AS attr_share_orders,
  SAFE_DIVIDE(c.attr_revenue, NULLIF(c.store_revenue, 0)) AS attr_share_revenue,
  SAFE_DIVIDE(c.prim_orders, NULLIF(c.store_orders, 0)) AS prim_share_orders,
  ROUND(100 * SAFE_DIVIDE(c.meta_spend, NULLIF(c.kpi_net_sales, 0)), 1) AS store_mer_pct,
  IF(c.mer_cap_pct IS NULL OR c.kpi_net_sales IS NULL OR c.kpi_net_sales = 0, NULL,
     100 * c.meta_spend / c.kpi_net_sales > c.mer_cap_pct) AS mer_over_cap,
  ROUND(100 * SAFE_DIVIDE(c.attr_cm1, NULLIF(c.attr_revenue, 0)), 1) AS attr_cm1_pct,
  IF(c.attr_cm1 IS NULL OR c.attr_meta_spend IS NULL, NULL,
     c.attr_cm1 - c.attr_meta_spend) AS attr_cm3
FROM cm c;
