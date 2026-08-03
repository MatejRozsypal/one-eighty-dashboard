-- =============================================================================
-- 206 — Klaviyo DAILY stg + mart views (date-picker-driven Email dashboard).
-- Sources: raw_klaviyo_campaign_series / _flow_series / _subscriber_daily (205).
--
-- stg: latest snapshot per entity-day (re-pull refreshes a day's still-evolving
--   attribution; ROW_NUMBER by ingested_at DESC). Daily buckets are non-overlapping
--   so the marts SUM across dates safely.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_klaviyo_campaign_series` AS
SELECT * EXCEPT(rn) FROM (
  SELECT
    client_id, metric_date, campaign_id, campaign_message_id,
    COALESCE(send_channel, 'email') AS channel,
    CAST(recipients AS INT64)       AS recipients,
    CAST(delivered AS INT64)        AS delivered,
    CAST(opens_unique AS INT64)     AS unique_opens,
    CAST(clicks_unique AS INT64)    AS unique_clicks,
    CAST(conversions AS INT64)      AS conversions,
    conversion_value                AS revenue,
    CAST(unsubscribes AS INT64)     AS unsubscribes,
    CAST(spam_complaints AS INT64)  AS spam_complaints,
    CASE WHEN client_id = 'dobias' THEN 'USD' END AS currency,
    ROW_NUMBER() OVER (
      PARTITION BY client_id, campaign_id, campaign_message_id, metric_date
      ORDER BY ingested_at DESC
    ) AS rn
  FROM `oneeighty-warehouse.raw.raw_klaviyo_campaign_series`
  WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_klaviyo_flow_series` AS
SELECT * EXCEPT(rn) FROM (
  SELECT
    client_id, metric_date, flow_id, flow_message_id,
    COALESCE(send_channel, 'email') AS channel,
    CAST(recipients AS INT64)       AS recipients,
    CAST(delivered AS INT64)        AS delivered,
    CAST(opens_unique AS INT64)     AS unique_opens,
    CAST(clicks_unique AS INT64)    AS unique_clicks,
    CAST(conversions AS INT64)      AS conversions,
    conversion_value                AS revenue,
    CAST(unsubscribes AS INT64)     AS unsubscribes,
    CAST(spam_complaints AS INT64)  AS spam_complaints,
    CASE WHEN client_id = 'dobias' THEN 'USD' END AS currency,
    ROW_NUMBER() OVER (
      PARTITION BY client_id, flow_id, flow_message_id, metric_date
      ORDER BY ingested_at DESC
    ) AS rn
  FROM `oneeighty-warehouse.raw.raw_klaviyo_flow_series`
  WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

-- Flow name lookup (latest metadata snapshot per flow).
-- =============================================================================
-- mart_email_daily — one row per (client_id, metric_date, channel).
-- Powers Conversion Summary (campaign vs flow daily revenue) + emails-sent/day.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_daily` AS
SELECT
  client_id, metric_date, 'campaign' AS channel,
  SUM(recipients)       AS emails_sent,
  SUM(unique_opens)     AS unique_opens,
  SUM(unique_clicks)    AS unique_clicks,
  SUM(conversions)      AS conversions,
  SUM(revenue)          AS revenue,
  ANY_VALUE(currency)   AS currency
FROM `oneeighty-warehouse.stg.stg_klaviyo_campaign_series`
WHERE channel = 'email'
GROUP BY client_id, metric_date
UNION ALL
SELECT
  client_id, metric_date, 'flow' AS channel,
  SUM(recipients), SUM(unique_opens), SUM(unique_clicks),
  SUM(conversions), SUM(revenue), ANY_VALUE(currency)
FROM `oneeighty-warehouse.stg.stg_klaviyo_flow_series`
WHERE channel = 'email'
GROUP BY client_id, metric_date;

-- =============================================================================
-- mart_email_flow_daily — per (client_id, metric_date, flow). Flow selector + daily line.
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_flow_daily` AS
WITH flow_names AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT client_id, flow_id, flow_name, status,
      ROW_NUMBER() OVER (PARTITION BY client_id, flow_id ORDER BY snapshot_date DESC, ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_klaviyo_flows`
    WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  ) WHERE rn = 1
)
SELECT
  s.client_id, s.metric_date, s.flow_id,
  n.flow_name, n.status,
  SUM(s.recipients)     AS emails_sent,
  SUM(s.unique_opens)   AS unique_opens,
  SUM(s.unique_clicks)  AS unique_clicks,
  SUM(s.conversions)    AS conversions,
  SUM(s.revenue)        AS revenue,
  ANY_VALUE(s.currency) AS currency
FROM `oneeighty-warehouse.stg.stg_klaviyo_flow_series` s
LEFT JOIN flow_names n USING (client_id, flow_id)
WHERE s.channel = 'email'
GROUP BY s.client_id, s.metric_date, s.flow_id, n.flow_name, n.status;

-- =============================================================================
-- mart_email_subscriber_daily — Subscriber Growth (total / new / exclusions per day).
-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_subscriber_daily` AS
SELECT * EXCEPT(rn) FROM (
  SELECT
    client_id, metric_date, COALESCE(channel, 'email') AS channel,
    total_subscribers, new_subscribers, exclusions,
    new_subscribers - exclusions AS net_growth,
    ROW_NUMBER() OVER (
      PARTITION BY client_id, channel, metric_date ORDER BY ingested_at DESC
    ) AS rn
  FROM `oneeighty-warehouse.raw.raw_klaviyo_subscriber_daily`
  WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;
