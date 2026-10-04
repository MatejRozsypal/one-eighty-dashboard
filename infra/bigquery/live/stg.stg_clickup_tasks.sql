CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_clickup_tasks` AS
SELECT
  * EXCEPT(rn, custom_fields),
  ARRAY(
    SELECT AS STRUCT
      f.field_id, f.name, f.type,
      -- A value equal to its own field's name is a placeholder, not data.
      IF(TRIM(IFNULL(f.value_text, '')) = f.name, NULL, f.value_text) AS value_text,
      f.value_num, f.value_ids
    FROM UNNEST(custom_fields) AS f
  ) AS custom_fields
FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, task_id ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_clickup_tasks`
  WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;
