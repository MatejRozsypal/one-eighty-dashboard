-- =============================================================================
-- 274_ref_plan_promo_keys.sql
-- Promo attribution keys: one row per promo (ClickUp promo task or historical promo) with
-- the window and the keys that tie an order to it. Package PP2 of projects/promo-pacing
-- (05-ARCHITEKTURA.md section C, raw/03-clickup-bq-model.md sections 3.3, 4 and 5.4).
--
-- Change (additive, nothing existing is modified)
--   NEW TABLE ref.plan_promo_keys, one row per (client_id, task_id). Interim source of the
--             promo keys until the ClickUp fields Mechanic, Coupon codes, SKUs and
--             UTM campaign exist and stg.stg_clickup_plan (package PP1) exposes them. At that
--             point the ClickUp rows of this table are replaced by a view with the same
--             columns; the source = 'history' rows stay as a seed (backtest and day
--             multipliers need past promos that never were ClickUp tasks).
--
-- Columns
--   client_id, task_id   ClickUp task id, or 'hist-<code>' for historical promos
--   phase                F1 to F9 (task name prefix), H-<code> for history
--   promo_name           human label (not a join key)
--   source               'clickup' | 'history'
--   clickup_status       approved | planning | ... (NULL for history). Rows with
--                        'rejected' or 'on hold' are ignored by mart.plan_promo_orders.
--   mechanic             Bundle, Gift with purchase, Cart discount, Discount code,
--                        Personal credit, Voucher, Free shipping, Quiz / lead, Full price
--   is_storewide         mechanic IN ('Cart discount', 'Free shipping'): only these get the
--                        'window' match (every order in the window)
--   is_test              TRUE for promos with a code arm vs a no-code arm (F8 vs LEDEN9)
--   start_ms, due_ms     native ClickUp start_date / due_date (ms epoch), NULL for history
--   window_start/_end    local dates (Europe/Prague), both ends inclusive; for ClickUp rows
--                        DATE(TIMESTAMP_MILLIS(ms), ref.clients.timezone)
--   coupon_codes         upper case; trailing '*' = prefix match
--   skus                 paid line keys, upper case, trailing '*' = prefix. A key is one of:
--                          <SKU>                   Woo SKU (Ethia has SKUs only on 5 hair items)
--                          PID:<product_id>        any variation of a product
--                          PID:<product_id>/<variation_id>
--                          NAME:<item name>        for deleted products (product_id 0)
--   gift_skus            same key format, matched on 0 Kc lines only (gift with purchase)
--   utm_campaigns        lower case, '+' read as space; Ethia utm_campaign mostly holds the
--                        Meta campaign id
--   mer_cap_pct          window store MER cap (meta_spend / net_sales, %)
--   pending_note         what is still missing before the promo can be matched
--
-- Seed content (2026-10-06)
--   F1 to F9 from ClickUp list 1200620000012625 (ETH: Promo Akce), read only. Windows from
--   the native dates; keys known today filled, the rest NULL with a pending_note. The new
--   bundles (starter duo, Zimni kura, three gift sets, e-vouchers) do not exist in the Woo
--   data yet, so their skus are NULL until Ethia creates the products.
--   7 historical promos for the backtest: BF 2025, LEDEN9, RUZE10, VELIKONOCE9,
--   SLUNOVRAT10, CASPROSEBE10 (windows = first to last day the code was used, the shop
--   kept no campaign calendar), Xmas bundle 5 to 18 Dec 2025 (deleted product, name key).
--
-- Based on: nothing live (new table). Product ids, prices and codes checked against
-- stg.stg_woo_order_items and stg.stg_woo_orders on 2026-10-06.
--
-- Affected clients: none (new object). Only Ethia rows.
--
-- Test: mart_qa.pp2_promo_keys (same DDL and seed, prefix pp2_). 16 rows.
--
-- Deploy order: 274 (this), 275_mart_plan_promo_orders.sql, 276_mart_plan_promo_perf.sql.
-- =============================================================================

CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.plan_promo_keys` (
  client_id      STRING NOT NULL,
  task_id        STRING NOT NULL,
  phase          STRING,
  promo_name     STRING,
  source         STRING NOT NULL,
  clickup_status STRING,
  mechanic       STRING NOT NULL,
  is_storewide   BOOL,
  is_test        BOOL,
  start_ms       INT64,
  due_ms         INT64,
  window_start   DATE,
  window_end     DATE,
  coupon_codes   ARRAY<STRING>,
  skus           ARRAY<STRING>,
  gift_skus      ARRAY<STRING>,
  utm_campaigns  ARRAY<STRING>,
  mer_cap_pct    NUMERIC,
  pending_note   STRING,
  updated_at     TIMESTAMP
);

DELETE FROM `oneeighty-warehouse.ref.plan_promo_keys` WHERE client_id = 'ethia';

INSERT INTO `oneeighty-warehouse.ref.plan_promo_keys`
WITH seed AS (
  SELECT * FROM UNNEST(ARRAY<STRUCT<
    task_id STRING, phase STRING, promo_name STRING, source STRING, clickup_status STRING,
    mechanic STRING, is_test BOOL, start_ms INT64, due_ms INT64, d_start DATE, d_end DATE,
    coupon_codes ARRAY<STRING>, skus ARRAY<STRING>, gift_skus ARRAY<STRING>,
    utm_campaigns ARRAY<STRING>, mer_cap_pct NUMERIC, pending_note STRING>>[
    -- ClickUp promos (ETH: Promo Akce)
    ('123ymga0tg3', 'F1', 'Startovaci duo 1 099 Kc', 'clickup', 'approved',
     'Bundle', FALSE, 1791511200000, 1793415600000, NULL, NULL,
     NULL, NULL, NULL, NULL, NULL,
     'skus: duo product (night cream with retinol + niacinamide serum) is not in Woo yet, need its product id or SKU. utm: F1 Meta campaign id.'),
    ('123ymga0tg5', 'F2', 'Zimni kura 1 399 Kc + olej zdarma', 'clickup', 'approved',
     'Bundle', FALSE, 1793502000000, 1794452400000, NULL, NULL,
     NULL, NULL, ['PID:226'], NULL, NULL,
     'skus: Zimni kura product (retinol cream + serum + cleansing milk) is not in Woo yet. gift_skus PID:226 = Odlicovaci olej, valid only if the gift is a 0 Kc line of product 226.'),
    ('123ymga0tg6', 'F3', 'Kura 1 259 Kc (Black Week predpremiera)', 'clickup', 'approved',
     'Bundle', FALSE, 1794538800000, 1795316400000, NULL, NULL,
     NULL, NULL, NULL, NULL, NULL,
     'skus: Zimni kura product id. coupon_codes: only if the -10 % runs through a code.'),
    ('123ymga0tg7', 'F4', 'Black Week -10/-15/-20 % na kosik', 'clickup', 'approved',
     'Cart discount', FALSE, 1795402800000, 1796007600000, NULL, NULL,
     NULL, NULL, ['PID:226'], NULL, 25,
     'coupon_codes: how the tiers are implemented (codes or automatic rule). gift_skus: mystery gift of the last 48 h (15 ml + olej), confirm product ids.'),
    ('123ymga0tg8', 'F5', 'Mikulas 15 ml zdarma od 999 Kc', 'clickup', 'approved',
     'Gift with purchase', FALSE, 1796094000000, 1796439600000, NULL, NULL,
     NULL, NULL, ['PID:5051', 'PID:1702'], NULL, NULL,
     'gift_skus: 5051 = Vzorek Q10, 1702 = Vzorek retinol (sold out). 15 ml is already a standing gift from 1 399 Kc, so only orders 999 to 1 398 Kc are new to the mechanic.'),
    ('123ymga0tga', 'F6', 'Darkove sady ve 3 vlnach', 'clickup', 'approved',
     'Bundle', FALSE, 1794798000000, 1797476400000, NULL, NULL,
     NULL, NULL, NULL, NULL, NULL,
     'skus: Ruzovy ritual 1 590, Velka sada 2 190, Vlasove trio 1 190 are not in Woo yet (online from 1. 11.).'),
    ('123ymga0tgc', 'F7', 'E-voucher + 100 Kc pro kupujiciho', 'clickup', 'approved',
     'Voucher', FALSE, 1797562800000, 1798081200000, NULL, NULL,
     NULL, ['PID:4152'], NULL, NULL, NULL,
     'skus: e-voucher products 1 000 / 1 500 / 2 000 Kc not in Woo yet (PID:4152 = existing Voucher 1000 Kc). coupon_codes: prefix of the buyer 100 Kc codes (counted as coupon_late in January).'),
    ('123ymga0tge', 'F8', 'Nova plet: kura 1 399 Kc bez kodu vs LEDEN9', 'clickup', 'approved',
     'Full price', TRUE, 1798340400000, 1801364400000, NULL, NULL,
     ['LEDEN9'], NULL, NULL, NULL, NULL,
     'skus: Zimni kura product id (same as F2, F3). Test promo: arm code = LEDEN9, arm no_code = kura without the code.'),
    ('123ymga0tgf', 'F9', 'Kviz Sestav si rutinu', 'clickup', 'planning',
     'Quiz / lead', FALSE, 1796094000000, 1804474800000, NULL, NULL,
     NULL, NULL, NULL, NULL, NULL,
     'coupon_codes: prefix of the quiz 200 Kc codes (one-time codes need a shared prefix).'),
    -- Historical promos (backtest and multiplier history)
    ('hist-BF2025', 'H-BF2025', 'Black Friday 2025 BF10/BF15/BF20', 'history', NULL,
     'Cart discount', FALSE, NULL, NULL, DATE '2025-11-24', DATE '2025-11-28',
     ['BF10', 'BF15', 'BF20'], NULL, NULL, ['120236614855360223'], NULL,
     'window from the brief; utm = Meta campaign seen only 25 to 28 Nov 2025'),
    ('hist-LEDEN9', 'H-LEDEN9', 'LEDEN9 leden 2026', 'history', NULL,
     'Discount code', FALSE, NULL, NULL, DATE '2026-01-08', DATE '2026-01-22',
     ['LEDEN9'], NULL, NULL, NULL, NULL, 'banner until 22. 1. 2026'),
    ('hist-RUZE10', 'H-RUZE10', 'RUZE10 unor 2026', 'history', NULL,
     'Discount code', FALSE, NULL, NULL, DATE '2026-02-11', DATE '2026-02-18',
     ['RUZE10'], NULL, NULL, ['120239889976310223'], NULL,
     'window = first to last use of the code; utm = Meta campaign seen only 11 to 18 Feb 2026'),
    ('hist-VELIKONOCE', 'H-VELIKONOCE9', 'VELIKONOCE9 / 13 2026', 'history', NULL,
     'Discount code', FALSE, NULL, NULL, DATE '2026-03-28', DATE '2026-04-07',
     ['VELIKONOCE*'], NULL, NULL, NULL, NULL,
     'window = first to last use; prefix covers VELIKONOCE9 and VELIKONOCE13'),
    ('hist-SLUNOVRAT10', 'H-SLUNOVRAT10', 'SLUNOVRAT10 cerven 2026', 'history', NULL,
     'Discount code', FALSE, NULL, NULL, DATE '2026-06-18', DATE '2026-06-21',
     ['SLUNOVRAT10'], NULL, NULL, NULL, NULL, 'window = first to last use of the code'),
    ('hist-CASPROSEBE10', 'H-CASPROSEBE10', 'CASPROSEBE10 zari 2026', 'history', NULL,
     'Discount code', FALSE, NULL, NULL, DATE '2026-09-01', DATE '2026-09-07',
     ['CASPROSEBE10'], NULL, NULL, NULL, NULL, 'window = first to last use of the code'),
    ('hist-XMAS2025', 'H-XMAS2025', 'Vanocni balicky 2025', 'history', NULL,
     'Bundle', FALSE, NULL, NULL, DATE '2025-12-05', DATE '2025-12-18',
     NULL, ['NAME:VÁNOČNÍ BALÍČEK*'], NULL, NULL, NULL,
     'deleted products (product_id 0), matched by name; first sale 4. 12. falls outside the window')
  ])
)
SELECT
  'ethia' AS client_id,
  s.task_id, s.phase, s.promo_name, s.source, s.clickup_status, s.mechanic,
  s.mechanic IN ('Cart discount', 'Free shipping') AS is_storewide,
  s.is_test, s.start_ms, s.due_ms,
  COALESCE(s.d_start, DATE(TIMESTAMP_MILLIS(s.start_ms), c.timezone)) AS window_start,
  COALESCE(s.d_end,   DATE(TIMESTAMP_MILLIS(s.due_ms),   c.timezone)) AS window_end,
  s.coupon_codes, s.skus, s.gift_skus, s.utm_campaigns, s.mer_cap_pct, s.pending_note,
  CURRENT_TIMESTAMP() AS updated_at
FROM seed s
CROSS JOIN (SELECT timezone FROM `oneeighty-warehouse.ref.clients` WHERE client_id = 'ethia') c;
