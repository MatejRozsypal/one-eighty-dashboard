-- =============================================================================
-- qa/256_regression.sql
-- Regression, acceptance and measurement for 256_meta_attribution_windows.sql (ME2).
-- Sections A, B, E were run 2026-10-05 in mart_qa (prefix me2_). Results under each check.
-- Sections C and D run after the stage 2 deploy and the backfill (runbooks/32_meta_attribution.md).
--
-- Candidates (mart_qa, prefix me2_), built from 256 with this name mapping:
--   raw.raw_meta_ad_attribution_windows   -> mart_qa.me2_raw_meta_ad_attribution_windows (empty)
--   stg.stg_meta_ad_attribution_windows   -> mart_qa.me2_stg_meta_ad_attribution_windows
--   mart.mart_meta_ad_perf                -> mart_qa.me2_mart_meta_ad_perf
--   mart.mart_creative_perf               -> mart_qa.me2_mart_creative_perf
--   mart.sp_refresh_rpt_ad_launch         -> mart_qa.me2_sp_refresh_rpt_ad_launch
--   mart.rpt_ad_launch                    -> mart_qa.me2_rpt_ad_launch
--   `oneeighty-warehouse.mart`.__TABLES__ -> `oneeighty-warehouse.mart_qa`.__TABLES__,
--   table_id = 'rpt_ad_launch'            -> 'me2_rpt_ad_launch'
-- Baseline for B: mart_qa.me2base_sp_refresh_rpt_ad_launch, the live 255 SELECT (no checks,
-- no swap) writing mart_qa.me2base_rpt_ad_launch from the prod view.
-- Candidate view text check: MD5 of INFORMATION_SCHEMA.VIEWS.view_definition of the three
-- mart_qa views equals the MD5 of the mapped file text (fa518a92..., 259c770e..., 1b1d869a...).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A1. mart_meta_ad_perf: existing columns unchanged. Expect 0, 0 and equal row counts.
-- -----------------------------------------------------------------------------
WITH prod AS (
  SELECT TO_JSON_STRING(t) j FROM `oneeighty-warehouse.mart.mart_meta_ad_perf` t WHERE date < CURRENT_DATE()
), cand AS (
  SELECT TO_JSON_STRING(t) j FROM (
    SELECT * EXCEPT(attribution_windows, purchases_7d_click, revenue_7d_click, purchases_1d_view, revenue_1d_view, purchases_1d_ev, revenue_1d_ev, purchases_7dc_1dv, revenue_7dc_1dv)
    FROM `oneeighty-warehouse.mart_qa.me2_mart_meta_ad_perf` WHERE date < CURRENT_DATE()) t
)
SELECT 'prod_minus_cand' k, COUNT(*) n FROM (SELECT j FROM prod EXCEPT DISTINCT SELECT j FROM cand)
UNION ALL SELECT 'cand_minus_prod', COUNT(*) FROM (SELECT j FROM cand EXCEPT DISTINCT SELECT j FROM prod)
UNION ALL SELECT 'prod_rows', COUNT(*) FROM prod
UNION ALL SELECT 'cand_rows', COUNT(*) FROM cand;
-- Result 2026-10-05: prod_minus_cand 0, cand_minus_prod 0, rows 12,631 = 12,631. 1.98 GB billed.

-- -----------------------------------------------------------------------------
-- A2. mart_creative_perf: existing columns unchanged. Same query with mart_creative_perf.
-- -----------------------------------------------------------------------------
WITH prod AS (
  SELECT TO_JSON_STRING(t) j FROM `oneeighty-warehouse.mart.mart_creative_perf` t WHERE date < CURRENT_DATE()
), cand AS (
  SELECT TO_JSON_STRING(t) j FROM (
    SELECT * EXCEPT(attribution_windows, purchases_7d_click, revenue_7d_click, purchases_1d_view, revenue_1d_view, purchases_1d_ev, revenue_1d_ev, purchases_7dc_1dv, revenue_7dc_1dv)
    FROM `oneeighty-warehouse.mart_qa.me2_mart_creative_perf` WHERE date < CURRENT_DATE()) t
)
SELECT 'prod_minus_cand' k, COUNT(*) n FROM (SELECT j FROM prod EXCEPT DISTINCT SELECT j FROM cand)
UNION ALL SELECT 'cand_minus_prod', COUNT(*) FROM (SELECT j FROM cand EXCEPT DISTINCT SELECT j FROM prod)
UNION ALL SELECT 'prod_rows', COUNT(*) FROM prod
UNION ALL SELECT 'cand_rows', COUNT(*) FROM cand;
-- Result 2026-10-05: 0, 0, rows 12,631 = 12,631. 0.45 GB billed.

