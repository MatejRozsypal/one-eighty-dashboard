-- 278_plan_sync_checks.sql
-- Purpose:   data-entry checks for the plan lists (stg.stg_clickup_plan, migration 277),
--            in exactly the shape of ops.clickup_sync_issues
--            (synced_at, client_id, severity, kind, entity_id, detail).
-- Based on:  live ops.clickup_sync_issues DDL (read 2026-10-06), 277, owner rules in
--            projects/promo-pacing/05-ARCHITEKTURA.md section A and the 2026-10-06 rule
--            "one period = one task" (duplicate_period).
-- Affected:  new view only. Nothing writes to ops.clickup_sync_issues from here.
-- Tested:    the SELECT below against mart_qa.pp3_stg_clickup_plan on 2026-10-06,
--            results in projects/promo-pacing/raw/08-pp3-report.md. Not executed in ops.
-- Deploy:    after 277. Run as is (creates ops.v_clickup_plan_issues).
--            Why a view and not an INSERT in the hourly sync: ref.sp_rebuild_creative_tags
--            re-inserts every open issue on every run, so an hourly sync would append the
--            same plan issue 24 times a day. A view always shows the current state at zero
--            storage. If /health should read one source, it can UNION this view with the
--            latest synced_at of ops.clickup_sync_issues (request to the dashboard package).
--            If the owner prefers the log table, the sync can run
--            INSERT INTO `oneeighty-warehouse.ops.clickup_sync_issues` SELECT * FROM ops.v_clickup_plan_issues
--            once a day (for example only on the 00:45 UTC run).
--
-- Rules (stg_clickup_plan holds only tasks in the latest load, so deleted tasks are already
-- gone; tasks with status `rejected` are ignored):
--   plan_missing_level        error  Level is empty
--   plan_missing_window       error  Start or Due missing, or Due before Start
--   plan_name_mismatch        warn   locked name differs from the one generated from Level + dates
--                                    (Quarter `Q4 2026`, Month `October 2026`,
--                                    Target state `Target state MM/YYYY` from Due),
--                                    or Promo / Checkpoint without the `F<n> · ` / `G<n> · ` prefix
--   promo_missing_mechanic    warn   Promo without Mechanic
--   promo_code_without_codes  error  Mechanic Discount code or Personal credit with empty Coupon codes
--   promo_sku_without_skus    error  Mechanic Bundle, Gift with purchase or Voucher with empty SKUs
--   duplicate_period          error  more than one valid task with the same client, Level
--                                    and Start/Due (Target state, Quarter, Month)
--   plan_overlap              error  two valid Target state / Quarter / Month tasks of one client
--                                    whose windows overlap (same level)
--   promo_overlap_same_key    warn   two valid promos of one client with overlapping windows that
--                                    share a coupon code or SKU (orders cannot be attributed to
--                                    one of them). Plain promo overlaps are by design (F6 runs
--                                    across Black Week) and are not reported.
--   month_sum_mismatch        error  per approved Quarter: the approved Months inside it do not sum
--                                    to the Quarter for revenue, orders, new customers or ad budget
--                                    (tolerance max(1, 0.5 %)), or fewer than 3 Months exist
-- "valid" = stg.is_plan_valid (Target state unless rejected, Quarter/Month only approved,
-- Promo/Checkpoint unless rejected).

