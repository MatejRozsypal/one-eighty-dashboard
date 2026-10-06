-- =============================================================================
-- 275_mart_plan_promo_orders.sql
-- Promo x order bridge: which orders belong to which promo. Package PP2 of
-- projects/promo-pacing (raw/03-clickup-bq-model.md sections 4.3 to 4.5 and 5.4).
--
-- Change (additive, nothing existing is modified)
--   NEW VIEW mart.plan_promo_orders, grain (client_id, task_id, order_id): one row per promo
--            and order that matched it, with the best match of that promo for the order.
--            WooCommerce clients only (Ethia today). Shoptet (Manami) needs a separate branch
--            once its coupon field is known.
--
-- Match rules (one promo, one order; lowest rank wins inside the promo)
--   rank 1 coupon       an order coupon equals a promo code or starts with a CODE* prefix,
--                       order_date in [window_start, window_end]
--   rank 2 sku          a paid line (revenue > 0) whose key matches skus, in window
--   rank 3 gift_sku     a 0 Kc line whose key matches gift_skus or skus, in window
--   rank 4 utm          utm_campaign (lower case, '+' read as space) matches utm_campaigns,
--                       in window
--   rank 5 coupon_late  coupon match with order_date in (window_end, window_end + 60 days]
--   rank 6 window       is_storewide promo (Cart discount, Free shipping) and order in window;
--                       has_mechanic tells whether the order actually got a discount
--   Line keys: UPPER(sku), PID:<product_id>, PID:<product_id>/<variation_id>,
--   NAME:<UPPER(item_name)>. A promo key with a trailing '*' is a prefix.
--   Promos with clickup_status 'rejected' or 'on hold' are skipped.
--
-- Columns
--   client_id, task_id, phase, mechanic, source, order_id, order_date
--   match_type, match_rank, matched_key   best match of this promo for the order
--   match_types                           all match types this promo hit, best first
--   is_primary   exclusive portfolio view: one promo per order. Lowest match_rank, then the
--                shorter window, then the later window_start, then task_id.
--   n_promos     how many promos matched the order (overlap diagnostic)
--   arm          is_test promos: 'code' when the order carries a promo coupon, else
--                'no_code'. NULL for other promos.
--   in_window    FALSE only for coupon_late rows
--   net_revenue  subtotal_price - IFNULL(total_refunded, 0), ex VAT, after discounts
--                (equals mart.mart_daily_kpis.net_sales per order)
--   total_discounts, fee_discounts, has_mechanic (total_discounts > 0 OR fee_discounts < 0)
--   is_new_customer  NOT is_returning_customer
--   coupon_codes  order coupons, upper case
--   promo_units, promo_line_revenue   paid lines matching skus
--   gift_units                        0 Kc lines matching gift_skus or skus
--
-- Order base: stg.stg_woo_orders with total_price > 0 (the view keeps processing,
-- completed, on-hold). Same base as the store totals in mart.plan_promo_perf, so the
-- exclusive view never exceeds the store.
--
-- Key source: ref.plan_promo_keys (migration 274). When stg.stg_clickup_plan (PP1) carries
-- Mechanic, Coupon codes, SKUs and UTM campaign, swap the `keys` CTE to a UNION of that
-- view and the history rows; nothing else changes.
--
-- Based on the live views stg.stg_woo_orders and stg.stg_woo_order_items (2026-10-06).
-- Affected clients: none (new view). Rows only for clients present in ref.plan_promo_keys.
-- Regression: new object, no prod counterpart. Backtest in qa/275_276_backtest.sql
-- (mart_qa.pp2_plan_promo_orders), results in projects/promo-pacing/raw/07-pp2-report.md.
-- Cost: about 70 MB per full read (items 66 MB, orders 2 MB).
--
-- Backtest result (mart_qa.pp2_plan_promo_orders, 2026-10-06), 7 historical promos:
--   0 duplicate (task_id, order_id), every matched order has exactly one is_primary row,
--   BF 2025 36 orders (30 coupon + 6 window, store 36), LEDEN9 49, RUZE10 36 (28 coupon +
--   8 utm), VELIKONOCE* 15 (prefix covers 9 and 13), SLUNOVRAT10 12, CASPROSEBE10 17,
--   Xmas bundle 35 orders / 36 units by name key (the 4. 12. sale is outside the window).
--   Synthetic overlap rows (inserted, checked, deleted): storewide window loses to coupon
--   and sku, shorter window wins a tie, coupon_late (45 LEDEN9 orders) loses to the in-window
--   coupon promo, arm code / no_code split 4 / 26, a 'rejected' promo yields no rows.
--
-- Deploy order: 274, 275 (this), 276.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_promo_orders` AS
WITH keys AS (
  SELECT
    k.client_id, k.task_id, k.phase, k.mechanic, k.source, k.is_storewide,
    IFNULL(k.is_test, FALSE) AS is_test,
    k.window_start, k.window_end,
    DATE_DIFF(k.window_end, k.window_start, DAY) + 1 AS window_days,
    ARRAY(SELECT UPPER(TRIM(x)) FROM UNNEST(k.coupon_codes) x WHERE TRIM(x) != '') AS coupon_keys,
    ARRAY(SELECT UPPER(TRIM(x)) FROM UNNEST(k.skus) x WHERE TRIM(x) != '') AS sku_keys,
    ARRAY(SELECT UPPER(TRIM(x)) FROM UNNEST(k.gift_skus) x WHERE TRIM(x) != '') AS gift_keys,
    ARRAY(SELECT LOWER(REPLACE(TRIM(x), '+', ' ')) FROM UNNEST(k.utm_campaigns) x WHERE TRIM(x) != '') AS utm_keys
  FROM `oneeighty-warehouse.ref.plan_promo_keys` k
  WHERE k.window_start IS NOT NULL
    AND k.window_end >= k.window_start
    AND IFNULL(k.clickup_status, '') NOT IN ('rejected', 'on hold')
),
orders AS (
  SELECT
    o.client_id, o.order_id, o.order_date,
    o.subtotal_price - IFNULL(o.total_refunded, 0) AS net_revenue,
    o.total_discounts, o.fee_discounts,
    (IFNULL(o.total_discounts, 0) > 0 OR IFNULL(o.fee_discounts, 0) < 0) AS has_mechanic,
    NOT o.is_returning_customer AS is_new_customer,
    LOWER(REPLACE(TRIM(o.utm_campaign), '+', ' ')) AS utm_campaign,
    ARRAY(SELECT UPPER(TRIM(c)) FROM UNNEST(JSON_VALUE_ARRAY(o.coupon_codes)) c
          WHERE TRIM(c) != '') AS coupon_codes
  FROM `oneeighty-warehouse.stg.stg_woo_orders` o
  WHERE o.total_price > 0
    AND o.client_id IN (SELECT DISTINCT client_id FROM keys)
),
lines AS (
  SELECT
    i.client_id, i.order_id, i.quantity, i.revenue,
    IFNULL(i.revenue, 0) = 0 AS is_zero,
    ARRAY(SELECT x FROM UNNEST([
      UPPER(NULLIF(TRIM(i.sku), '')),
      CONCAT('PID:', i.product_id),
      CONCAT('PID:', i.product_id, '/', i.variation_id),
      CONCAT('NAME:', UPPER(TRIM(i.item_name)))
    ]) x WHERE x IS NOT NULL) AS line_keys
  FROM `oneeighty-warehouse.stg.stg_woo_order_items` i
  WHERE i.client_id IN (SELECT DISTINCT client_id FROM keys)
),
-- candidate orders per promo: in window, or up to 60 days after it (coupon_late)
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
    -- per line: does it match skus / gift keys (EXISTS over the small key arrays)
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
  IFNULL(b.gift_units, 0) AS gift_units
FROM best b;