-- -----------------------------------------------------------------------------
-- B1. rpt_ad_launch: the 31 existing columns equal the live 255 logic built in the same
--     script (CALL me2base_...; CALL me2_...;). Expect 0, 0, 459 rows, 44 columns (41 before the
--     standard-basis columns were added on 2026-10-05).
-- -----------------------------------------------------------------------------
WITH base AS (SELECT TO_JSON_STRING(t) j FROM (SELECT * EXCEPT(refreshed_at) FROM `oneeighty-warehouse.mart_qa.me2base_rpt_ad_launch`) t),
cand AS (SELECT TO_JSON_STRING(t) j FROM (SELECT * EXCEPT(refreshed_at, attribution_split_days, attribution_split_complete,
  purchases_7d_click, revenue_7d_click, purchases_1d_view, revenue_1d_view, purchases_1d_ev, revenue_1d_ev,
  prior_roas_7d_click, prior_split_coverage, purchases_7dc_1dv, revenue_7dc_1dv, prior_roas_7dc_1dv) FROM `oneeighty-warehouse.mart_qa.me2_rpt_ad_launch`) t)
SELECT 'base_minus_cand' k, COUNT(*) n FROM (SELECT j FROM base EXCEPT DISTINCT SELECT j FROM cand)
UNION ALL SELECT 'cand_minus_base', COUNT(*) FROM (SELECT j FROM cand EXCEPT DISTINCT SELECT j FROM base)
UNION ALL SELECT 'base_rows', COUNT(*) FROM base
UNION ALL SELECT 'cand_rows', COUNT(*) FROM cand
UNION ALL SELECT 'cand_cols', (SELECT COUNT(*) FROM `oneeighty-warehouse.mart_qa`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'me2_rpt_ad_launch')
UNION ALL SELECT 'cand_split_complete_true', (SELECT COUNTIF(attribution_split_complete) FROM `oneeighty-warehouse.mart_qa.me2_rpt_ad_launch`);
-- Result 2026-10-05: 0, 0, 459 = 459, 41 columns, 0 ads with a complete split (no split ingested
-- yet: every new column NULL or 0, as intended). Both CALLs together: 0.61 GB billed.

-- -----------------------------------------------------------------------------
-- B2. Plumbing test with SYNTHETIC split rows (deleted after the test).
--     Inserted into mart_qa.me2_raw_meta_ad_attribution_windows, for every Manami ad-day of
--     stg_meta_ad_insights: one row at 12:00 with 7d_click = legacy purchases / value and
--     1d_view = 1d_ev = 0, plus one stale row at 11:00 with 999 / 999999 (must lose in stg).
--     Then CALL mart_qa.me2_sp_refresh_rpt_ad_launch().
-- -----------------------------------------------------------------------------
SELECT client_id, COUNT(*) ads,
  COUNTIF(attribution_split_complete) complete,
  COUNTIF(purchases_7d_click IS DISTINCT FROM purchases) p7_ne_p,
  COUNTIF(revenue_7d_click IS DISTINCT FROM revenue) r7_ne_r,
  ANY_VALUE(prior_roas) prior, ANY_VALUE(prior_roas_7d_click) prior7, ANY_VALUE(prior_split_coverage) cov
FROM `oneeighty-warehouse.mart_qa.me2_rpt_ad_launch` GROUP BY 1 ORDER BY 1;
-- Result 2026-10-05: manami 200 ads, 200 complete, p7_ne_p 0, r7_ne_r 0,
--   prior_roas_7d_click = prior_roas = 2.02871613, coverage 1 (stale row ignored).
--   dobias 64 / ethia 179 / venev 16: 0 complete, split columns NULL, prior_roas_7d_click NULL,
--   coverage 0. Synthetic rows deleted afterwards (ingest_source LIKE 'synthetic_me2_test%').