CREATE OR REPLACE VIEW `oneeighty-warehouse.ops.v_clickup_plan_issues` AS
WITH p AS (
  SELECT * FROM `oneeighty-warehouse.stg.stg_clickup_plan`
  WHERE IFNULL(status, '') != 'rejected'
),
v AS (SELECT * FROM p WHERE is_plan_valid),
pairs AS (
  SELECT a.client_id, a.level, a.task_id AS a_id, a.name AS a_name, b.task_id AS b_id, b.name AS b_name,
         a.start_date AS a_start, a.end_date AS a_end, b.start_date AS b_start, b.end_date AS b_end,
         a.coupon_codes AS a_codes, b.coupon_codes AS b_codes, a.skus AS a_skus, b.skus AS b_skus
  FROM v a
  JOIN v b
    ON a.client_id = b.client_id AND a.level = b.level AND a.task_id < b.task_id
   AND a.start_date <= b.end_date AND b.start_date <= a.end_date
),
months AS (
  SELECT q.client_id, q.task_id, q.name,
    q.target_revenue AS q_rev, q.target_orders AS q_ord, q.target_new_customers AS q_new, q.ad_budget AS q_bud,
    COUNT(m.task_id)                AS n_months,
    SUM(m.target_revenue)           AS m_rev,
    SUM(m.target_orders)            AS m_ord,
    SUM(m.target_new_customers)     AS m_new,
    SUM(m.ad_budget)                AS m_bud
  FROM v q
  LEFT JOIN v m
    ON m.client_id = q.client_id AND m.level = 'Month'
   AND m.start_date BETWEEN q.start_date AND q.end_date
  WHERE q.level = 'Quarter'
  GROUP BY q.client_id, q.task_id, q.name, q.target_revenue, q.target_orders, q.target_new_customers, q.ad_budget
)
SELECT CURRENT_TIMESTAMP() AS synced_at, client_id, 'error' AS severity, 'plan_missing_level' AS kind,
       task_id AS entity_id,
       CONCAT('Plan task "', name, '" has no Level. Set Target state, Quarter, Month, Promo or Checkpoint.') AS detail
FROM p WHERE level IS NULL

UNION ALL
SELECT CURRENT_TIMESTAMP(), client_id, 'error', 'plan_missing_window', task_id,
       CONCAT(level, ' "', name, '" ',
              CASE WHEN start_date IS NULL OR end_date IS NULL THEN 'is missing Start or Due date.'
                   ELSE CONCAT('ends (', CAST(end_date AS STRING), ') before it starts (', CAST(start_date AS STRING), ').') END)
FROM p
WHERE level IS NOT NULL AND (start_date IS NULL OR end_date IS NULL OR end_date < start_date)

UNION ALL
SELECT CURRENT_TIMESTAMP(), client_id, 'warn', 'plan_name_mismatch', task_id,
       IF(expected_name IS NOT NULL,
          CONCAT(level, ' task is named "', name, '" but its dates say "', expected_name, '". Rename it or fix the dates.'),
          CONCAT(level, ' "', name, '" does not start with ', IF(level = 'Promo', '"F<number> · "', '"G<number> · "'), '.'))
FROM p WHERE name_ok = FALSE

UNION ALL
SELECT CURRENT_TIMESTAMP(), client_id, 'warn', 'promo_missing_mechanic', task_id,
       CONCAT('Promo "', name, '" has no Mechanic.')
FROM p WHERE level = 'Promo' AND mechanic IS NULL

UNION ALL
SELECT CURRENT_TIMESTAMP(), client_id, 'error', 'promo_code_without_codes', task_id,
       CONCAT('Promo "', name, '" uses Mechanic ', mechanic, ' but Coupon codes is empty, so no order can be matched by code.')
FROM p WHERE level = 'Promo' AND mechanic IN ('Discount code', 'Personal credit') AND ARRAY_LENGTH(coupon_codes) = 0

UNION ALL
SELECT CURRENT_TIMESTAMP(), client_id, 'error', 'promo_sku_without_skus', task_id,
       CONCAT('Promo "', name, '" uses Mechanic ', mechanic, ' but SKUs is empty, so no order can be matched by product.')
FROM p WHERE level = 'Promo' AND mechanic IN ('Bundle', 'Gift with purchase', 'Voucher') AND ARRAY_LENGTH(skus) = 0

