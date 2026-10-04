CREATE OR REPLACE VIEW `oneeighty-warehouse.ops.v_gads_coverage` AS
WITH accounts AS (
  SELECT customer_id, customer_descriptive_name AS account_name, customer_currency_code AS account_currency,
         DATE(_PARTITIONTIME) AS last_transfer_date
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_Customer_*`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY _PARTITIONTIME DESC) = 1
),
stats AS (
  SELECT customer_id, MIN(segments_date) AS first_stats_date, MAX(segments_date) AS last_stats_date
  FROM `oneeighty-warehouse.raw_google_ads.p_ads_CampaignBasicStats_*`
  GROUP BY customer_id
),
reg AS (
  SELECT client_id, has_gads, gads_currency, gads_customer_id
  FROM `oneeighty-warehouse.ref.clients`
  WHERE has_gads OR gads_customer_id IS NOT NULL
)
SELECT
  COALESCE(a.customer_id, r.gads_customer_id) AS customer_id,
  a.account_name, a.account_currency,
  r.client_id, r.has_gads, r.gads_currency,
  a.last_transfer_date,
  DATE_DIFF(CURRENT_DATE(), a.last_transfer_date, DAY) AS days_since_transfer,
  s.first_stats_date, s.last_stats_date,
  CASE
    WHEN a.customer_id IS NULL                                 THEN 'CLIENT_WITHOUT_ACCOUNT: gads_customer_id is not in the transfer (add the account under the MCC or fix the id)'
    WHEN r.client_id IS NULL                                   THEN 'UNMAPPED: set ref.clients.gads_customer_id, has_gads, gads_currency for the client'
    WHEN NOT COALESCE(r.has_gads, FALSE)                       THEN 'NO_FLAG: set ref.clients.has_gads = TRUE'
    WHEN r.gads_currency IS DISTINCT FROM a.account_currency   THEN 'CURRENCY_MISMATCH: ref.clients.gads_currency differs from the account currency'
    WHEN DATE_DIFF(CURRENT_DATE(), a.last_transfer_date, DAY) > 3 THEN 'STALE: transfer has not run for more than 3 days'
    ELSE 'ok'
  END AS status
FROM accounts a
FULL OUTER JOIN reg r ON r.gads_customer_id = a.customer_id
LEFT JOIN stats s ON s.customer_id = COALESCE(a.customer_id, r.gads_customer_id);
