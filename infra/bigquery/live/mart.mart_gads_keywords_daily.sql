CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_gads_keywords_daily` AS
WITH cm AS (
  SELECT gads_customer_id AS customer_id, client_id
  FROM `oneeighty-warehouse.ref.clients`
  WHERE has_gads AND gads_customer_id IS NOT NULL
),
stats AS (
  SELECT
    customer_id, DATE(_PARTITIONTIME) AS date, campaign_id, ad_group_id,
    ad_group_criterion_criterion_id AS criterion_id,
    SUM(metrics_cost_micros) / 1e6  AS spend,
    SUM(IF(segments_click_type = 'URL_CLICKS', metrics_impressions, 0)) AS impressions,
    SUM(metrics_clicks)             AS clicks,
    SUM(metrics_conversions)        AS conversions,
    SUM(metrics_conversions_value)  AS conversions_value
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_KeywordStats_*`
  WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH))
    AND DATE(_PARTITIONTIME) < CURRENT_DATE()
  GROUP BY customer_id, date, campaign_id, ad_group_id, criterion_id
),
kw AS (
  SELECT
    customer_id, ad_group_id, ad_group_criterion_criterion_id AS criterion_id,
    ad_group_criterion_keyword_text                       AS keyword_text,
    ad_group_criterion_keyword_match_type                 AS match_type,
    ad_group_criterion_negative                           AS is_negative,
    ad_group_criterion_quality_info_quality_score         AS quality_score,
    ad_group_criterion_quality_info_search_predicted_ctr  AS predicted_ctr,
    ad_group_criterion_quality_info_creative_quality_score AS creative_quality,
    ad_group_criterion_quality_info_post_click_quality_score AS landing_page_quality
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_Keyword_*`
  WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH))
  QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id, ad_group_id, ad_group_criterion_criterion_id ORDER BY _PARTITIONTIME DESC) = 1
),
s AS (
  SELECT
    cm.client_id, st.*, kw.keyword_text, kw.match_type,
    kw.quality_score, kw.predicted_ctr, kw.creative_quality, kw.landing_page_quality,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(NORMALIZE(kw.keyword_text, NFD)), r'\p{M}', ''), r'\s+', ' ')) AS term_norm
  FROM stats st
  JOIN cm USING (customer_id)
  LEFT JOIN kw ON kw.customer_id = st.customer_id AND kw.ad_group_id = st.ad_group_id AND kw.criterion_id = st.criterion_id
  WHERE COALESCE(kw.is_negative, FALSE) = FALSE
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
  FROM (SELECT DISTINCT client_id, term_norm FROM s WHERE term_norm IS NOT NULL) w
  JOIN terms t ON t.client_id = w.client_id
  GROUP BY w.client_id, w.term_norm
)
SELECT
  s.client_id,
  s.date,
  CAST(s.campaign_id AS STRING)  AS campaign_id,
  CAST(s.ad_group_id AS STRING)  AS ad_group_id,
  CAST(s.criterion_id AS STRING) AS criterion_id,
  s.keyword_text,
  s.match_type,
  s.quality_score,
  s.predicted_ctr,
  s.creative_quality,
  s.landing_page_quality,
  COALESCE(h.hit AND NOT h.excl, FALSE) AS is_brand,
  s.spend, s.impressions, s.clicks, s.conversions, s.conversions_value
FROM s
LEFT JOIN hits h ON h.client_id = s.client_id AND h.term_norm = s.term_norm;
