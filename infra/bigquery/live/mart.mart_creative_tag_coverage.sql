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
