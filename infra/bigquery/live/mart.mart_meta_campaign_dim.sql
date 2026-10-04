CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_meta_campaign_dim` AS
WITH base AS (
  SELECT
    client_id, campaign_id,
    ARRAY_AGG(campaign_name IGNORE NULLS ORDER BY date_start DESC LIMIT 1)[SAFE_OFFSET(0)] AS campaign_name,
    MIN(date_start) AS first_date,
    MAX(date_start) AS last_date
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights`
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, campaign_id
),
rule_hits AS (
  SELECT
    b.client_id, b.campaign_id, r.dimension,
    COALESCE(r.value, UPPER(REGEXP_EXTRACT(LOWER(b.campaign_name), r.pattern))) AS value
  FROM base b
  JOIN `oneeighty-warehouse.ref.naming_rules` r
    ON  r.platform = 'meta'
    AND r.entity   = 'campaign'
    AND r.client_id IN (b.client_id, '*')
    AND REGEXP_CONTAINS(LOWER(b.campaign_name), r.pattern)
  WHERE TRUE  -- QUALIFY needs a WHERE, GROUP BY or HAVING
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY b.client_id, b.campaign_id, r.dimension
    ORDER BY IF(r.client_id = '*', 1, 0), r.priority, r.pattern
  ) = 1
),
ovr AS (
  SELECT client_id, campaign_id, funnel_stage, market
  FROM `oneeighty-warehouse.ref.campaign_overrides`
  WHERE platform = 'meta'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY client_id, campaign_id ORDER BY updated_at DESC) = 1
)
SELECT
  b.client_id,
  b.campaign_id,
  b.campaign_name,
  b.first_date,
  b.last_date,
  COALESCE(o.funnel_stage, fs.value, 'unclassified') AS funnel_stage,
  COALESCE(o.market, mk.value)                       AS market,
  CASE WHEN o.funnel_stage IS NOT NULL THEN 'override'
       WHEN fs.value       IS NOT NULL THEN 'rule'
       ELSE 'none' END                               AS classified_by,
  CASE WHEN o.market IS NOT NULL THEN 'override'
       WHEN mk.value IS NOT NULL THEN 'rule'
       ELSE 'none' END                               AS market_classified_by
FROM base b
LEFT JOIN ovr o
  ON o.client_id = b.client_id AND o.campaign_id = b.campaign_id
LEFT JOIN rule_hits fs
  ON fs.client_id = b.client_id AND fs.campaign_id = b.campaign_id AND fs.dimension = 'funnel_stage'
LEFT JOIN rule_hits mk
  ON mk.client_id = b.client_id AND mk.campaign_id = b.campaign_id AND mk.dimension = 'market';
