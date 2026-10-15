-- Q2: paid spend per client x market x period, converted to the client base currency.
-- Meta: campaign market from mart.mart_meta_campaign_dim (naming rule or override), else UNALLOCATED.
-- Google: country from raw_google_ads GeoStats (both location types), 2203 = CZ, 2703 = SK.
WITH p AS (
  SELECT 'L12M' period, DATE '2025-10-15' d0, DATE '2026-10-14' d1 UNION ALL
  SELECT 'P12M', DATE '2024-10-15', DATE '2025-10-14' UNION ALL
  SELECT 'L90',  DATE '2026-07-17', DATE '2026-10-14' UNION ALL
  SELECT 'P90',  DATE '2026-04-18', DATE '2026-07-16' UNION ALL
  SELECT 'COH365', DATE '2024-10-15', DATE '2025-10-14' UNION ALL   -- cohort window for 365d LTGP
  SELECT 'COH180', DATE '2025-04-18', DATE '2026-04-17' UNION ALL   -- cohort window for 180d
  SELECT 'COH90',  DATE '2025-07-17', DATE '2026-07-16'             -- cohort window for 90d
),
cl AS (SELECT client_id, currency, meta_currency FROM `oneeighty-warehouse.ref.clients`),
meta AS (
  SELECT m.client_id, m.date_start AS d, COALESCE(dim.market, 'UNALLOCATED') AS market, 'meta' AS platform,
         m.spend * IF(cl.meta_currency = cl.currency, 1, fx.rate) AS spend
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` m
  JOIN cl USING (client_id)
  LEFT JOIN `oneeighty-warehouse.mart.mart_meta_campaign_dim` dim USING (client_id, campaign_id)
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
    ON fx.from_currency = cl.meta_currency AND fx.to_currency = cl.currency
   AND fx.month_start = DATE_TRUNC(m.date_start, MONTH)
  WHERE m.date_start >= '2024-10-15'
),
gads AS (
  SELECT 'rawbark' AS client_id, segments_date AS d,
         CASE geographic_view_country_criterion_id WHEN 2203 THEN 'CZ' WHEN 2703 THEN 'SK' ELSE 'OTHER' END AS market,
         'google' AS platform, metrics_cost_micros / 1e6 AS spend
  FROM `oneeighty-warehouse.raw_google_ads.ads_GeoStats_9406261058` WHERE segments_date >= '2024-10-15'
  UNION ALL
  SELECT 'manami', segments_date,
         CASE geographic_view_country_criterion_id WHEN 2203 THEN 'CZ' WHEN 2703 THEN 'SK' ELSE 'OTHER' END,
         'google', metrics_cost_micros / 1e6
  FROM `oneeighty-warehouse.raw_google_ads.ads_GeoStats_5865960448` WHERE segments_date >= '2024-10-15'
),
s AS (SELECT * FROM meta UNION ALL SELECT * FROM gads)
SELECT s.client_id, p.period, s.market,
       ROUND(SUM(IF(platform = 'meta', spend, 0))) AS meta_spend,
       ROUND(SUM(IF(platform = 'google', spend, 0))) AS google_spend,
       ROUND(SUM(spend)) AS paid_spend,
       COUNT(DISTINCT IF(platform = 'meta', d, NULL)) AS meta_days,
       COUNT(DISTINCT IF(platform = 'google', d, NULL)) AS google_days,
       MIN(d) AS first_spend_day
FROM s JOIN p ON s.d BETWEEN p.d0 AND p.d1
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3
