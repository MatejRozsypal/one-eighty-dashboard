CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_klaviyo_flow_series` AS
SELECT * EXCEPT(rn) FROM (
  SELECT
    client_id, metric_date, flow_id, flow_message_id,
    COALESCE(send_channel, 'email') AS channel,
    CAST(recipients AS INT64) AS recipients, CAST(delivered AS INT64) AS delivered,
    CAST(opens_unique AS INT64) AS unique_opens, CAST(clicks_unique AS INT64) AS unique_clicks,
    CAST(conversions AS INT64) AS conversions, conversion_value AS revenue,
    CAST(unsubscribes AS INT64) AS unsubscribes, CAST(spam_complaints AS INT64) AS spam_complaints,
    CASE WHEN client_id = 'dobias' THEN 'USD' END AS currency,
    ROW_NUMBER() OVER (PARTITION BY client_id, flow_id, flow_message_id, metric_date ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_klaviyo_flow_series`
  WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;
