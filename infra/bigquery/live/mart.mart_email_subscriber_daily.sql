CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_subscriber_daily` AS
SELECT * EXCEPT(rn) FROM (
  SELECT client_id, metric_date, COALESCE(channel, 'email') AS channel,
    total_subscribers, new_subscribers, exclusions, new_subscribers - exclusions AS net_growth,
    ROW_NUMBER() OVER (PARTITION BY client_id, channel, metric_date ORDER BY ingested_at DESC) AS rn
  FROM `oneeighty-warehouse.raw.raw_klaviyo_subscriber_daily`
  WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;
