-- 223_mart_creative.sql
-- Creative Engine, phase 1e: the mart layer the dashboard reads.
--
-- ── The rule these views are built to ───────────────────────────────────────
-- METRICS.md: only SUMMABLE COMPONENTS cross a join, every rate is recomputed
-- AFTER aggregation, and nothing with a `_per_day` suffix is ever summed or
-- averaged. That matters more here than anywhere else in the warehouse, because
-- this product's whole job is aggregating one ad's daily rows up to a persona
-- read across five months. Averaging a stored ROAS across those rows would
-- weight a 40 Kč day the same as a 4 000 Kč day.
--
-- ── What is deliberately NOT here ──────────────────────────────────────────
-- No ROAS shrinkage, no confidence class, no verdict. Those depend on
-- per-client thresholds that live in Postgres (`creative_settings`), which
-- BigQuery cannot see, and on the aggregation level the reader chose. They are
-- computed once in dashboard/lib/creative/stats.ts and applied to whatever has
-- just been aggregated. A shrunk ROAS stored per day would be arithmetically
-- meaningless: shrinkage is a function of the purchase count of the GROUP.
--
-- Run order: AFTER 222.

-- =============================================================================
-- mart_creative_perf — daily x ad, with the tag spine joined on
-- =============================================================================
-- LEFT JOIN, always. An untagged ad is not an absent ad: it is 34% of Manami's
-- spend sitting on one creative that predates the Persona Bank, and hiding it
-- would make every share-of-spend figure on the product a lie.
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
  cn.name                               AS concept_name,
  t.persona_id,
  p.name                                AS persona_name,
  t.angle,
  t.offer,
  t.stage,
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

  c.meta_currency                       AS currency
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
WHERE i.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);

-- =============================================================================
-- mart_creative_asset — one row per (client_id, ad_id): the creative itself
-- =============================================================================
-- `asset_uri` is a gs:// path, not a URL. The dashboard signs it at render time
-- from its own service account; the bucket is private because these are client
-- creatives and some are unreleased.
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_creative_asset` AS
SELECT
  cr.client_id,
  cr.ad_id,
  cr.creative_id,
  cr.adset_id,
  cr.adset_name,
  cr.campaign_id,
  cr.campaign_name,
  cr.effective_status,
  cr.object_type,
  cr.asset_kind,
  cr.asset_uri,
  cr.thumb_uri,
  cr.video_length_sec,
  cr.image_hash,
  cr.video_id,
  cr.effective_object_story_id,
  cr.title,
  cr.body,
  cr.link_description,
  cr.call_to_action_type,
  cr.link_url,
  cr.bodies_json,
  cr.titles_json,
  cr.descriptions_json,
  cr.snapshot_date                      AS as_of
FROM `oneeighty-warehouse.stg.stg_meta_ad_creatives` cr;

-- =============================================================================
-- mart_creative_adset_perf — daily x ad set. Where money verdicts are taken.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_creative_adset_perf` AS
SELECT
  a.client_id,
  a.date_start                          AS date,
  a.adset_id,
  a.adset_name,
  a.campaign_id,
  a.campaign_name,
  a.spend,
  a.purchase_value                      AS revenue,
  a.purchases,
  a.impressions,
  a.clicks,
  a.reach,
  a.add_to_cart,
  a.initiate_checkout,
  a.landing_page_views,
  a.link_clicks,
  a.outbound_clicks,
  a.frequency                           AS frequency_per_day,
  a.ctr                                 AS ctr_per_day,
  a.cpc                                 AS cpc_per_day,
  SAFE_DIVIDE(a.spend, a.purchases)      AS cost_per_purchase_per_day,
  SAFE_DIVIDE(a.purchase_value, a.spend) AS roas_per_day,
  c.meta_currency                       AS currency
FROM `oneeighty-warehouse.stg.stg_meta_adset_insights` a
JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
WHERE a.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);

