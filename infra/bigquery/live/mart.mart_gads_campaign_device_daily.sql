CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_gads_campaign_device_daily` AS
WITH cm AS (
  SELECT gads_customer_id AS customer_id, client_id,
         gads_currency, currency AS client_currency
  FROM `oneeighty-warehouse.ref.clients`
  WHERE has_gads AND gads_customer_id IS NOT NULL
),
basic AS (
  SELECT
    customer_id, campaign_id, DATE(_PARTITIONTIME) AS date,
    segments_device                         AS device,
    SUM(metrics_cost_micros) / 1e6          AS spend,
    SUM(metrics_impressions)                AS impressions,
    SUM(metrics_clicks)                     AS clicks,
    SUM(metrics_conversions)                AS conversions,
    SUM(metrics_conversions_value)          AS conversions_value
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_CampaignBasicStats_*`
  WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH))
    AND DATE(_PARTITIONTIME) < CURRENT_DATE()
  GROUP BY customer_id, campaign_id, date, device
)
SELECT
  cm.client_id,
  b.date,
  CAST(b.campaign_id AS STRING) AS campaign_id,
  b.device,
  d.campaign_name,
  d.channel_type,
  b.spend,
  b.impressions,
  b.clicks,
  b.conversions,
  b.conversions_value,
  b.spend             * CAST(IF(cm.gads_currency = cm.client_currency, NUMERIC '1', r.rate) AS FLOAT64) AS spend_client_ccy,
  b.conversions_value * CAST(IF(cm.gads_currency = cm.client_currency, NUMERIC '1', r.rate) AS FLOAT64) AS conversions_value_client_ccy,
  cm.gads_currency    AS currency,
  cm.client_currency  AS client_currency
FROM basic b
JOIN cm USING (customer_id)
LEFT JOIN `oneeighty-warehouse.mart.mart_gads_campaign_dim` d
  ON d.client_id = cm.client_id AND d.campaign_id = CAST(b.campaign_id AS STRING)
LEFT JOIN `oneeighty-warehouse.ref.fx_rates` r
  ON  r.month_start   = DATE_TRUNC(b.date, MONTH)
  AND r.from_currency = cm.gads_currency
  AND r.to_currency   = cm.client_currency;
