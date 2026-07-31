-- =============================================================================
-- 204 — Klaviyo campaign MESSAGE-level performance (per campaign_message_id)
--
-- Powers the "Campaign message performance detail" table (Klaviyo-style):
-- recipients, delivered, unique opens/clicks, unique orders, revenue, AOV, rev/rec.
--
-- Grain: one row per (client_id, campaign_id, campaign_message_id) = latest report
-- snapshot. Built entirely from data we already store in raw_klaviyo_campaign_reports
-- (no new endpoint needed).
--
-- Phantom-draft filter: campaigns can exist as duplicate/clone/draft objects that
-- never sent (e.g. two "Dandelion" campaign_ids — one sent 44k, one a draft). Those
-- have no report row → delivered IS NULL → excluded in the mart WHERE clause.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_klaviyo_campaign_messages` AS
WITH metadata AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, campaign_id ORDER BY ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_klaviyo_campaigns`
    WHERE DATE(send_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  ) WHERE rn = 1
),
reports AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT *, ROW_NUMBER() OVER (
      PARTITION BY client_id, campaign_id, campaign_message_id ORDER BY ingested_at DESC
    ) AS rn
    FROM `oneeighty-warehouse.raw.raw_klaviyo_campaign_reports`
    WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  ) WHERE rn = 1
)
SELECT
  r.client_id, r.campaign_id, r.campaign_message_id,
  m.campaign_name, m.send_time, DATE(m.send_time) AS send_date, m.status,
  COALESCE(r.send_channel, m.channel) AS channel,
  CAST(r.recipients     AS INT64) AS recipients,
  CAST(r.delivered      AS INT64) AS delivered,
  CAST(r.bounced        AS INT64) AS bounces,
  CAST(r.opens          AS INT64) AS opens,
  CAST(r.opens_unique   AS INT64) AS unique_opens,
  CAST(r.clicks         AS INT64) AS clicks,
  CAST(r.clicks_unique  AS INT64) AS unique_clicks,
  CAST(r.conversions    AS INT64) AS conversions,
  r.conversion_value              AS revenue,
  r.open_rate, r.click_rate, r.conversion_rate,
  r.average_order_value, r.revenue_per_recipient,
  CAST(r.unsubscribes    AS INT64) AS unsubscribes,
  CAST(r.spam_complaints AS INT64) AS spam_complaints,
  -- currency override pending runbook 18 (registry-driven). Dobias Klaviyo = USD.
  CASE WHEN r.client_id = 'dobias' THEN 'USD' ELSE m.currency END AS currency
FROM reports r
LEFT JOIN metadata m USING (client_id, campaign_id);

-- =============================================================================
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_campaign_message_perf` AS
SELECT
  client_id, 'klaviyo' AS platform,
  campaign_id, campaign_message_id, campaign_name,
  send_date, send_time, channel, status,
  recipients AS sent, delivered, bounces,
  unique_opens, opens AS total_opens,
  unique_clicks, clicks AS total_clicks,
  conversions AS unique_orders, revenue,
  SAFE_DIVIDE(unique_opens,  delivered) * 100 AS open_rate_pct,
  SAFE_DIVIDE(unique_clicks, delivered) * 100 AS click_rate_pct,
  SAFE_DIVIDE(conversions,   delivered) * 100 AS order_rate_pct,
  COALESCE(average_order_value,    SAFE_DIVIDE(revenue, conversions)) AS aov,
  COALESCE(revenue_per_recipient,  SAFE_DIVIDE(revenue, recipients))  AS revenue_per_recipient,
  currency
FROM `oneeighty-warehouse.stg.stg_klaviyo_campaign_messages`
WHERE channel = 'email' AND delivered IS NOT NULL;  -- exclude phantom draft/clone objects