-- -----------------------------------------------------------------------------
-- C. AFTER DEPLOY: reconciliation of the split with the legacy columns, per ad set setting.
--    Needs the ad set settings: mart_qa.me2_adset_attribution (pulled 2026-10-05 from the
--    Meta Ads MCP, expires 2026-11-05; re-pull for ad sets created later).
--    Identity measured 2026-10-05: legacy = 7d_click (+ 1d_view if the ad set has a view window),
--    1d_ev is never in the legacy figure. Expect mismatch_days near 0 for days older than 2 days
--    (the newest days can differ by the minutes between the two requests).
-- -----------------------------------------------------------------------------
WITH j AS (
  SELECT m.client_id, m.date, a.attribution_setting AS s,
    IFNULL(m.purchases, 0) AS p_legacy, IFNULL(m.revenue, 0) AS v_legacy,
    IFNULL(m.purchases_7d_click, 0) AS p7, IFNULL(m.purchases_1d_view, 0) AS p1v, IFNULL(m.purchases_1d_ev, 0) AS pev,
    IFNULL(m.revenue_7d_click, 0) AS v7, IFNULL(m.revenue_1d_view, 0) AS v1v, IFNULL(m.revenue_1d_ev, 0) AS vev
  FROM `oneeighty-warehouse.mart.mart_meta_ad_perf` m
  JOIN `oneeighty-warehouse.mart_qa.me2_adset_attribution` a USING (client_id, adset_id)
  WHERE m.date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY)
    AND m.attribution_windows IS NOT NULL
)
SELECT client_id, s, COUNT(*) AS ad_days,
  -- legacy = 7d_click (+ 1d_view when the ad set has a view window); 1d_ev is never in legacy
  COUNTIF(p_legacy != p7 + IF(s LIKE '%1d_view%', p1v, 0)) AS mismatch_days,
  SUM(p_legacy) AS p_legacy,
  SUM(p7 + IF(s LIKE '%1d_view%', p1v, 0)) AS p_rebuilt,
  ROUND(SUM(v_legacy), 2) AS v_legacy,
  ROUND(SUM(v7 + IF(s LIKE '%1d_view%', v1v, 0)), 2) AS v_rebuilt
FROM j GROUP BY 1, 2 ORDER BY 1, 2;

-- C2. Coverage: delivery days without the split, per client (expect 0 after the backfill).
SELECT client_id,
  COUNTIF(impressions > 0) AS delivery_days,
  COUNTIF(impressions > 0 AND attribution_windows IS NULL) AS days_without_split,
  MIN(IF(impressions > 0 AND attribution_windows IS NULL, date, NULL)) AS first_gap,
  MAX(IF(impressions > 0 AND attribution_windows IS NULL, date, NULL)) AS last_gap
FROM `oneeighty-warehouse.mart.mart_meta_ad_perf`
WHERE date < CURRENT_DATE()
GROUP BY 1 ORDER BY 1;

