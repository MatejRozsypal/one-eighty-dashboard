-- =============================================================================
-- 283_plan_status_lifecycle.sql
-- Plan layer: a task stays valid after approval (running, complete), and
-- "ready for review" is a draft like "planning".
--
-- Why
--   plan_input_v set is_valid = status IN ('approved', 'done'). The ClickUp
--   plan lists move a task on after approval: approved -> running -> complete.
--   So every promo that had started or finished dropped out of the plan:
--   Manami had 27 promos in plan_input and 0 in plan_pacing (11 complete,
--   3 running, 13 ready for review), and Ethia lost its running promo
--   (F1 Startovaci duo) and its running checkpoint. Found 2026-10-13 from the
--   owner's report "promos don't work for Manami" (Goals > Promo: no data).
--
-- Change
--   1. plan_input_v: is_valid and the "original version" pick accept
--      approved, done, running, complete.
--   2. plan_pacing_v: a promo is listed when valid OR a draft, and a draft is
--      'planning' or 'ready for review' (drafts are shown, never counted in
--      the target curve: plan_targets_daily_v still reads is_valid only).
--
-- How
--   Both views are patched from their deployed definitions with REPLACE, and
--   each ASSERT proves the replaced line exists exactly once, so this file
--   cannot silently do nothing or patch the wrong place. Then the snapshot
--   tables are rebuilt (see the migration trap in 279j: the next view reads
--   the snapshot, not the view).
--
-- Run outside the hourly ClickUp sync window (:45 to :50 UTC), which calls
-- mart.sp_refresh_plan_pacing.
-- QA copies: mart_qa.pp5_plan_input, mart_qa.pp5_plan_pacing_v.
-- =============================================================================

DECLARE input_def STRING DEFAULT (
  SELECT view_definition FROM `oneeighty-warehouse.mart.INFORMATION_SCHEMA.VIEWS`
  WHERE table_name = 'plan_input_v');
DECLARE pacing_def STRING DEFAULT (
  SELECT view_definition FROM `oneeighty-warehouse.mart.INFORMATION_SCHEMA.VIEWS`
  WHERE table_name = 'plan_pacing_v');

DECLARE old_valid STRING DEFAULT "c.status IN ('approved', 'done'))";
DECLARE new_valid STRING DEFAULT "c.status IN ('approved', 'done', 'running', 'complete'))";
DECLARE old_orig  STRING DEFAULT "IF(version_status IN ('approved', 'done'), 0, 1)";
DECLARE new_orig  STRING DEFAULT "IF(version_status IN ('approved', 'done', 'running', 'complete'), 0, 1)";
DECLARE old_promo STRING DEFAULT "level = 'Promo' AND (is_valid OR status = 'planning')";
DECLARE new_promo STRING DEFAULT "level = 'Promo' AND (is_valid OR status IN ('planning', 'ready for review'))";

ASSERT ARRAY_LENGTH(SPLIT(input_def, old_valid)) = 2 AS '283: plan_input_v is_valid line not found exactly once';
ASSERT ARRAY_LENGTH(SPLIT(input_def, old_orig)) = 2 AS '283: plan_input_v rn_orig line not found exactly once';
ASSERT ARRAY_LENGTH(SPLIT(pacing_def, old_promo)) = 2 AS '283: plan_pacing_v promo filter not found exactly once';

EXECUTE IMMEDIATE 'CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_input_v` AS '
  || REPLACE(REPLACE(input_def, old_valid, new_valid), old_orig, new_orig);
EXECUTE IMMEDIATE 'CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_pacing_v` AS '
  || REPLACE(pacing_def, old_promo, new_promo);

-- Rebuild the snapshots from the patched views (input, actuals, targets,
-- pacing, promo orders, promo perf), the same call the hourly sync makes.
CALL `oneeighty-warehouse.mart.sp_refresh_plan_pacing`();
