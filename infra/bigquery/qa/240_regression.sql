-- qa/240_regression.sql
-- Regression and sanity checks for 240_paid_meta_marts.sql.
-- Run BEFORE deploy against the mart_qa candidates (names below), and AFTER deploy
-- by swapping `mart_qa.pa1_mart_meta_*` for `mart.mart_meta_*` in the "cand" side
-- and comparing against a pre-deploy snapshot, or by running section 3 and 4 only.
-- Candidates are built from 240 by replacing ref.naming_rules / ref.campaign_overrides /
-- mart.mart_meta_* with mart_qa.pa1_naming_rules / pa1_campaign_overrides / pa1_mart_meta_*.
-- Run read-only (execute_sql_readonly). Results of the 2026-10-04 run are in the PA1 report.

-- 1a. Existing columns, campaign perf: zero diff both directions (all clients, all days).
--     Expected: prod_minus_cand = 0, cand_minus_prod = 0, and equal row counts.
WITH prod AS (
  SELECT TO_JSON_STRING(t) AS j FROM `oneeighty-warehouse.mart.mart_meta_campaign_perf` t
  WHERE t.date < CURRENT_DATE()),
cand AS (
  SELECT TO_JSON_STRING(t) AS j FROM (
    SELECT * EXCEPT (view_content, add_payment_info, funnel_stage, market,
                     spend_client_ccy, revenue_client_ccy, client_currency)
    FROM `oneeighty-warehouse.mart_qa.pa1_mart_meta_campaign_perf`
    WHERE date < CURRENT_DATE()) t)
SELECT
  (SELECT COUNT(*) FROM prod) AS prod_rows,
  (SELECT COUNT(*) FROM cand) AS cand_rows,
  (SELECT COUNT(*) FROM (SELECT j FROM prod EXCEPT DISTINCT SELECT j FROM cand)) AS prod_minus_cand,
  (SELECT COUNT(*) FROM (SELECT j FROM cand EXCEPT DISTINCT SELECT j FROM prod)) AS cand_minus_prod;

-- 1b. Existing columns, ad perf: same test.
WITH prod AS (
  SELECT TO_JSON_STRING(t) AS j FROM `oneeighty-warehouse.mart.mart_meta_ad_perf` t
  WHERE t.date < CURRENT_DATE()),
cand AS (
  SELECT TO_JSON_STRING(t) AS j FROM (
    SELECT * EXCEPT (outbound_clicks, unique_outbound_clicks, video_p25_watched,
                     video_p50_watched, video_p75_watched, video_p95_watched,
                     video_p100_watched, video_30s_watched, view_content, add_payment_info)
    FROM `oneeighty-warehouse.mart_qa.pa1_mart_meta_ad_perf`
    WHERE date < CURRENT_DATE()) t)
SELECT
  (SELECT COUNT(*) FROM prod) AS prod_rows,
  (SELECT COUNT(*) FROM cand) AS cand_rows,
  (SELECT COUNT(*) FROM (SELECT j FROM prod EXCEPT DISTINCT SELECT j FROM cand)) AS prod_minus_cand,
  (SELECT COUNT(*) FROM (SELECT j FROM cand EXCEPT DISTINCT SELECT j FROM prod)) AS cand_minus_prod;

-- 2. Dim grain: one row per (client_id, campaign_id). Expected: 0 duplicate keys.
SELECT COUNT(*) AS dup_keys FROM (
  SELECT client_id, campaign_id
  FROM `oneeighty-warehouse.mart_qa.pa1_mart_meta_campaign_dim`
  GROUP BY 1, 2 HAVING COUNT(*) > 1);

-- 3. Client-currency spend and revenue equal mart_daily_kpis meta_spend / meta_revenue per
--    client and month. Expected: diff 0 wherever FX exists; both NULL where it does not
--    (ref.fx_rates ends 2026-09-01, so Venev 2026-10 is NULL on both sides).
WITH q AS (
  SELECT client_id, DATE_TRUNC(date, MONTH) AS m,
         SUM(spend_client_ccy) AS spend_cc, SUM(revenue_client_ccy) AS rev_cc
  FROM `oneeighty-warehouse.mart_qa.pa1_mart_meta_campaign_perf`
  WHERE date >= '2026-05-01' AND date < CURRENT_DATE()
  GROUP BY 1, 2),