-- -----------------------------------------------------------------------------
-- D. AFTER BACKFILL: the measurement (owner decision D3 as amended 2026-10-05: standard
--    decision basis = 7d_click + 1d_view; 1d_ev stored, excluded). Run on prod names, or on
--    mart_qa.me2_* candidates that read the prod stg view before the mart views are deployed.
-- D1. Share of purchases and value by window, last 90 complete days and lifetime.
-- -----------------------------------------------------------------------------
SELECT client_id, IF(date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY), 'last_90d', 'older') AS period,
  SUM(purchases) AS p_legacy,
  SUM(purchases_7d_click) AS p_7d_click, SUM(purchases_1d_view) AS p_1d_view, SUM(purchases_1d_ev) AS p_1d_ev,
  ROUND(SAFE_DIVIDE(SUM(purchases_7d_click), SUM(purchases_7d_click + purchases_1d_view + purchases_1d_ev)), 3) AS share_p_7d_click,
  ROUND(SAFE_DIVIDE(SUM(purchases_1d_view),  SUM(purchases_7d_click + purchases_1d_view + purchases_1d_ev)), 3) AS share_p_1d_view,
  ROUND(SAFE_DIVIDE(SUM(purchases_1d_ev),    SUM(purchases_7d_click + purchases_1d_view + purchases_1d_ev)), 3) AS share_p_1d_ev,
  ROUND(SAFE_DIVIDE(SUM(revenue_7d_click), SUM(revenue_7d_click + revenue_1d_view + revenue_1d_ev)), 3) AS share_v_7d_click,
  ROUND(SAFE_DIVIDE(SUM(revenue_1d_view),  SUM(revenue_7d_click + revenue_1d_view + revenue_1d_ev)), 3) AS share_v_1d_view,
  ROUND(SAFE_DIVIDE(SUM(revenue_1d_ev),    SUM(revenue_7d_click + revenue_1d_view + revenue_1d_ev)), 3) AS share_v_1d_ev,
  ROUND(SAFE_DIVIDE(SUM(revenue), SUM(spend)), 3) AS roas_legacy,
  ROUND(SAFE_DIVIDE(SUM(revenue_7dc_1dv), SUM(spend)), 3) AS roas_7dc_1dv,
  ROUND(SAFE_DIVIDE(SUM(revenue_7d_click), SUM(spend)), 3) AS roas_7d_click,
  COUNTIF(impressions > 0 AND attribution_windows IS NULL) AS days_without_split
FROM `oneeighty-warehouse.mart.mart_meta_ad_perf`
WHERE client_id IN ('dobias', 'ethia', 'manami', 'venev') AND date < CURRENT_DATE()
GROUP BY 1, 2 ORDER BY 1, 2;

-- D2. Dashboard winners (purchases >= N and shrunk ROAS >= target, shrinkage weight N) on
--     (i) the current mixed per-ad-set numbers with the stored prior, vs (ii) the standard basis
--     7d_click + 1d_view with the stored prior and with the prior on the same basis.
--     Thresholds as in Settings 2026-10-05.
WITH thr AS (
  SELECT * FROM UNNEST([STRUCT('dobias' AS client_id, 3.00 AS tgt, 25 AS n),
                        ('ethia', 2.50, 10), ('manami', 2.25, 15), ('venev', 2.10, 10)])
),
r AS (
  SELECT r.*, t.tgt, t.n,
    r.purchases >= t.n
      AND SAFE_DIVIDE(r.purchases * SAFE_DIVIDE(r.revenue, r.spend) + t.n * r.prior_roas, r.purchases + t.n) >= t.tgt AS win_mixed,
    r.purchases_7dc_1dv >= t.n
      AND SAFE_DIVIDE(r.purchases_7dc_1dv * SAFE_DIVIDE(r.revenue_7dc_1dv, r.spend) + t.n * r.prior_roas, r.purchases_7dc_1dv + t.n) >= t.tgt AS win_std_stored_prior,
    r.purchases_7dc_1dv >= t.n
      AND SAFE_DIVIDE(r.purchases_7dc_1dv * SAFE_DIVIDE(r.revenue_7dc_1dv, r.spend) + t.n * r.prior_roas_7dc_1dv, r.purchases_7dc_1dv + t.n) >= t.tgt AS win_std_own_prior
  FROM `oneeighty-warehouse.mart.rpt_ad_launch` r JOIN thr t USING (client_id)
)
SELECT client_id,
  COUNTIF(win_mixed) AS winners_mixed,
  COUNTIF(win_std_stored_prior) AS winners_std_stored_prior,
  COUNTIF(win_mixed AND NOT IFNULL(win_std_stored_prior, FALSE)) AS lost_std_stored_prior,
  COUNTIF(NOT IFNULL(win_mixed, FALSE) AND win_std_stored_prior) AS gained_std_stored_prior,
  COUNTIF(win_std_own_prior) AS winners_std_own_prior,
  COUNTIF(win_mixed AND NOT IFNULL(win_std_own_prior, FALSE)) AS lost_std_own_prior,
  COUNTIF(NOT IFNULL(win_mixed, FALSE) AND win_std_own_prior) AS gained_std_own_prior,
  COUNTIF(NOT attribution_split_complete) AS ads_without_complete_split,
  ANY_VALUE(prior_roas) AS prior_roas, ANY_VALUE(prior_roas_7dc_1dv) AS prior_roas_7dc_1dv,
  ANY_VALUE(prior_roas_7d_click) AS prior_roas_7d_click, ANY_VALUE(prior_split_coverage) AS prior_split_coverage
