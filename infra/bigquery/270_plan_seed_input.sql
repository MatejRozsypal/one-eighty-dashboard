-- =============================================================================
-- 270_plan_seed_input.sql
-- Promo pacing (package pp1), step 1 of 4: plan inputs.
--
-- Purpose
--   The plan fields now exist in ClickUp, but the raw sync of the list needs a prod OK.
--   Until the loader delivers stg.stg_clickup_plan, ref.plan_seed holds the same rows by
--   hand: one row per planning task and version (Level: Target state, Quarter, Month,
--   Promo, Checkpoint).
--   mart.plan_input is the ONLY place downstream objects read plan rows from. When
--   stg.stg_clickup_plan exists, change the `src` CTE to read it (keep seed rows only for
--   task_ids the loader does not return) and nothing downstream changes.
--
-- Change (additive, nothing existing is modified)
--   NEW TABLE ref.plan_seed   Ethia Q4 2026 plan, 17 rows (1 Quarter, 4 Month, 9 Promo,
--                             3 Checkpoint) with the real ClickUp task ids of list
--                             1200620000012625 and their native Start / Due (Prague).
--   NEW VIEW  mart.plan_input current version per task + original version values,
--                             is_valid = status approved or done.
--
-- Based on live view: none (new objects). Source facts read 2026-10-06:
--   ClickUp list "ETH: Promo Akce" (read only), projects/promo-pacing/raw/04 section 1.8
--   (day multipliers), _clients/ethia/research/q4-2026-offers/00-PLAN.md section 5 (gates).
-- Affected clients: ethia only (new rows). No existing object reads these.
-- Regression: not applicable (new objects). QA copies: mart_qa.pp1_plan_seed,
--   mart_qa.pp1_plan_input.
-- Deploy order: 270, 271, 272, 273.
--
-- Seed notes (values mirror ClickUp list 1200620000012625 on 2026-10-06, real task ids)
--   * Fields not in ClickUp yet, seed only: Target new customers on Months (47 % of orders,
--     rounded, trailing 90 day share, raw/04 1.8, PENDING owner sign-off) and MER cap %
--     (Month: 30 / 27 / 24 / 28 from the task descriptions, Quarter 25.4, F4 25, G2 27).
--     When the loader replaces this seed these values disappear unless entered in ClickUp.
--   * Promo Target orders are empty on purpose: the store-in-window target comes from the
--     curve. Day multiplier empty (F1, F9) = 1.0. Coupon codes / SKUs copied as entered.
--   * Checkpoint window = Start to Due inclusive (G1 9. to 19. 10., G2 1. to 30. 11.).
-- =============================================================================

