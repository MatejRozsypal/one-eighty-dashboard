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
