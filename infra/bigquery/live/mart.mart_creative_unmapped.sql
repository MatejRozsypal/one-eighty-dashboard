CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_creative_unmapped` AS
WITH pipeline AS (
  SELECT client_id, MIN(created_date) AS pipeline_start
  FROM `oneeighty-warehouse.stg.stg_clickup_ad_tasks`
  WHERE NOT REGEXP_CONTAINS(IFNULL(task_name, ''), r'PersonaID-NAME|STAGE \| FORMAT')
  GROUP BY client_id
),
unmapped AS (
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
  HAVING SUM(i.spend) > 0
)
SELECT
  u.*,
  p.pipeline_start,
  (p.pipeline_start IS NULL OR u.first_seen < p.pipeline_start) AS before_pipeline
FROM unmapped u
LEFT JOIN pipeline p USING (client_id);
