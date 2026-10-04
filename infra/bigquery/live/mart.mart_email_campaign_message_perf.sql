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
WHERE channel = 'email' AND delivered IS NOT NULL;
