CREATE TABLE `oneeighty-warehouse.mart.rpt_ad_launch`
(
  client_id STRING,
  ad_id STRING,
  ad_name STRING,
  campaign_id STRING,
  adset_id STRING,
  currency STRING,
  first_date DATE,
  last_date DATE,
  active_days INT64,
  spend NUMERIC,
  revenue NUMERIC,
  purchases INT64,
  impressions INT64,
  video_plays INT64,
  history_start DATE,
  through DATE,
  age_days INT64,
  is_preexisting BOOL,
  is_video BOOL,
  asset_key STRING,
  is_relaunch BOOL,
  concept_id STRING,
  concept_name STRING,
  persona_id STRING,
  format_tag STRING,
  production_type STRING,
  prior_roas NUMERIC,
  refreshed_at TIMESTAMP
)
CLUSTER BY client_id
OPTIONS(
  description="One row per Meta ad: first delivery date, lifetime totals to the latest loaded day, pre-existing and relaunch flags, 12 month client ROAS prior. Built from mart.mart_meta_ad_perf by mart.sp_refresh_rpt_ad_launch (daily). Base for the creative hit rate. Migration 254."
);
