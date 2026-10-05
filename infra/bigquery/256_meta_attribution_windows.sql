-- =============================================================================
-- 256_meta_attribution_windows.sql
-- Meta purchases and purchase value per attribution window (7-day click, 1-day view,
-- 1-day engaged view) next to the existing columns, from raw to mart.rpt_ad_launch.
-- Package ME2 of the Meta engine audit follow-up (03_audit.md change C2, owner decision D3 as
-- amended 2026-10-05: store 7d_click, 1d_view and 1d_ev per row; the STANDARD decision basis is
-- 7d_click + 1d_view, 1d_ev is stored but excluded; the label states the truth).
--
-- STATUS: DEPLOYED 2026-10-05 (owner approved stage 2: deploy and measure; no dashboard switch).
--   ~11:13 UTC statements 1 and 2 (raw table, stg view)
--   11:14-11:27 backfill, n8n ByGJ1fZkgEAj0EPm executions 24948 (venev) and 24951 (dobias, ethia,
--               manami): 12,634 ad-days, every delivery day since each client's first ad-insights day
--               (dobias 2026-04-20, ethia 2025-02-20, manami 2025-05-07, venev 2026-08-18)
--   ~11:31 statements 3 and 4 (mart views; live MD5 = file), ~11:32 statement 5 + CALL (44 columns)
--   11:33 live n8n workflow AnfdTVrS83ioPsd3 version 6fbc5931 published (windows branch)
-- Deploy log and measurement in runbooks/32_meta_attribution.md and the ME2 report.
--
-- Problem
--   The ad ingest (n8n wf_meta_ads_to_bigquery, id AnfdTVrS83ioPsd3) requests no attribution
--   window. Since Meta made unified attribution mandatory in the Insights API (2025), a request
--   without action_attribution_windows returns every ad set on its OWN attribution setting.
--   Verified 2026-10-05: Meta Ads MCP (which reports per ad set setting) and
--   stg.stg_meta_ad_insights agree to the cent on all 17 Manami ad sets for 2026-07-07..10-04,
--   including the 7d_click-only ad sets and the 1d_view_7d_click_1d_ev ones. The warehouse
--   therefore mixes three windows inside one account:
--     7d_click | 1d_view_7d_click | 1d_view_7d_click_1d_ev (engaged view)
--   Share of 90-day purchases sitting in ad sets with a view window: Dobias 94 %, Ethia 100 %,
--   Manami 69 %, Venev 100 % (mart_qa.me2_ad_daily_90d). The dashboard label "7-day click"
--   is not true for those rows.
--
-- Change (additive; no existing column, table or view loses or changes a value)
--   1. NEW TABLE  raw.raw_meta_ad_attribution_windows. Written by a NEW branch of the n8n
--                 workflow (fetch with action_attribution_windows=["7d_click","1d_view","1d_ev"]).
--                 A separate table, not new columns on raw.raw_meta_ad_insights, so that:
--                   * the existing ad insert (autoMapInputData) is not touched: a schema
--                     mismatch there would make the BigQuery node fail and, with
--                     onError=continueRegularOutput, silently drop all ad rows;
--                   * a backfill of the windows does not re-write the legacy rows of old days;
--                   * rollback is "stop writing, drop the join".
--                 Grain: one row per (client_id, ad_id, date_start, ingested_at); append-only
--                 like the legacy table, the stg view keeps the latest ingest.
--   2. NEW VIEW   stg.stg_meta_ad_attribution_windows (latest ingest per client, ad, day).
--   3. VIEW       mart.mart_meta_ad_perf: LEFT JOIN of (2), 9 columns appended at the end:
--                   attribution_windows   '7d_click,1d_view,1d_ev' when the split was ingested
--                                         for that ad-day, NULL when it was not (legacy days
--                                         before the backfill, or a failed windows fetch)
--                   purchases_7d_click, revenue_7d_click
--                   purchases_1d_view,  revenue_1d_view
--                   purchases_1d_ev,    revenue_1d_ev
--                   purchases_7dc_1dv,  revenue_7dc_1dv   standard basis = 7d_click + 1d_view
--                 NULL purchases with attribution_windows set means no purchase action that
--                 day, the same convention as the legacy `purchases`.
--   4. VIEW       mart.mart_creative_perf: the same 9 columns appended after `currency`.
--   5. PROCEDURE  mart.sp_refresh_rpt_ad_launch: 13 columns appended to mart.rpt_ad_launch
--                 (after is_new_adset, so 44 columns):
--                   attribution_split_days      delivery days (impressions > 0) with the split
--                   attribution_split_complete  split_days = active_days. Only then is a
--                                               lifetime 7-day click figure complete.
--                   purchases_7d_click, revenue_7d_click, purchases_1d_view, revenue_1d_view,
--                   purchases_1d_ev, revenue_1d_ev
--                                               lifetime sums; NULL unless split complete
--                                               (a partial lifetime would read as a worse ad)
--                   prior_roas_7d_click         client 7-day click ROAS of the same trailing
--                                               365 days as prior_roas; NULL unless every
--                                               delivery day of the window has the split
--                   prior_split_coverage        share of that 365-day spend with the split
--                   purchases_7dc_1dv, revenue_7dc_1dv, prior_roas_7dc_1dv
--                                               the same on the standard basis (7d_click + 1d_view)
--                 Existing 31 columns, ASSERTs, swap and scheduler unchanged.
--   Legacy columns (purchases, revenue, purchase_value, prior_roas ...) keep the ad set setting
--   semantics ("as reported in Ads Manager"). Nothing switches automatically: if the owner
--   decides so after the measurement, the dashboard (ME3) moves the winner test to
--   purchases_7dc_1dv / revenue_7dc_1dv / prior_roas_7dc_1dv where attribution_split_complete.
--
-- Reconciliation identity (used by qa/256_regression.sql section C), MEASURED 2026-10-05 on the
-- backfill: the no-window API response counts 7d_click and, when the ad set has a view window,
-- 1d_view. It never counts 1d_ev, even for ad sets whose setting includes engaged view:
--     7d_click                 -> purchases = 7d_click
--     1d_view_7d_click         -> purchases = 7d_click + 1d_view
--     1d_view_7d_click_1d_ev   -> purchases = 7d_click + 1d_view      (1d_ev NOT included)
--   So the standard basis (7d_click + 1d_view) differs from the legacy columns only on ad sets
--   set to 7d_click only, where it adds their 1-day view purchases.
--
-- Based on (live text, read 2026-10-05 from INFORMATION_SCHEMA):
--   live/mart.mart_meta_ad_perf.sql, live/mart.mart_creative_perf.sql (both equal to live),
--   mart.sp_refresh_rpt_ad_launch as deployed by 255 (ROUTINES.routine_definition, last_altered
--   2026-10-05; the live/ mirror on this branch still holds 254, see the ME1 branch for 255).
--   If 255 is redeployed or changed before 256, rebase statement 5 on the then-live body.
--
-- Affected clients: all Meta clients get the new columns (NULL until the windows branch runs).
--   No existing value changes. Regression: qa/256_regression.sql sections A and B.
--
-- Deploy order (stage 2, approval required). Full plan in runbooks/32_meta_attribution.md.
--   1. Statements 1 and 2 (raw table, stg view). Harmless alone.
--   2. Statements 3 and 4 (mart views). Columns appear, all NULL.
--   3. Statement 5 (procedure) and the CALL. rpt_ad_launch gets 44 columns.
--   4. n8n: import infra/n8n/wf_meta_ads_to_bigquery.json over the live workflow (adds the
--      windows branch). From the next hourly run the last 35 days get the split.
--   5. Backfill older days with the backfill workflow (runbook), then
--      qa/256_regression.sql section C.
-- Rollback
--   n8n: restore workflow version 2b8fb345-b8ec-4aa1-83bf-b45ffe1b8ae9 (pre-ME2).
--   SQL: live/mart.mart_meta_ad_perf.sql, live/mart.mart_creative_perf.sql, 255 statement 1
--   + CALL. The raw table and stg view can stay (unused) or be dropped.
-- Cost: raw grows like the legacy table (about 69k rows a day at the hourly 35-day re-fetch)
--   but narrow, about 0.3 KB a row: about 20 MB a day, 0.6 GB a month of storage. The mart
--   views read 6 more numeric columns of the stg view; the rpt CALL stays about 300 MB.
-- =============================================================================


