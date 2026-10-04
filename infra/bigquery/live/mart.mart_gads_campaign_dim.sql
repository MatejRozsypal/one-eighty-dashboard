CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_gads_campaign_dim` AS
WITH cm AS (
  SELECT gads_customer_id AS customer_id, client_id, gads_currency AS currency
  FROM `oneeighty-warehouse.ref.clients`
  WHERE has_gads AND gads_customer_id IS NOT NULL
),
latest AS (
  -- Entity snapshot: latest row per campaign. Same 25 month window as the stats so a
  -- removed campaign keeps its name for every day it has spend.
  SELECT
    customer_id, campaign_id, campaign_name,
    campaign_advertising_channel_type     AS channel_type,
    campaign_advertising_channel_sub_type AS channel_sub_type,
    campaign_status                       AS status,
    campaign_serving_status               AS serving_status,
    campaign_bidding_strategy_type        AS bidding_strategy_type,
    NULLIF(campaign_maximize_conversion_value_target_roas, 0) AS target_roas,
    IF(campaign_budget_period = 'DAILY', campaign_budget_amount_micros / 1e6, NULL) AS budget_per_day,
    campaign_budget_explicitly_shared     AS budget_shared
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_Campaign_*`
  WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH))
  QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id, campaign_id ORDER BY _PARTITIONTIME DESC) = 1
),
named AS (
  SELECT
    cm.client_id, cm.currency,
    CAST(l.campaign_id AS STRING) AS campaign_id,
    l.* EXCEPT (customer_id, campaign_id),
    LOWER(l.campaign_name) AS name_lc,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(NORMALIZE(l.campaign_name, NFD)), r'\p{M}', ''), r'\s+', ' ')) AS name_norm
  FROM latest l
  JOIN cm USING (customer_id)
),
terms AS (
  SELECT client_id, term_norm, match_type, is_exclusion
  FROM `oneeighty-warehouse.ref.client_brand_terms`
  WHERE applies_to IN ('all', 'campaign') AND term_norm != ''
),
brand_hit AS (
  SELECT
    n.client_id, n.campaign_id,
    LOGICAL_OR(NOT t.is_exclusion AND (CASE t.match_type
      WHEN 'contains' THEN STRPOS(n.name_norm, t.term_norm) > 0
      WHEN 'word'     THEN SAFE.REGEXP_CONTAINS(n.name_norm, CONCAT(r'(^|\W)', REGEXP_REPLACE(t.term_norm, r'([.*+?^${}()|\[\]\\])', r'\\\1'), r'(\W|$)'))
      WHEN 'exact'    THEN n.name_norm = t.term_norm
      WHEN 'regex'    THEN SAFE.REGEXP_CONTAINS(n.name_norm, t.term_norm)
      ELSE FALSE END)) AS hit,
    LOGICAL_OR(t.is_exclusion AND (CASE t.match_type
      WHEN 'contains' THEN STRPOS(n.name_norm, t.term_norm) > 0
      WHEN 'word'     THEN SAFE.REGEXP_CONTAINS(n.name_norm, CONCAT(r'(^|\W)', REGEXP_REPLACE(t.term_norm, r'([.*+?^${}()|\[\]\\])', r'\\\1'), r'(\W|$)'))
      WHEN 'exact'    THEN n.name_norm = t.term_norm
      WHEN 'regex'    THEN SAFE.REGEXP_CONTAINS(n.name_norm, t.term_norm)
      ELSE FALSE END)) AS excl
  FROM named n
  JOIN terms t ON t.client_id = n.client_id
  GROUP BY n.client_id, n.campaign_id
),
rules AS (
  SELECT client_id, pattern, value, priority
  FROM `oneeighty-warehouse.ref.naming_rules`
  WHERE platform = 'google' AND entity = 'campaign' AND dimension = 'market'
),
market_pick AS (
  SELECT
    n.client_id, n.campaign_id,
    ARRAY_AGG(UPPER(COALESCE(r.value, REGEXP_EXTRACT(n.name_lc, CONCAT('(?i)', r.pattern))))
              ORDER BY IF(r.client_id = '*', 1, 0), r.priority LIMIT 1)[OFFSET(0)] AS market
  FROM named n
  JOIN rules r
    ON r.client_id IN (n.client_id, '*')
   AND SAFE.REGEXP_CONTAINS(n.name_lc, CONCAT('(?i)', r.pattern))
  GROUP BY n.client_id, n.campaign_id
),
ov AS (
  SELECT client_id, CAST(campaign_id AS STRING) AS campaign_id, brand_class, market
  FROM `oneeighty-warehouse.ref.campaign_overrides`
  WHERE platform = 'google'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY client_id, CAST(campaign_id AS STRING) ORDER BY updated_at DESC) = 1
)
SELECT
  n.client_id,
  n.campaign_id,
  n.campaign_name,
  n.channel_type,
  n.channel_sub_type,
  n.status,
  n.serving_status,
  n.bidding_strategy_type,
  n.target_roas,
  n.budget_per_day,
  n.budget_shared,
  CASE
    WHEN o.brand_class IS NOT NULL THEN o.brand_class
    WHEN n.channel_type IN ('SHOPPING', 'PERFORMANCE_MAX') THEN 'shopping_pmax'
    WHEN n.channel_type = 'SEARCH'
         AND (REGEXP_CONTAINS(n.name_norm, r'(^|[^a-z0-9])(brand|brd)([^a-z0-9]|$)')
              OR COALESCE(h.hit AND NOT h.excl, FALSE)) THEN 'brand'
    WHEN n.channel_type = 'SEARCH' THEN 'non_brand'
    ELSE 'other'
  END AS brand_class,
  CASE
    WHEN o.brand_class IS NOT NULL THEN 'override'
    WHEN n.channel_type IN ('SHOPPING', 'PERFORMANCE_MAX', 'SEARCH') THEN 'rule'
    ELSE 'none'
  END AS classified_by,
  COALESCE(UPPER(o.market), mp.market) AS market,
  n.currency
FROM named n
LEFT JOIN brand_hit   h  ON h.client_id  = n.client_id AND h.campaign_id  = n.campaign_id
LEFT JOIN market_pick mp ON mp.client_id = n.client_id AND mp.campaign_id = n.campaign_id
LEFT JOIN ov          o  ON o.client_id  = n.client_id AND o.campaign_id  = n.campaign_id;
