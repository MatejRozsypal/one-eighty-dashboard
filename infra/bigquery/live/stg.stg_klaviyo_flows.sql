CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_klaviyo_flows` AS
WITH latest_per_period AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT *,
      ROW_NUMBER() OVER (
        PARTITION BY client_id, flow_id, flow_message_id, report_timeframe_start, report_timeframe_end
        ORDER BY ingested_at DESC
      ) AS rn
    FROM `oneeighty-warehouse.raw.raw_klaviyo_flow_reports`
    WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  ) WHERE rn = 1
),
flow_totals AS (
  SELECT
    client_id, flow_id,
    SUM(recipients)        AS recipients,
    SUM(delivered)         AS delivered,
    SUM(bounced)           AS bounces,
    SUM(opens)             AS opens,
    SUM(opens_unique)      AS unique_opens,
    SUM(clicks)            AS clicks,
    SUM(clicks_unique)     AS unique_clicks,
    SUM(unsubscribes)      AS unsubscribes,
    SUM(spam_complaints)   AS spam_complaints,
    SUM(conversions)       AS conversions,
    SUM(conversion_value)  AS revenue,
    ANY_VALUE(send_channel) AS send_channel,
    MAX(ingested_at)       AS latest_report_ingested_at
  FROM latest_per_period
  GROUP BY client_id, flow_id
),
metadata AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, flow_id, snapshot_date ORDER BY ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_klaviyo_flows`
    WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  ) WHERE rn = 1
),
metadata_latest AS (
  SELECT * EXCEPT(rn2) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, flow_id ORDER BY snapshot_date DESC) AS rn2
    FROM metadata
  ) WHERE rn2 = 1
)
SELECT
  m.client_id,
  m.ingested_at,
  m.flow_id,
  m.flow_name,
  m.status,
  m.snapshot_date,
  COALESCE(t.send_channel, m.trigger_type)                   AS channel,
  COALESCE(CAST(t.recipients AS INT64),    m.emails_sent)    AS emails_sent,
  COALESCE(CAST(t.delivered AS INT64),     m.delivered)      AS delivered,
  CAST(t.bounces AS INT64)                                   AS bounces,
  COALESCE(CAST(t.opens AS INT64),         m.opens)          AS opens,
  COALESCE(CAST(t.unique_opens AS INT64),  m.unique_opens)   AS unique_opens,
  m.open_rate,
  COALESCE(CAST(t.clicks AS INT64),        m.clicks)         AS clicks,
  COALESCE(CAST(t.unique_clicks AS INT64), m.unique_clicks)  AS unique_clicks,
  m.click_rate,
  CAST(t.unsubscribes AS INT64)                              AS unsubscribes,
  CAST(t.spam_complaints AS INT64)                           AS spam_complaints,
  COALESCE(CAST(t.conversions AS INT64),   m.conversions)    AS conversions,
  COALESCE(t.revenue,                       m.revenue)       AS revenue,
  CASE WHEN m.client_id = 'dobias' THEN 'USD' ELSE m.currency END AS currency,
  t.latest_report_ingested_at,
  m.payload_json
FROM metadata_latest m
LEFT JOIN flow_totals t USING(client_id, flow_id);
