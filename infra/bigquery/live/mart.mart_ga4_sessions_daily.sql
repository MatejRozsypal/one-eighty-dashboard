CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_ga4_sessions_daily` AS
WITH s AS (
  SELECT
    t.*,
    c.currency AS client_currency,
    CASE
      WHEN t.revenue IS NULL THEN CAST(NULL AS NUMERIC)
      WHEN t.currency = c.currency THEN t.revenue
      WHEN c.currency = 'USD' THEN t.revenue_usd
      ELSE t.revenue * fx.rate
    END AS revenue_client
  FROM `oneeighty-warehouse.stg.ga4_sessions` t
  JOIN `oneeighty-warehouse.ref.clients` c ON c.client_id = t.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
    ON  fx.month_start   = DATE_TRUNC(t.date, MONTH)
    AND fx.from_currency = t.currency
    AND fx.to_currency   = c.currency
  WHERE t.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH)
)
SELECT
  client_id,
  date,
  IFNULL(channel_group, 'Unattributed')   AS channel_group,
  platform,
  source,
  medium,
  campaign_name,
  landing_path,
  device,
  COUNTIF(session_kind = 'session')                                      AS sessions,
  COUNTIF(session_kind = 'session' AND engaged)                          AS engaged_sessions,
  COUNTIF(session_kind = 'session' AND has_view_item)                    AS sessions_view_item,
  COUNTIF(session_kind = 'session' AND has_add_to_cart)                  AS sessions_atc,
  COUNTIF(session_kind = 'session' AND has_begin_checkout)               AS sessions_checkout,
  COUNTIF(session_kind = 'session' AND has_purchase)                     AS sessions_purchase,
  SUM(purchases)                                                         AS purchases,
  SUM(revenue_client)                                                    AS revenue,
  COUNTIF(purchases > 0 AND revenue_client IS NULL)                      AS sessions_fx_missing,
  ANY_VALUE(client_currency)                                             AS currency
FROM s
GROUP BY client_id, date, channel_group, platform, source, medium, campaign_name, landing_path, device;
