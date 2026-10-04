CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_clickup_ad_tasks` AS
SELECT
  a.*,
  cn.concept_id,
  cn.concept_code,
  cn.name AS concept_name,
  cn.persona_id,
  cn.angle,
  cn.offer
FROM `oneeighty-warehouse.stg.stg_clickup_ad_tasks` a
LEFT JOIN `oneeighty-warehouse.ref.concepts` cn
  ON cn.client_id = a.client_id AND cn.clickup_task_id = a.concept_task_id;
