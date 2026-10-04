CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_flow_daily` AS
WITH flow_names AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT client_id, flow_id, flow_name, status,
      ROW_NUMBER() OVER (PARTITION BY client_id, flow_id ORDER BY snapshot_date DESC, ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_klaviyo_flows` WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  ) WHERE rn=1),
rev AS (
  SELECT client_id, metric_date, dim_value AS flow_id, SUM(conversion_value) AS revenue, SUM(conversions) AS conversions
  FROM `oneeighty-warehouse.stg.stg_klaviyo_conversion_daily` WHERE dim_type='flow' AND dim_value<>'' GROUP BY 1,2,3),
vol AS (
  SELECT client_id, metric_date, flow_id, SUM(recipients) AS emails_sent, SUM(unique_opens) AS unique_opens, SUM(unique_clicks) AS unique_clicks
  FROM `oneeighty-warehouse.stg.stg_klaviyo_flow_series` WHERE channel='email' GROUP BY 1,2,3)
SELECT r.client_id, r.metric_date, r.flow_id, n.flow_name, n.status, r.revenue, r.conversions,
  v.emails_sent, v.unique_opens, v.unique_clicks, 'USD' AS currency
FROM rev r LEFT JOIN vol v USING (client_id, metric_date, flow_id) LEFT JOIN flow_names n USING (client_id, flow_id);
