CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_meta_ad_breakdown_placement` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY client_id, ad_id, date_start, publisher_platform, platform_position, impression_device
    ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_meta_ad_breakdown_placement`
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;