UNION ALL
SELECT CURRENT_TIMESTAMP(), client_id, 'error', 'duplicate_period', ANY_VALUE(task_id),
       CONCAT(CAST(COUNT(*) AS STRING), ' ', level, ' tasks share the period ',
              CAST(start_date AS STRING), ' to ', CAST(end_date AS STRING), ' (',
              STRING_AGG(CONCAT('"', name, '" ', task_id), ', ' ORDER BY task_id),
              '). One period = one task: reject or delete the extra ones.')
FROM p
WHERE level IN ('Target state', 'Quarter', 'Month')
GROUP BY client_id, level, start_date, end_date
HAVING COUNT(*) > 1

UNION ALL
SELECT CURRENT_TIMESTAMP(), client_id, 'error', 'plan_overlap', a_id,
       CONCAT(level, ' "', a_name, '" (', CAST(a_start AS STRING), ' to ', CAST(a_end AS STRING),
              ') overlaps ', level, ' "', b_name, '" (', CAST(b_start AS STRING), ' to ', CAST(b_end AS STRING), ').')
FROM pairs
WHERE level IN ('Target state', 'Quarter', 'Month')
  AND NOT (a_start = b_start AND a_end = b_end)   -- identical windows are reported as duplicate_period

UNION ALL
SELECT CURRENT_TIMESTAMP(), client_id, 'warn', 'promo_overlap_same_key', a_id,
       CONCAT('Promos "', a_name, '" and "', b_name, '" overlap (',
              CAST(GREATEST(a_start, b_start) AS STRING), ' to ', CAST(LEAST(a_end, b_end) AS STRING),
              ') and share ',
              ARRAY_TO_STRING(ARRAY(
                SELECT x FROM UNNEST(ARRAY_CONCAT(
                  ARRAY(SELECT CONCAT('code ', c) FROM UNNEST(a_codes) c WHERE c IN UNNEST(b_codes)),
                  ARRAY(SELECT CONCAT('SKU ', s) FROM UNNEST(a_skus) s WHERE s IN UNNEST(b_skus)))) x), ', '),
              '. Orders in the overlap cannot be attributed to one promo.')
FROM pairs
WHERE level = 'Promo'
  AND (EXISTS (SELECT 1 FROM UNNEST(a_codes) c WHERE c IN UNNEST(b_codes))
    OR EXISTS (SELECT 1 FROM UNNEST(a_skus)  s WHERE s IN UNNEST(b_skus)))

UNION ALL
SELECT CURRENT_TIMESTAMP(), client_id, 'error', 'month_sum_mismatch', task_id,
       CONCAT('Quarter "', name, '": ',
         IF(n_months < 3, CONCAT('only ', CAST(n_months AS STRING), ' approved Month task(s) inside it. '), ''),
         ARRAY_TO_STRING(ARRAY(
           SELECT CONCAT(metric, ' months ', CAST(m AS STRING), ' vs quarter ', CAST(q AS STRING))
           FROM UNNEST([
             STRUCT('revenue' AS metric, m_rev AS m, q_rev AS q),
             STRUCT('orders', m_ord, q_ord),
             STRUCT('new customers', m_new, q_new),
             STRUCT('ad budget', m_bud, q_bud)])
           WHERE q IS NOT NULL AND m IS NOT NULL
             AND ABS(m - q) > GREATEST(1, 0.005 * ABS(q))), '; '))
FROM months
WHERE n_months < 3
   OR (q_rev IS NOT NULL AND m_rev IS NOT NULL AND ABS(m_rev - q_rev) > GREATEST(1, 0.005 * ABS(q_rev)))
   OR (q_ord IS NOT NULL AND m_ord IS NOT NULL AND ABS(m_ord - q_ord) > GREATEST(1, 0.005 * ABS(q_ord)))
   OR (q_new IS NOT NULL AND m_new IS NOT NULL AND ABS(m_new - q_new) > GREATEST(1, 0.005 * ABS(q_new)))
   OR (q_bud IS NOT NULL AND m_bud IS NOT NULL AND ABS(m_bud - q_bud) > GREATEST(1, 0.005 * ABS(q_bud)));
