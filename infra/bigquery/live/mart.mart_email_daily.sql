CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_daily` AS
WITH flow_rev AS (
  SELECT client_id, metric_date, SUM(conversion_value) AS revenue
  FROM `oneeighty-warehouse.stg.stg_klaviyo_conversion_daily` WHERE dim_type='flow' AND dim_value<>'' GROUP BY 1,2),
chan_rev AS (
  SELECT client_id, metric_date, SUM(conversion_value) AS revenue
  FROM `oneeighty-warehouse.stg.stg_klaviyo_conversion_daily` WHERE dim_type='channel' GROUP BY 1,2),
flow_vol AS (
  SELECT client_id, metric_date, SUM(recipients) AS emails_sent, SUM(unique_opens) AS unique_opens, SUM(unique_clicks) AS unique_clicks
  FROM `oneeighty-warehouse.stg.stg_klaviyo_flow_series` WHERE channel='email' GROUP BY 1,2),
camp_vol AS (
  SELECT client_id, send_date AS metric_date, SUM(sent) AS emails_sent, SUM(unique_opens) AS unique_opens, SUM(unique_clicks) AS unique_clicks
  FROM `oneeighty-warehouse.mart.mart_email_campaign_message_perf` GROUP BY 1,2)
SELECT fr.client_id, fr.metric_date, 'flow' AS channel, fr.revenue, fv.emails_sent, fv.unique_opens, fv.unique_clicks, 'USD' AS currency
FROM flow_rev fr LEFT JOIN flow_vol fv USING (client_id, metric_date)
UNION ALL
SELECT cr.client_id, cr.metric_date, 'campaign' AS channel, cr.revenue - COALESCE(fr.revenue,0) AS revenue,
  cv.emails_sent, cv.unique_opens, cv.unique_clicks, 'USD' AS currency
FROM chan_rev cr LEFT JOIN flow_rev fr USING (client_id, metric_date) LEFT JOIN camp_vol cv USING (client_id, metric_date);