k AS (
  SELECT client_id, DATE_TRUNC(date, MONTH) AS m,
         SUM(meta_spend) AS meta_spend, SUM(meta_revenue) AS meta_rev
  FROM `oneeighty-warehouse.mart.mart_daily_kpis`
  WHERE date >= '2026-05-01' AND date < CURRENT_DATE()
  GROUP BY 1, 2)
SELECT q.client_id, q.m, q.spend_cc, k.meta_spend,
       ROUND(q.spend_cc - k.meta_spend, 4) AS diff_spend,
       ROUND(q.rev_cc - k.meta_rev, 4) AS diff_rev
FROM q LEFT JOIN k USING (client_id, m)
ORDER BY 1, 2;

-- 4. Funnel magnitudes (90 days, per client). Expected: add_to_cart < view_content, and
--    view_content within a factor of about 0.5 to 1.4 of landing_page_views (the pixel and
--    the LPV metric are not the same event, so view_content can sit on either side).
SELECT client_id,
       SUM(link_clicks) AS link_clicks, SUM(landing_page_views) AS lpv,
       SUM(view_content) AS view_content, SUM(add_to_cart) AS atc,
       SUM(initiate_checkout) AS initiate_checkout, SUM(add_payment_info) AS add_payment_info,
       SUM(purchases) AS purchases
FROM `oneeighty-warehouse.mart_qa.pa1_mart_meta_campaign_perf`
WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY) AND date < CURRENT_DATE()
GROUP BY 1 ORDER BY 1;

-- 5. Ad level new columns agree with campaign level (same stg dedupe, same actions JSON).
--    Expected: ad_vc = camp_vc and ad_api = camp_api per client. The eight raw-column fields
--    (outbound, quartiles, 30s) are all NULL until the ingest fills them.
WITH c AS (
  SELECT client_id, SUM(view_content) AS vc, SUM(add_payment_info) AS api
  FROM `oneeighty-warehouse.mart_qa.pa1_mart_meta_campaign_perf`
  WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY) AND date < CURRENT_DATE() GROUP BY 1),
a AS (
  SELECT client_id, SUM(view_content) AS vc, SUM(add_payment_info) AS api,
         COUNTIF(outbound_clicks IS NOT NULL) AS outbound_rows,
         COUNTIF(video_p25_watched IS NOT NULL) AS p25_rows,
         COUNTIF(video_30s_watched IS NOT NULL) AS s30_rows
  FROM `oneeighty-warehouse.mart_qa.pa1_mart_meta_ad_perf`
  WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY) AND date < CURRENT_DATE() GROUP BY 1)
SELECT c.client_id, c.vc AS camp_vc, a.vc AS ad_vc, c.api AS camp_api, a.api AS ad_api,
       a.outbound_rows, a.p25_rows, a.s30_rows
FROM c JOIN a USING (client_id) ORDER BY 1;

-- 6. Classification coverage, 90 days: share of Meta spend per client by funnel_stage and market.
WITH x AS (
  SELECT client_id, funnel_stage, COALESCE(market, '(unknown)') AS market, spend
  FROM `oneeighty-warehouse.mart_qa.pa1_mart_meta_campaign_perf`
  WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY) AND date < CURRENT_DATE()),
tot AS (SELECT client_id, SUM(spend) AS t FROM x GROUP BY 1)
SELECT 'stage' AS dim, x.client_id, funnel_stage AS val, ROUND(SUM(spend)) AS spend,
       ROUND(100 * SUM(spend) / ANY_VALUE(t), 1) AS pct
FROM x JOIN tot USING (client_id) GROUP BY 1, 2, 3
UNION ALL
SELECT 'market', x.client_id, market, ROUND(SUM(spend)), ROUND(100 * SUM(spend) / ANY_VALUE(t), 1)
FROM x JOIN tot USING (client_id) GROUP BY 1, 2, 3
ORDER BY 1, 2, 5 DESC;
