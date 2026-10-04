CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_subscribers` AS
SELECT
  client_id, 'ecomail' AS platform, snapshot_date, list_id, list_name,
  subscribed AS total_subscribers, active_subscribers, unsubscribed,
  hard_bounced + COALESCE(soft_bounced, 0) AS bounced,
  complained AS spam_complained, unconfirmed, currency
FROM `oneeighty-warehouse.stg.stg_ecomail_lists`;
