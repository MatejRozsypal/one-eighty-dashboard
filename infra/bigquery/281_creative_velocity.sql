-- =============================================================================
-- 281_creative_velocity.sql
-- Creative suite (package cs1): the two inputs the Velocity area measures.
--
-- Why
--   The Velocity area (owner decisions 2026-10-08, docs/sessions/2026-10-08/
--   creative-velocity-design.md section 9) computes testing capacity from
--   measured inputs, editable on the page. Two of those inputs are not in any
--   mart: how much of the spend goes to new creative, and how much creative is
--   already queued in ClickUp.
--
-- Change
--   NEW VIEW mart.mart_velocity_daily, one row per client and day:
--     spend, purchases (7d click + 1d view where the split exists, otherwise the
--     account default, the same COALESCE the Creative screens use),
--     new_creative_spend = spend on ads in their first 14 days of delivery,
--     new_packs = ad sets whose first day with spend is this day.
--   NEW VIEW mart.mart_velocity_queue, one row per client and bucket:
--     ready     ClickUp `ready to upload`
--     in_works  `brief: approved` up to production (in production, in editing,
--               production QA, trial reel)
--     briefing  `brief: in progress`, `brief: awaiting approval` (shown, not
--               counted as queue)
--     other     every other status (backlog, live, killed): not queue, but it
--               tells a client with a ClickUp board and an empty queue (0) from
--               a client without one (n/a)
--
-- First-day caveat: an ad or ad set already running when the insights history
--   starts gets that start date as its first day. The Velocity screens skip the
--   first month of each client's history for that reason.
--
-- Based on: live/mart.mart_creative_perf.sql, live/stg.stg_clickup_ad_tasks.sql.
-- QA copies: mart_qa.cs1_velocity_daily, mart_qa.cs1_velocity_queue.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_velocity_daily` AS
WITH firsts AS (
  SELECT
    client_id,
    ad_id,
    adset_id,
    MIN(date) OVER (PARTITION BY client_id, ad_id)    AS ad_first,
    MIN(date) OVER (PARTITION BY client_id, adset_id) AS adset_first
  FROM `oneeighty-warehouse.mart.mart_creative_perf`
  WHERE spend > 0
),
ad_starts AS (
  SELECT DISTINCT client_id, ad_id, ad_first FROM firsts
),
adset_starts AS (
  SELECT DISTINCT client_id, adset_id, adset_first FROM firsts
),
days AS (
  SELECT
    p.client_id,
    p.date,
    SUM(p.spend)                                                   AS spend,
    SUM(COALESCE(p.purchases_7dc_1dv, p.purchases))                AS purchases,
    SUM(IF(DATE_DIFF(p.date, f.ad_first, DAY) BETWEEN 0 AND 13, p.spend, 0)) AS new_creative_spend,
    ANY_VALUE(p.currency)                                          AS currency
  FROM `oneeighty-warehouse.mart.mart_creative_perf` p
  LEFT JOIN ad_starts f
    ON f.client_id = p.client_id AND f.ad_id = p.ad_id
  GROUP BY p.client_id, p.date
),
packs AS (
  SELECT client_id, adset_first AS date, COUNT(*) AS new_packs
  FROM adset_starts
  WHERE adset_id IS NOT NULL
  GROUP BY client_id, adset_first
)
SELECT
  d.client_id,
  d.date,
  d.spend,
  d.purchases,
  d.new_creative_spend,
  IFNULL(k.new_packs, 0)                               AS new_packs,
  d.currency,
  MIN(d.date) OVER (PARTITION BY d.client_id)          AS history_start
FROM days d
LEFT JOIN packs k
  ON k.client_id = d.client_id AND k.date = d.date;

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_velocity_queue` AS
WITH tasks AS (
  SELECT
    client_id,
    task_id,
    LOWER(TRIM(REGEXP_REPLACE(IFNULL(status, ''), r'[^\p{L}\p{N}:&() -]', ''))) AS s
  FROM `oneeighty-warehouse.stg.stg_clickup_ad_tasks`
)
SELECT client_id, bucket, COUNT(*) AS tasks
FROM (
  SELECT
    client_id,
    CASE
      WHEN STARTS_WITH(s, 'ready')                                   THEN 'ready'
      WHEN REGEXP_CONTAINS(s, r'brief: ?approved')                   THEN 'in_works'
      WHEN REGEXP_CONTAINS(s, r'production|editing|\bqa\b|trial reel') THEN 'in_works'
      WHEN REGEXP_CONTAINS(s, r'^brief')                             THEN 'briefing'
      ELSE 'other'
    END AS bucket
  FROM tasks
)
GROUP BY client_id, bucket;
