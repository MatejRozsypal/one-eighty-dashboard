CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_gads_search_terms_daily` AS
WITH cm AS (
  SELECT gads_customer_id AS customer_id, client_id
  FROM `oneeighty-warehouse.ref.clients`
  WHERE has_gads AND gads_customer_id IS NOT NULL
),
base AS (
  SELECT
    customer_id, DATE(_PARTITIONTIME) AS date, campaign_id, ad_group_id,
    search_term_view_search_term          AS search_term,
    segments_search_term_match_type       AS match_type,
    search_term_view_status               AS term_status,
    segments_keyword_ad_group_criterion   AS keyword_criterion,
    SUM(metrics_cost_micros) / 1e6        AS spend,
    SUM(metrics_impressions)              AS impressions,
    SUM(metrics_clicks)                   AS clicks,
    SUM(metrics_conversions)              AS conversions,
    SUM(metrics_conversions_value)        AS conversions_value
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_SearchQueryStats_*`
  WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH))
    AND DATE(_PARTITIONTIME) < CURRENT_DATE()
  GROUP BY customer_id, date, campaign_id, ad_group_id, search_term, match_type, term_status, keyword_criterion
),
b AS (
  SELECT
    cm.client_id, base.*,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(NORMALIZE(base.search_term, NFD)), r'\p{M}', ''), r'\s+', ' ')) AS term_norm
  FROM base
  JOIN cm USING (customer_id)
),
terms AS (
  SELECT client_id, term_norm, match_type, is_exclusion
  FROM `oneeighty-warehouse.ref.client_brand_terms`
  WHERE applies_to IN ('all', 'search_term') AND term_norm != ''
),
hits AS (
  SELECT
    w.client_id, w.term_norm,
    LOGICAL_OR(NOT t.is_exclusion AND (CASE t.match_type
      WHEN 'contains' THEN STRPOS(w.term_norm, t.term_norm) > 0
      WHEN 'word'     THEN SAFE.REGEXP_CONTAINS(w.term_norm, CONCAT(r'(^|\W)', REGEXP_REPLACE(t.term_norm, r'([.*+?^${}()|\[\]\\])', r'\\\1'), r'(\W|$)'))
      WHEN 'exact'    THEN w.term_norm = t.term_norm
      WHEN 'regex'    THEN SAFE.REGEXP_CONTAINS(w.term_norm, t.term_norm)
      ELSE FALSE END)) AS hit,
    LOGICAL_OR(t.is_exclusion AND (CASE t.match_type
      WHEN 'contains' THEN STRPOS(w.term_norm, t.term_norm) > 0
      WHEN 'word'     THEN SAFE.REGEXP_CONTAINS(w.term_norm, CONCAT(r'(^|\W)', REGEXP_REPLACE(t.term_norm, r'([.*+?^${}()|\[\]\\])', r'\\\1'), r'(\W|$)'))
      WHEN 'exact'    THEN w.term_norm = t.term_norm
      WHEN 'regex'    THEN SAFE.REGEXP_CONTAINS(w.term_norm, t.term_norm)
      ELSE FALSE END)) AS excl
  FROM (SELECT DISTINCT client_id, term_norm FROM b) w
  JOIN terms t ON t.client_id = w.client_id
  GROUP BY w.client_id, w.term_norm
)
SELECT
  b.client_id,
  b.date,
  CAST(b.campaign_id AS STRING) AS campaign_id,
  CAST(b.ad_group_id AS STRING) AS ad_group_id,
  b.search_term,
  b.match_type,
  b.term_status,
  b.keyword_criterion,
  COALESCE(h.hit AND NOT h.excl, FALSE) AS is_brand,
  d.brand_class AS campaign_brand_class,
  b.spend, b.impressions, b.clicks, b.conversions, b.conversions_value
FROM b
LEFT JOIN hits h ON h.client_id = b.client_id AND h.term_norm = b.term_norm
LEFT JOIN `oneeighty-warehouse.mart.mart_gads_campaign_dim` d
  ON d.client_id = b.client_id AND d.campaign_id = CAST(b.campaign_id AS STRING);
