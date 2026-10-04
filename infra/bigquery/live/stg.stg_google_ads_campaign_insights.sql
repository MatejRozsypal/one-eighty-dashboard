CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_google_ads_campaign_insights` AS
WITH client_map AS (
  SELECT gads_customer_id AS customer_id, client_id
  FROM `oneeighty-warehouse.ref.clients`
  WHERE has_gads AND gads_customer_id IS NOT NULL
),
stats AS (
  SELECT
    segments_date                    AS date,
    customer_id,
    campaign_id,
    SUM(metrics_cost_micros) / 1e6   AS spend,
    SUM(metrics_impressions)         AS impressions,
    SUM(metrics_clicks)              AS clicks,
    SUM(metrics_conversions)         AS purchases,
    SUM(metrics_conversions_value)   AS purchase_value
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_CampaignBasicStats_*`
  WHERE segments_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY date, customer_id, campaign_id
),
campaigns AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT customer_id, campaign_id, campaign_name,
      ROW_NUMBER() OVER (PARTITION BY customer_id, campaign_id ORDER BY _PARTITIONTIME DESC) AS rn
    FROM `oneeighty-warehouse.raw_google_ads.p_ads_Campaign_*`
  ) WHERE rn = 1
)
SELECT
  m.client_id,
  st.date                          AS date_start,
  st.date                          AS date_stop,
  CAST(st.customer_id AS STRING)   AS ad_account_id,
  CAST(st.campaign_id AS STRING)   AS campaign_id,
  c.campaign_name,
  st.spend,
  st.impressions,
  st.clicks,
  st.purchases,
  st.purchase_value
FROM stats st
JOIN client_map m USING (customer_id)
LEFT JOIN campaigns c USING (customer_id, campaign_id);
