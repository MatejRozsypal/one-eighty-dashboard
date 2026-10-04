CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_campaign_perf` AS
SELECT client_id, 'ecomail' AS platform, campaign_id, title AS campaign_name,
  DATE(sent_at) AS send_date, sent_at,
  inject AS sent, delivery AS delivered, bounce AS bounces,
  open AS unique_opens, total_open AS total_opens, open_rate,
  click AS unique_clicks, total_click AS total_clicks, click_rate,
  unsub AS unsubscribes, spam AS spam_complaints,
  conversions, conversions_value AS revenue,
  SAFE_DIVIDE(open, delivery)  * 100         AS open_rate_pct,
  SAFE_DIVIDE(click, delivery) * 100         AS click_rate_pct,
  SAFE_DIVIDE(conversions, delivery) * 100   AS conversion_rate_pct,
  SAFE_DIVIDE(conversions_value, inject)     AS revenue_per_email,
  currency
FROM `oneeighty-warehouse.stg.stg_ecomail_campaigns`

UNION ALL

SELECT client_id, 'klaviyo' AS platform, campaign_id, campaign_name,
  DATE(send_time) AS send_date, send_time AS sent_at,
  recipients AS sent, delivered, bounces,
  unique_opens, opens AS total_opens, open_rate,
  unique_clicks, clicks AS total_clicks, click_rate,
  unsubscribes, spam_complaints,
  conversions, revenue,
  SAFE_DIVIDE(unique_opens,  delivered) * 100  AS open_rate_pct,
  SAFE_DIVIDE(unique_clicks, delivered) * 100  AS click_rate_pct,
  SAFE_DIVIDE(conversions,   delivered) * 100  AS conversion_rate_pct,
  SAFE_DIVIDE(revenue, recipients)             AS revenue_per_email,
  currency
FROM `oneeighty-warehouse.stg.stg_klaviyo_campaigns`
WHERE channel = 'email';