FROM r GROUP BY 1 ORDER BY 1;

-- D3. The ads whose status differs between (i) and (ii), for the owner.
WITH thr AS (
  SELECT * FROM UNNEST([STRUCT('dobias' AS client_id, 3.00 AS tgt, 25 AS n),
                        ('ethia', 2.50, 10), ('manami', 2.25, 15), ('venev', 2.10, 10)])
),
r AS (
  SELECT r.client_id, r.ad_name, r.first_date, r.purchases, r.purchases_7dc_1dv, r.purchases_1d_ev,
    ROUND(SAFE_DIVIDE(r.revenue, r.spend), 2) AS roas_mixed, ROUND(SAFE_DIVIDE(r.revenue_7dc_1dv, r.spend), 2) AS roas_std,
    r.purchases >= t.n
      AND SAFE_DIVIDE(r.purchases * SAFE_DIVIDE(r.revenue, r.spend) + t.n * r.prior_roas, r.purchases + t.n) >= t.tgt AS win_mixed,
    r.purchases_7dc_1dv >= t.n
      AND SAFE_DIVIDE(r.purchases_7dc_1dv * SAFE_DIVIDE(r.revenue_7dc_1dv, r.spend) + t.n * r.prior_roas, r.purchases_7dc_1dv + t.n) >= t.tgt AS win_std_stored_prior,
    r.purchases_7dc_1dv >= t.n
      AND SAFE_DIVIDE(r.purchases_7dc_1dv * SAFE_DIVIDE(r.revenue_7dc_1dv, r.spend) + t.n * r.prior_roas_7dc_1dv, r.purchases_7dc_1dv + t.n) >= t.tgt AS win_std_own_prior
  FROM `oneeighty-warehouse.mart.rpt_ad_launch` r JOIN thr t USING (client_id)
)
SELECT * FROM r
WHERE IFNULL(win_mixed, FALSE) != IFNULL(win_std_stored_prior, FALSE)
   OR IFNULL(win_mixed, FALSE) != IFNULL(win_std_own_prior, FALSE)
ORDER BY client_id, ad_name;

-- -----------------------------------------------------------------------------
-- E. Stage 1 sensitivity (run 2026-10-05, before any split exists).
--    mart_qa.me2_adset_attribution: ad set attribution_setting per ad set (Meta Ads MCP).
--    mart_qa.me2_ad_daily_90d:      warehouse ad-days with the ad set setting attached.
--    mart_qa.me2_winner_sensitivity: per ad, lifetime purchases split by ad set setting and the
--      winner status if a share f of the purchases and value in view-window ad sets were
--      view or engaged-view conversions (stored prior kept). flip_at_f = smallest f that
--      removes the winner.
-- -----------------------------------------------------------------------------
SELECT client_id, COUNTIF(winner_now) winners_now,
  COUNTIF(winner_now AND view_set_share = 0) winners_only_in_7d_click_ad_sets,
  COUNTIF(winner_f10) at_f10, COUNTIF(winner_f20) at_f20, COUNTIF(winner_f30) at_f30, COUNTIF(winner_f50) at_f50
FROM `oneeighty-warehouse.mart_qa.me2_winner_sensitivity` GROUP BY 1 ORDER BY 1;
-- Result 2026-10-05:
--   client  winners  only-7d-click-sets  f=10%  f=20%  f=30%  f=50%
--   dobias        9                   0      7      6      3      0
--   ethia         8                   0      4      3      2      0
--   manami       15                   2     13      9      5      2
--   venev         0                   0      0      0      0      0
--   total        32                   2     24     18     10      2