-- 1. Raw table ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_meta_ad_attribution_windows`
(
  client_id STRING NOT NULL,
  ingested_at TIMESTAMP NOT NULL,
  ingest_source STRING NOT NULL,
  ad_account_id STRING,
  campaign_id STRING,
  adset_id STRING,
  ad_id STRING NOT NULL,
  date_start DATE NOT NULL,
  date_stop DATE,
  attribution_windows STRING NOT NULL OPTIONS(description="action_attribution_windows of the request, comma separated, e.g. 7d_click,1d_view,1d_ev."),
  purchases_7d_click NUMERIC OPTIONS(description="omni_purchase (else purchase) actions[].7d_click. NULL when the ad-day has no purchase action, 0 when the action exists without this window key."),
  purchase_value_7d_click NUMERIC OPTIONS(description="omni_purchase (else purchase) action_values[].7d_click, account currency."),
  purchases_1d_view NUMERIC OPTIONS(description="actions[].1d_view, view-through within 1 day."),
  purchase_value_1d_view NUMERIC OPTIONS(description="action_values[].1d_view."),
  purchases_1d_ev NUMERIC OPTIONS(description="actions[].1d_ev, engaged video view within 1 day."),
  purchase_value_1d_ev NUMERIC OPTIONS(description="action_values[].1d_ev."),
  purchases_windows_value NUMERIC OPTIONS(description="actions[].value under the requested windows (Meta's own total of the requested windows). Diagnostic only."),
  purchase_value_windows_value NUMERIC OPTIONS(description="action_values[].value under the requested windows. Diagnostic only."),
  actions STRING OPTIONS(description="Raw actions array with per-window keys, so another action type needs no re-ingest."),
  action_values STRING OPTIONS(description="Raw action_values array with per-window keys.")
)
PARTITION BY date_start
CLUSTER BY client_id, ad_id
OPTIONS(
  require_partition_filter = true,
  description = "Meta ad-level purchases per attribution window (7d_click, 1d_view, 1d_ev). Append-only, written by n8n wf_meta_ads_to_bigquery (windows branch) and the backfill workflow. Migration 256 (ME2)."
);


-- 2. Stg view: latest ingest per client, ad, day -----------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_meta_ad_attribution_windows` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, ad_id, date_start ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_meta_ad_attribution_windows`
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;


-- 3. mart.mart_meta_ad_perf (live text + LEFT JOIN + 9 columns at the end) ---------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_meta_ad_perf` AS
SELECT
  i.client_id,
  i.date_start AS date,
  i.ad_id, i.ad_name, i.campaign_id, i.adset_id, i.ad_account_id,
  i.spend, i.purchase_value AS revenue, i.purchases, i.impressions, i.clicks, i.reach,
  i.add_to_cart, i.initiate_checkout, i.landing_page_views, i.link_clicks, i.video_views,
  i.video_play_actions, i.video_thruplays,
  i.frequency                            AS frequency_per_day,
  i.ctr                                  AS ctr_per_day,
  i.cpc                                  AS cpc_per_day,
  SAFE_DIVIDE(i.spend, i.purchases)      AS cost_per_purchase_per_day,
  SAFE_DIVIDE(i.purchase_value, i.spend) AS roas_per_day,
  c.meta_currency AS currency,
  -- additive (PA1). The first eight are NULL until the ad-insights ingest requests them.
  i.outbound_clicks,
  i.unique_outbound_clicks,
  i.video_p25_watched,
  i.video_p50_watched,
  i.video_p75_watched,
  i.video_p95_watched,
  i.video_p100_watched,
  i.video_30s_watched,
  (SELECT CAST(SUM(SAFE_CAST(JSON_VALUE(a, '$.value') AS NUMERIC)) AS INT64)
     FROM UNNEST(JSON_QUERY_ARRAY(SAFE.PARSE_JSON(i.actions))) a
    WHERE JSON_VALUE(a, '$.action_type') = 'omni_view_content')  AS view_content,
  (SELECT CAST(SUM(SAFE_CAST(JSON_VALUE(a, '$.value') AS NUMERIC)) AS INT64)
     FROM UNNEST(JSON_QUERY_ARRAY(SAFE.PARSE_JSON(i.actions))) a
    WHERE JSON_VALUE(a, '$.action_type') = 'add_payment_info')   AS add_payment_info,
  -- additive (256, ME2). Purchases per attribution window. purchases / revenue above stay
  -- on each ad set's own attribution setting. attribution_windows NULL = split not ingested.
  w.attribution_windows,
  CAST(w.purchases_7d_click AS INT64) AS purchases_7d_click,
  w.purchase_value_7d_click           AS revenue_7d_click,
  CAST(w.purchases_1d_view AS INT64)  AS purchases_1d_view,
  w.purchase_value_1d_view            AS revenue_1d_view,
  CAST(w.purchases_1d_ev AS INT64)    AS purchases_1d_ev,
  w.purchase_value_1d_ev              AS revenue_1d_ev,
  -- Standard decision basis (owner, D3 as amended 2026-10-05): 7-day click + 1-day view.
  -- 1d_ev is stored above but is not part of the standard basis.
  CAST(w.purchases_7d_click + w.purchases_1d_view AS INT64) AS purchases_7dc_1dv,
  w.purchase_value_7d_click + w.purchase_value_1d_view      AS revenue_7dc_1dv
