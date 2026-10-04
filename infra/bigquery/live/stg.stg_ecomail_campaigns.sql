CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_ecomail_campaigns` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, campaign_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_ecomail_campaigns`
  WHERE DATE(sent_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;
