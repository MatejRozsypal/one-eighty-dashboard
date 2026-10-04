CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_klaviyo_campaigns` AS
WITH metadata AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY client_id, campaign_id ORDER BY ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_klaviyo_campaigns`
    WHERE DATE(send_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  ) WHERE rn = 1
),
reports AS (
  -- Latest snapshot per campaign from the campaign-values-reports endpoint
  SELECT * EXCEPT(rn) FROM (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY client_id, campaign_id ORDER BY ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_klaviyo_campaign_reports`
    WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  ) WHERE rn = 1
)
SELECT
  m.client_id,
  m.ingested_at,
  m.campaign_id,
  m.campaign_name,
  COALESCE(r.send_channel, m.channel) AS channel,
  m.status,
  m.send_time,
  m.list_id,
  m.list_name,
  m.segment_id,
  -- Performance metrics from the report endpoint (overlay raw NULLs from metadata)
  COALESCE(CAST(r.recipients AS INT64),     m.recipients)     AS recipients,
  COALESCE(CAST(r.delivered AS INT64),      m.delivered)      AS delivered,
  COALESCE(CAST(r.bounced AS INT64),        m.bounces)        AS bounces,
  COALESCE(CAST(r.opens AS INT64),          m.opens)          AS opens,
  COALESCE(CAST(r.opens_unique AS INT64),   m.unique_opens)   AS unique_opens,
  COALESCE(r.open_rate,                     m.open_rate)      AS open_rate,
  COALESCE(CAST(r.clicks AS INT64),         m.clicks)         AS clicks,
  COALESCE(CAST(r.clicks_unique AS INT64),  m.unique_clicks)  AS unique_clicks,
  COALESCE(r.click_rate,                    m.click_rate)     AS click_rate,
  COALESCE(CAST(r.unsubscribes AS INT64),   m.unsubscribes)   AS unsubscribes,
  COALESCE(CAST(r.spam_complaints AS INT64), m.spam_complaints) AS spam_complaints,
  COALESCE(CAST(r.conversions AS INT64),    m.conversions)    AS conversions,
  COALESCE(r.conversion_value,              m.revenue)        AS revenue,
  -- New fields exposed only via reports endpoint
  r.conversion_rate,
  r.revenue_per_recipient,
  r.average_order_value,
  -- Currency override: Dobias was wrongly tagged CAD in raw; real conversion currency is USD
  CASE
    WHEN m.client_id = 'dobias' THEN 'USD'
    ELSE m.currency
  END AS currency,
  m.payload_json
FROM metadata m
LEFT JOIN reports r USING(client_id, campaign_id);