FROM `oneeighty-warehouse.stg.stg_meta_ad_insights` i
JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
LEFT JOIN `oneeighty-warehouse.stg.stg_meta_ad_attribution_windows` w
  ON w.client_id = i.client_id AND w.ad_id = i.ad_id AND w.date_start = i.date_start
WHERE i.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);


-- 4. mart.mart_creative_perf (live text + LEFT JOIN + 9 columns after currency) -----------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_creative_perf` AS
SELECT
  i.client_id,
  i.date_start                          AS date,
  i.ad_id,
  i.ad_name,
  i.adset_id,
  i.campaign_id,

  -- ── Tags. NULL throughout for an unmapped ad. ────────────────────────────
  t.clickup_task_id,
  t.clickup_url,
  t.concept_id,
  cn.concept_code,
  cn.name                               AS concept_name,
  t.persona_id,
  p.name                                AS persona_name,
  t.angle,
  t.offer,
  t.stage,
  t.production_type,
  t.format,
  t.body_code,
  t.hook_code,
  t.production_method,
  t.creator_id,
  cr.name                               AS creator_name,
  t.creator_type,
  t.production_cost,
  t.production_cost_source,
  t.brief_url,
  t.market,
  t.launched_at,
  t.match_method,
  t.match_confidence,

  -- ── Summable components. Safe to SUM across any grouping. ────────────────
  i.spend,
  i.purchase_value                      AS revenue,
  i.purchases,
  i.impressions,
  i.clicks,
  i.reach,
  i.add_to_cart,
  i.initiate_checkout,
  i.landing_page_views,
  i.link_clicks,
  i.outbound_clicks,
  i.unique_outbound_clicks,
  i.video_views,
  i.video_play_actions,                 -- 3s+, the hook-rate numerator
  i.video_thruplays,                    -- 15s, the hold-rate numerator
  i.video_p25_watched,
  i.video_p50_watched,
  i.video_p75_watched,
  i.video_p95_watched,
  i.video_p100_watched,
  i.video_30s_watched,

  -- ── Pre-divided by Meta. NEVER sum or average these. ─────────────────────
  i.frequency                           AS frequency_per_day,
  i.ctr                                 AS ctr_per_day,
  i.cpc                                 AS cpc_per_day,
  i.video_avg_time_watched_sec          AS video_avg_time_watched_sec_per_day,
  SAFE_DIVIDE(i.spend, i.purchases)         AS cost_per_purchase_per_day,
  SAFE_DIVIDE(i.purchase_value, i.spend)    AS roas_per_day,

  c.meta_currency                       AS currency,

  -- additive (256, ME2). Summable. Purchases per attribution window; purchases / revenue
  -- above stay on each ad set's own setting. attribution_windows NULL = split not ingested.
  w.attribution_windows,
  CAST(w.purchases_7d_click AS INT64)   AS purchases_7d_click,
  w.purchase_value_7d_click             AS revenue_7d_click,
  CAST(w.purchases_1d_view AS INT64)    AS purchases_1d_view,
  w.purchase_value_1d_view              AS revenue_1d_view,
  CAST(w.purchases_1d_ev AS INT64)      AS purchases_1d_ev,
  w.purchase_value_1d_ev                AS revenue_1d_ev,
  -- Standard decision basis: 7-day click + 1-day view (1d_ev excluded).
  CAST(w.purchases_7d_click + w.purchases_1d_view AS INT64) AS purchases_7dc_1dv,
  w.purchase_value_7d_click + w.purchase_value_1d_view      AS revenue_7dc_1dv
FROM `oneeighty-warehouse.stg.stg_meta_ad_insights` i
JOIN `oneeighty-warehouse.ref.clients` c
  USING (client_id)
LEFT JOIN `oneeighty-warehouse.ref.creative_tags` t
  ON t.client_id = i.client_id AND t.ad_id = i.ad_id
LEFT JOIN `oneeighty-warehouse.ref.concepts` cn
  ON cn.client_id = t.client_id AND cn.concept_id = t.concept_id
LEFT JOIN `oneeighty-warehouse.ref.personas` p
  ON p.client_id = t.client_id AND p.persona_id = t.persona_id
LEFT JOIN `oneeighty-warehouse.ref.creators` cr
  ON cr.client_id = t.client_id AND cr.creator_id = t.creator_id
LEFT JOIN `oneeighty-warehouse.stg.stg_meta_ad_attribution_windows` w
  ON w.client_id = i.client_id AND w.ad_id = i.ad_id AND w.date_start = i.date_start
WHERE i.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);


-- 5. Procedure: live 255 body, split columns added (marked "256") ------------------------
CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_rpt_ad_launch`()
OPTIONS (description = 'Rebuilds mart.rpt_ad_launch (one row per Meta ad: first delivery date, lifetime totals, pre-existing and relaunch flags, video flag, ad set launch context, 12 month prior ROAS, purchases per attribution window) from mart.mart_meta_ad_perf. Builds mart.rpt_ad_launch__next, checks it (rows > 0, >= 90 % of the current table, unique client_id and ad_id, latest day not older than 2 days), then swaps it in with CREATE OR REPLACE TABLE ... COPY. Any failure leaves the current table untouched. Migrations 254, 255 and 256. Run daily by a BigQuery scheduled query.')
BEGIN
  DECLARE prev_rows INT64;
  DECLARE new_rows INT64;
  DECLARE dup_rows INT64;
  DECLARE max_through DATE;

  SET @@query_label = 'feature:rpt-ad-launch-refresh';

  -- Rows in the table that is live now. NULL on the first run (table absent).
  SET prev_rows = (
    SELECT row_count FROM `oneeighty-warehouse.mart`.__TABLES__
    WHERE table_id = 'rpt_ad_launch');

  -- 1. Build the next version beside the live one. One scan of mart_meta_ad_perf.
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.rpt_ad_launch__next`
  CLUSTER BY client_id
  OPTIONS (description = 'Staging copy for mart.sp_refresh_rpt_ad_launch. Not for reading.')
  AS
  WITH d AS (
    SELECT client_id, ad_id, date, ad_name, campaign_id, adset_id, currency,
           spend, revenue, purchases, impressions, video_play_actions,
           -- 256: attribution split
           attribution_windows,
           purchases_7d_click, revenue_7d_click,
           purchases_1d_view, revenue_1d_view,
           purchases_1d_ev, revenue_1d_ev,
           purchases_7dc_1dv, revenue_7dc_1dv
    FROM `oneeighty-warehouse.mart.mart_meta_ad_perf`
    WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH) AND date < CURRENT_DATE()
  ),
  hist AS (
    -- History start per client: ads already running on that day look launched that day.
    SELECT client_id, MIN(IF(impressions > 0, date, NULL)) AS history_start, MAX(date) AS through
    FROM d GROUP BY client_id
  ),
  prior AS (
    -- Shrinkage anchor: trailing 365 days of the client's Meta ROAS, sum over sum.
    SELECT d.client_id, SAFE_DIVIDE(SUM(d.revenue), SUM(d.spend)) AS prior_roas,
      -- 256: the same anchor on 7-day click. NULL unless every delivery day of the window
      -- carries the split, so a half-backfilled year cannot pose as the anchor.
      IF(COUNTIF(d.impressions > 0 AND d.attribution_windows IS NULL) = 0,
         SAFE_DIVIDE(SUM(d.revenue_7d_click), SUM(d.spend)), NULL) AS prior_roas_7d_click,
      -- 256: the standard basis anchor (7-day click + 1-day view), same coverage rule.
      IF(COUNTIF(d.impressions > 0 AND d.attribution_windows IS NULL) = 0,
         SAFE_DIVIDE(SUM(d.revenue_7dc_1dv), SUM(d.spend)), NULL) AS prior_roas_7dc_1dv,
      SAFE_DIVIDE(SUM(IF(d.attribution_windows IS NOT NULL, d.spend, 0)), SUM(d.spend)) AS prior_split_coverage
    FROM d JOIN hist h USING (client_id)
    WHERE d.date > DATE_SUB(h.through, INTERVAL 365 DAY)
    GROUP BY d.client_id
  ),
  life AS (
    SELECT client_id, ad_id,
      ARRAY_AGG(ad_name ORDER BY date DESC LIMIT 1)[OFFSET(0)] AS ad_name,
      ARRAY_AGG(campaign_id ORDER BY date DESC LIMIT 1)[OFFSET(0)] AS campaign_id,
      ARRAY_AGG(adset_id ORDER BY date DESC LIMIT 1)[OFFSET(0)] AS adset_id,
      ANY_VALUE(currency) AS currency,
      MIN(IF(impressions > 0, date, NULL)) AS first_date,
      MAX(IF(impressions > 0, date, NULL)) AS last_date,
      COUNTIF(impressions > 0) AS active_days,
      IFNULL(SUM(spend), 0) AS spend,
      IFNULL(SUM(revenue), 0) AS revenue,
      IFNULL(SUM(purchases), 0) AS purchases,
      IFNULL(SUM(impressions), 0) AS impressions,
      IFNULL(SUM(video_play_actions), 0) AS video_plays,
      -- 256: attribution split, lifetime
      COUNTIF(impressions > 0 AND attribution_windows IS NOT NULL) AS split_days,
      IFNULL(SUM(purchases_7d_click), 0) AS purchases_7d_click,
      IFNULL(SUM(revenue_7d_click), 0) AS revenue_7d_click,
      IFNULL(SUM(purchases_1d_view), 0) AS purchases_1d_view,
      IFNULL(SUM(revenue_1d_view), 0) AS revenue_1d_view,
      IFNULL(SUM(purchases_1d_ev), 0) AS purchases_1d_ev,
      IFNULL(SUM(revenue_1d_ev), 0) AS revenue_1d_ev,
      IFNULL(SUM(purchases_7dc_1dv), 0) AS purchases_7dc_1dv,
      IFNULL(SUM(revenue_7dc_1dv), 0) AS revenue_7dc_1dv
    FROM d
    GROUP BY client_id, ad_id
    HAVING first_date IS NOT NULL
  ),
  asset AS (
    -- The creative asset: video, else image, else post, else creative.
    SELECT client_id, ad_id,
      COALESCE(NULLIF(video_id, ''), NULLIF(image_hash, ''),
               NULLIF(effective_object_story_id, ''), NULLIF(creative_id, '')) AS asset_key,
      NULLIF(video_id, '') IS NOT NULL AS has_video_asset
    FROM `oneeighty-warehouse.mart.mart_creative_asset`
  ),
  life2 AS (
    -- Ad set launch context (255): first delivery day of the ad set = earliest first_date of
    -- its ads. An ad whose first delivery is within 2 days of that day launched with its ad set.
    SELECT l.*, MIN(l.first_date) OVER (PARTITION BY l.client_id, l.adset_id) AS adset_first_date
    FROM life l
  )
  SELECT
    l.client_id, l.ad_id, l.ad_name, l.campaign_id, l.adset_id, l.currency,
    l.first_date, l.last_date, l.active_days,
    l.spend, l.revenue, l.purchases, l.impressions, l.video_plays,
    h.history_start, h.through,
    DATE_DIFF(h.through, l.first_date, DAY) AS age_days,
    l.first_date <= DATE_ADD(h.history_start, INTERVAL 2 DAY) AS is_preexisting,
    -- 255: video when video starts are >= 30 % of impressions (a few plays on a banner are not
    -- a video), or when the creative asset carries a video_id.
    SAFE_DIVIDE(l.video_plays, l.impressions) >= 0.30 OR IFNULL(a.has_video_asset, FALSE) AS is_video,
    a.asset_key,
    IFNULL(a.asset_key IS NOT NULL AND ROW_NUMBER() OVER (
      PARTITION BY l.client_id, a.asset_key ORDER BY l.first_date, l.ad_id) > 1, FALSE) AS is_relaunch,
    t.concept_id, cn.name AS concept_name, t.persona_id,
    t.format AS format_tag, t.production_type,
    p.prior_roas,
    CURRENT_TIMESTAMP() AS refreshed_at,
    SAFE_DIVIDE(l.video_plays, l.impressions) AS video_start_share,
    l.adset_first_date,
    IFNULL(l.first_date <= DATE_ADD(l.adset_first_date, INTERVAL 2 DAY), FALSE) AS is_new_adset,
    -- 256: attribution split. Lifetime window figures only when every delivery day has them.
    l.split_days AS attribution_split_days,
    l.split_days = l.active_days AS attribution_split_complete,
    IF(l.split_days = l.active_days, l.purchases_7d_click, NULL) AS purchases_7d_click,
    IF(l.split_days = l.active_days, l.revenue_7d_click, NULL)   AS revenue_7d_click,
    IF(l.split_days = l.active_days, l.purchases_1d_view, NULL)  AS purchases_1d_view,
    IF(l.split_days = l.active_days, l.revenue_1d_view, NULL)    AS revenue_1d_view,
    IF(l.split_days = l.active_days, l.purchases_1d_ev, NULL)    AS purchases_1d_ev,
    IF(l.split_days = l.active_days, l.revenue_1d_ev, NULL)      AS revenue_1d_ev,
    p.prior_roas_7d_click,
    p.prior_split_coverage,
    -- 256: standard decision basis, 7-day click + 1-day view (1d_ev excluded).
    IF(l.split_days = l.active_days, l.purchases_7dc_1dv, NULL)  AS purchases_7dc_1dv,
    IF(l.split_days = l.active_days, l.revenue_7dc_1dv, NULL)    AS revenue_7dc_1dv,
    p.prior_roas_7dc_1dv
  FROM life2 l
  JOIN hist h USING (client_id)
  LEFT JOIN prior p USING (client_id)
  LEFT JOIN asset a USING (client_id, ad_id)
  LEFT JOIN `oneeighty-warehouse.ref.creative_tags` t USING (client_id, ad_id)
  LEFT JOIN `oneeighty-warehouse.ref.concepts` cn
    ON cn.client_id = t.client_id AND cn.concept_id = t.concept_id;

  -- 2. Checks. A failed ASSERT ends the procedure here: the live table stays as it was.
  SET (new_rows, dup_rows, max_through) = (
    SELECT AS STRUCT
      COUNT(*),
      COUNT(*) - COUNT(DISTINCT FORMAT('%s|%s', client_id, ad_id)),
      MAX(through)
    FROM `oneeighty-warehouse.mart.rpt_ad_launch__next`);

  ASSERT new_rows > 0
    AS 'rpt_ad_launch refresh: mart_meta_ad_perf returned 0 ads, live table kept';
  ASSERT prev_rows IS NULL OR new_rows >= 0.9 * prev_rows
    AS 'rpt_ad_launch refresh: new row count is below 90 % of the live table, live table kept';
  ASSERT dup_rows = 0
    AS 'rpt_ad_launch refresh: duplicate client_id and ad_id rows, live table kept';
  ASSERT max_through >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)
    AS 'rpt_ad_launch refresh: latest loaded day is older than 2 days, live table kept';

  -- 3. Swap. One statement: readers see the old table or the new one, never a mix.
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.rpt_ad_launch`
  COPY `oneeighty-warehouse.mart.rpt_ad_launch__next`
  OPTIONS (description = 'One row per Meta ad: first delivery date, lifetime totals to the latest loaded day, pre-existing and relaunch flags, video flag and share, ad set launch context, 12 month client ROAS prior, lifetime purchases per attribution window (7d_click, 1d_view, 1d_ev) and on the standard basis 7d_click + 1d_view (NULL until the split covers every delivery day). Built from mart.mart_meta_ad_perf by mart.sp_refresh_rpt_ad_launch (daily). Base for the creative hit rate. Migrations 254, 255 and 256.');

  DROP TABLE IF EXISTS `oneeighty-warehouse.mart.rpt_ad_launch__next`;
END;

-- 6. First CALL (rebuilds rpt_ad_launch with 44 columns) ---------------------------------
-- CALL `oneeighty-warehouse.mart.sp_refresh_rpt_ad_launch`();