CREATE OR REPLACE TABLE `oneeighty-warehouse.ref.plan_seed`
CLUSTER BY client_id
AS
SELECT * FROM UNNEST(ARRAY<STRUCT<
  client_id STRING, task_id STRING, level STRING, name STRING,
  start_date DATE, end_date DATE, status STRING,
  target_revenue NUMERIC, target_orders INT64, target_new_customers INT64, ad_budget NUMERIC,
  mer_cap_pct FLOAT64, mechanic STRING, day_multiplier FLOAT64,
  coupon_codes STRING, skus STRING, target_units INT64, utm_campaign STRING,
  version INT64, version_at TIMESTAMP, is_seed BOOL, note STRING>>[
  -- Quarter and Months (ClickUp values; new customers and MER cap are seed only, see header)
  ('ethia', '123ymga0z02', 'Quarter', 'Q4 2026', DATE '2026-10-01', DATE '2026-12-31', 'approved',
   433000, 380, NULL, 110000, 25.4, NULL, NULL, NULL, NULL, NULL, NULL,
   1, TIMESTAMP '2026-10-06 00:00:00+00', TRUE, 'realistic plan without a winning ad; quarter = sum of months'),
  ('ethia', '123ymga0z04', 'Month', 'October 2026', DATE '2026-10-01', DATE '2026-10-31', 'approved',
   116000, 105, 49, 32000, 30.0, NULL, NULL, NULL, NULL, NULL, NULL,
   1, TIMESTAMP '2026-10-06 00:00:00+00', TRUE, 'new customers 47 % of orders, seed only, pending sign-off'),
  ('ethia', '123ymga0z07', 'Month', 'November 2026', DATE '2026-11-01', DATE '2026-11-30', 'approved',
   149000, 135, 63, 40000, 27.0, NULL, NULL, NULL, NULL, NULL, NULL,
   1, TIMESTAMP '2026-10-06 00:00:00+00', TRUE, 'MER cap 27 for the month, Black Week 25 on F4; new customers seed only'),
  ('ethia', '123ymga0z08', 'Month', 'December 2026', DATE '2026-12-01', DATE '2026-12-31', 'approved',
   168000, 140, 66, 38000, 24.0, NULL, NULL, NULL, NULL, NULL, NULL,
   1, TIMESTAMP '2026-10-06 00:00:00+00', TRUE, 'new customers seed only'),
  ('ethia', '123ymga0z09', 'Month', 'January 2027', DATE '2027-01-01', DATE '2027-01-31', 'approved',
   173000, 160, 75, 45000, 28.0, NULL, NULL, NULL, NULL, NULL, NULL,
   1, TIMESTAMP '2026-10-06 00:00:00+00', TRUE, 'no Q1 2027 Quarter task yet; new customers seed only'),
  -- Promos (Target orders intentionally empty: store-in-window target comes from the curve)
  ('ethia', '123ymga0tg3', 'Promo', 'F1 · Startovací duo', DATE '2026-10-09', DATE '2026-10-31', 'approved',
   NULL, NULL, NULL, NULL, NULL, 'Bundle', NULL, NULL, NULL, NULL, NULL,
   1, TIMESTAMP '2026-10-06 00:00:00+00', TRUE, 'Day multiplier empty = 1.0 (no analogue)'),
  ('ethia', '123ymga0tg5', 'Promo', 'F2 · Zimní kúra + olej zdarma', DATE '2026-11-01', DATE '2026-11-12', 'approved',
   NULL, NULL, NULL, NULL, NULL, 'Bundle', 0.70, NULL, 'PID:226', NULL, NULL,
   1, TIMESTAMP '2026-10-06 00:00:00+00', TRUE, NULL),
  ('ethia', '123ymga0tg6', 'Promo', 'F3 · Kúra, předpremiéra Black Week', DATE '2026-11-13', DATE '2026-11-22', 'approved',
   NULL, NULL, NULL, NULL, NULL, 'Bundle', 1.08, NULL, NULL, NULL, NULL,
   1, TIMESTAMP '2026-10-06 00:00:00+00', TRUE, NULL),
  ('ethia', '123ymga0tg7', 'Promo', 'F4 · Black Week', DATE '2026-11-23', DATE '2026-11-30', 'approved',
   NULL, NULL, NULL, NULL, 25.0, 'Cart discount', 1.51, NULL, NULL, NULL, NULL,
   1, TIMESTAMP '2026-10-06 00:00:00+00', TRUE, 'MER cap 25 from the description, field not created yet'),
  ('ethia', '123ymga0tg8', 'Promo', 'F5 · Mikuláš, 15 ml zdarma', DATE '2026-12-01', DATE '2026-12-05', 'approved',
   NULL, NULL, NULL, NULL, NULL, 'Gift with purchase', 0.82, NULL, 'PID:5051, PID:1702', NULL, NULL,
   1, TIMESTAMP '2026-10-06 00:00:00+00', TRUE, NULL),
  ('ethia', '123ymga0tga', 'Promo', 'F6 · Dárkové sady', DATE '2026-11-16', DATE '2026-12-17', 'approved',
   NULL, NULL, NULL, NULL, NULL, 'Bundle', 1.66, NULL, NULL, 45, NULL,
   1, TIMESTAMP '2026-10-06 00:00:00+00', TRUE, '3 waves; 1.66 is the 6. to 17. 12. analogue, applied only where F6 is the shortest window'),
  ('ethia', '123ymga0tgc', 'Promo', 'F7 · E-voucher', DATE '2026-12-18', DATE '2026-12-24', 'approved',
   NULL, NULL, NULL, NULL, NULL, 'Voucher', 0.48, NULL, 'PID:4152', 25, NULL,
   1, TIMESTAMP '2026-10-06 00:00:00+00', TRUE, NULL),
  ('ethia', '123ymga0tge', 'Promo', 'F8 · Nová pleť, kúra bez kódu vs LEDEN9', DATE '2026-12-27', DATE '2027-01-31', 'approved',
   NULL, NULL, NULL, NULL, NULL, 'Full price', 0.48, 'LEDEN9', NULL, NULL, NULL,
   1, TIMESTAMP '2026-10-06 00:00:00+00', TRUE, '0.48 shapes 27. to 31. 12.; uniform in January, so no effect there'),
  ('ethia', '123ymga0tgf', 'Promo', 'F9 · Kvíz Sestav si rutinu', DATE '2026-12-01', DATE '2027-03-08', 'planning',
   NULL, NULL, NULL, NULL, NULL, 'Quiz / lead', NULL, NULL, NULL, NULL, NULL,
   1, TIMESTAMP '2026-10-06 00:00:00+00', TRUE, 'overlay; longest window, never sets the curve'),
  -- Checkpoints: measured window = Start to Due, inclusive
  ('ethia', '123ymga0z0a', 'Checkpoint', 'G1 · Winning ad', DATE '2026-10-09', DATE '2026-10-19', 'approved',
   NULL, 45, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   1, TIMESTAMP '2026-10-06 00:00:00+00', TRUE, 'also: winning ad <= 450 Kč per new customer at >= 5k spend in 7 days; check Tue 20. 10.'),
  ('ethia', '123ymga0z0b', 'Checkpoint', 'G2 · Listopad na plánu', DATE '2026-11-01', DATE '2026-11-30', 'approved',
   NULL, 145, NULL, NULL, 27.0, NULL, NULL, NULL, NULL, NULL, NULL,
   1, TIMESTAMP '2026-10-06 00:00:00+00', TRUE, 'and MER <= 27 % (MER cap field not created yet); 145 is above the November target 135'),
  ('ethia', '123ymga0z0c', 'Checkpoint', 'G3 · Winning ad do Vánoc', DATE '2026-12-18', DATE '2026-12-18', 'approved',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   1, TIMESTAMP '2026-10-06 00:00:00+00', TRUE, 'qualitative: winning ad by 18. 12.; no numeric threshold')
]);

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_input` AS
WITH
src AS (
  -- Swap point: replace with stg.stg_clickup_plan (same columns) when the loader exists.
  SELECT client_id, task_id, level, name, start_date, end_date, LOWER(TRIM(status)) AS status,
         target_revenue, target_orders, target_new_customers, ad_budget, mer_cap_pct,
         mechanic, day_multiplier, coupon_codes, skus, target_units, utm_campaign,
         version, version_at, is_seed, note
  FROM `oneeighty-warehouse.ref.plan_seed`
),
ranked AS (
  SELECT s.*,
         ROW_NUMBER() OVER (PARTITION BY client_id, task_id ORDER BY version DESC, version_at DESC) AS rn_cur,
         -- original = first version that was approved (or done); else the first version
         ROW_NUMBER() OVER (PARTITION BY client_id, task_id
                            ORDER BY IF(status IN ('approved', 'done'), 0, 1), version, version_at) AS rn_orig
  FROM src s
)
SELECT
  c.client_id, c.task_id, c.level, c.name, c.start_date, c.end_date, c.status,
  c.status IN ('approved', 'done') AS is_valid,
  c.target_revenue, c.target_orders, c.target_new_customers, c.ad_budget, c.mer_cap_pct,
  c.mechanic, c.day_multiplier, c.coupon_codes, c.skus, c.target_units, c.utm_campaign,
  c.version, c.version_at, c.is_seed, c.note,
  o.version              AS version_original,
  o.target_revenue       AS orig_target_revenue,
  o.target_orders        AS orig_target_orders,
  o.target_new_customers AS orig_target_new_customers,
  o.ad_budget            AS orig_ad_budget
FROM ranked c
JOIN ranked o
  ON o.client_id = c.client_id AND o.task_id = c.task_id AND o.rn_orig = 1
WHERE c.rn_cur = 1;
