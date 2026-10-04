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
  cr.asset_width,
  cr.asset_height,
  -- Width over height. Computed here so five call sites cannot each pick a
  -- different rounding, and null rather than 1 when either side is missing -
  -- a default would be a claim about the creative's shape.
  SAFE_DIVIDE(cr.asset_width, cr.asset_height) AS aspect_ratio,
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