-- =============================================================================
-- Breakdowns. Impressions and spend first; purchases carried but thin.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_creative_breakdown_demo` AS
SELECT client_id, date_start AS date, ad_id, age, gender,
       spend, impressions, reach, clicks, purchases, purchase_value AS revenue
FROM `oneeighty-warehouse.stg.stg_meta_ad_breakdown_demo`
WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_creative_breakdown_placement` AS
SELECT client_id, date_start AS date, ad_id,
       publisher_platform, platform_position, impression_device,
       spend, impressions, reach, clicks, purchases, purchase_value AS revenue
FROM `oneeighty-warehouse.stg.stg_meta_ad_breakdown_placement`
WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);

-- =============================================================================
-- mart_creative_unmapped — the permanent badge in the header
-- =============================================================================
-- Every ad that has taken spend and carries no tag row. Ordered by spend, so
-- the queue is worked in the order that changes the numbers most, not in the
-- order Meta happened to create the ads.
--
-- The name-match PROPOSAL is deliberately not computed here. Scoring a persona
-- token against a task name is string work with rules that will change; it
-- lives in dashboard/lib/creative/matching.ts where it can be read, changed and
-- reasoned about. This view supplies the two sides and nothing else.
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_creative_unmapped` AS
SELECT
  i.client_id,
  i.ad_id,
  ANY_VALUE(i.ad_name)      AS ad_name,
  ANY_VALUE(i.adset_id)     AS adset_id,
  SUM(i.spend)              AS spend,
  SUM(i.purchases)          AS purchases,
  SUM(i.purchase_value)     AS revenue,
  SUM(i.impressions)        AS impressions,
  MIN(i.date_start)         AS first_seen,
  MAX(i.date_start)         AS last_seen
FROM `oneeighty-warehouse.stg.stg_meta_ad_insights` i
LEFT JOIN `oneeighty-warehouse.ref.creative_tags` t
  ON t.client_id = i.client_id AND t.ad_id = i.ad_id
WHERE i.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  AND t.ad_id IS NULL
GROUP BY i.client_id, i.ad_id
HAVING SUM(i.spend) > 0;

-- Candidate ClickUp tasks for the queue to match against.
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_clickup_ad_tasks` AS
SELECT
  a.*,
  cn.concept_id,
  cn.name AS concept_name,
  cn.persona_id,
  cn.angle,
  cn.offer
FROM `oneeighty-warehouse.stg.stg_clickup_ad_tasks` a
LEFT JOIN `oneeighty-warehouse.ref.concepts` cn
  ON cn.client_id = a.client_id AND cn.clickup_task_id = a.concept_task_id;

-- Dimension tables, exposed through mart so the app reads one dataset.
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_creative_concepts` AS
SELECT * FROM `oneeighty-warehouse.ref.concepts`;

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_creative_personas` AS
SELECT * FROM `oneeighty-warehouse.ref.personas`;

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_creative_creators` AS
SELECT * FROM `oneeighty-warehouse.ref.creators`;

-- =============================================================================
-- mart_creative_tag_coverage — the number that gates the Breakdown screen
-- =============================================================================
-- Breakdown stays behind a flag until roughly 60% of spend carries a concept
-- tag. Below that it reads less than half the account and the rows it does show
-- are not a sample of anything. This view is what the flag reads, so the
-- threshold is checked against measured coverage rather than someone's
-- recollection of it.
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_creative_tag_coverage` AS
SELECT
  client_id,
  SUM(spend)                                                   AS spend_total,
  SUM(IF(concept_id IS NULL, 0, spend))                        AS spend_tagged,
  SAFE_DIVIDE(SUM(IF(concept_id IS NULL, 0, spend)), SUM(spend)) AS pct_spend_tagged,
  COUNT(DISTINCT ad_id)                                        AS ads,
  COUNT(DISTINCT IF(concept_id IS NULL, NULL, ad_id))          AS ads_tagged,
  MAX(date)                                                    AS through
FROM `oneeighty-warehouse.mart.mart_creative_perf`
WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
GROUP BY client_id;
