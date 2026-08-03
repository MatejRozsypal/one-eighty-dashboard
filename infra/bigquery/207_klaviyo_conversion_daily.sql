-- =============================================================================
-- 207 — Klaviyo daily attributed conversion (Conversion Summary + Flows Conversion).
--
-- CORRECTION: there is NO campaign-series-report endpoint in Klaviyo (404). Series
-- exist only for flows/forms/segments. So daily CAMPAIGN revenue can't come from a
-- series report. Source the daily attributed-revenue charts from metric-aggregates on
-- the conversion metric (Vyfqq8 = Shopify Placed Order) instead — validated live:
--   campaign_daily = (Σ $attributed_channel) − (Σ non-empty $attributed_flow)
--   flow_daily     = Σ non-empty $attributed_flow   (per flow for the flow selector)
-- (the empty $attributed_flow group = campaign + unattributed, so we subtract flows
--  from the message-attributed channel total to isolate campaigns.)
--
-- raw_klaviyo_conversion_daily holds both groupings (dim_type 'channel' | 'flow').
-- Flow VOLUME (emails sent / opens / clicks per day) still comes from flow-series;
-- campaign volume from the campaign message mart (send-date).
-- =============================================================================

CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_klaviyo_conversion_daily` (
  client_id         STRING    NOT NULL,
  ingested_at       TIMESTAMP NOT NULL,
  ingest_source     STRING,
  metric_date       DATE      NOT NULL,
  dim_type          STRING    NOT NULL,   -- 'channel' (=$attributed_channel) | 'flow' (=$attributed_flow)
  dim_value         STRING,               -- e.g. '$email_channel', flow_id, or '' (empty = campaign+unattributed)
  conversion_value  NUMERIC,
  conversions       INT64,
  payload_json      STRING
)
PARTITION BY DATE(ingested_at)
CLUSTER BY client_id, dim_type
OPTIONS (require_partition_filter = TRUE);

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_klaviyo_conversion_daily` AS
SELECT * EXCEPT(rn) FROM (
  SELECT client_id, metric_date, dim_type, dim_value,
    conversion_value, conversions,
    ROW_NUMBER() OVER (
      PARTITION BY client_id, metric_date, dim_type, dim_value ORDER BY ingested_at DESC
    ) AS rn
  FROM `oneeighty-warehouse.raw.raw_klaviyo_conversion_daily`
  WHERE DATE(ingested_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
) WHERE rn = 1;

-- mart_email_daily — Conversion Summary (campaign vs flow revenue/day) + emails sent/day.
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_daily` AS
WITH flow_rev AS (
  SELECT client_id, metric_date, SUM(conversion_value) AS revenue
  FROM `oneeighty-warehouse.stg.stg_klaviyo_conversion_daily`
  WHERE dim_type = 'flow' AND dim_value <> '' GROUP BY 1, 2
),
chan_rev AS (
  SELECT client_id, metric_date, SUM(conversion_value) AS revenue
  FROM `oneeighty-warehouse.stg.stg_klaviyo_conversion_daily`
  WHERE dim_type = 'channel' GROUP BY 1, 2
),
flow_vol AS (
  SELECT client_id, metric_date, SUM(recipients) AS emails_sent,
         SUM(unique_opens) AS unique_opens, SUM(unique_clicks) AS unique_clicks
  FROM `oneeighty-warehouse.stg.stg_klaviyo_flow_series`
  WHERE channel = 'email' GROUP BY 1, 2
),
camp_vol AS (
  SELECT client_id, send_date AS metric_date, SUM(sent) AS emails_sent,
         SUM(unique_opens) AS unique_opens, SUM(unique_clicks) AS unique_clicks
  FROM `oneeighty-warehouse.mart.mart_email_campaign_message_perf` GROUP BY 1, 2
)
SELECT
  fr.client_id, fr.metric_date, 'flow' AS channel,
  fr.revenue, fv.emails_sent, fv.unique_opens, fv.unique_clicks, 'USD' AS currency
FROM flow_rev fr LEFT JOIN flow_vol fv USING (client_id, metric_date)
UNION ALL
SELECT
  cr.client_id, cr.metric_date, 'campaign' AS channel,
  cr.revenue - COALESCE(fr.revenue, 0) AS revenue,
  cv.emails_sent, cv.unique_opens, cv.unique_clicks, 'USD' AS currency
FROM chan_rev cr
LEFT JOIN flow_rev fr USING (client_id, metric_date)
LEFT JOIN camp_vol cv USING (client_id, metric_date);

-- mart_email_flow_daily — Flows Conversion (per-flow daily revenue + volume + name).
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_email_flow_daily` AS
WITH flow_names AS (
  SELECT * EXCEPT(rn) FROM (
    SELECT client_id, flow_id, flow_name, status,
      ROW_NUMBER() OVER (PARTITION BY client_id, flow_id ORDER BY snapshot_date DESC, ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_klaviyo_flows`
    WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  ) WHERE rn = 1
),
rev AS (
  SELECT client_id, metric_date, dim_value AS flow_id, SUM(conversion_value) AS revenue, SUM(conversions) AS conversions
  FROM `oneeighty-warehouse.stg.stg_klaviyo_conversion_daily`
  WHERE dim_type = 'flow' AND dim_value <> '' GROUP BY 1, 2, 3
),
vol AS (
  SELECT client_id, metric_date, flow_id,
         SUM(recipients) AS emails_sent, SUM(unique_opens) AS unique_opens, SUM(unique_clicks) AS unique_clicks
  FROM `oneeighty-warehouse.stg.stg_klaviyo_flow_series`
  WHERE channel = 'email' GROUP BY 1, 2, 3
)
SELECT
  r.client_id, r.metric_date, r.flow_id, n.flow_name, n.status,
  r.revenue, r.conversions,
  v.emails_sent, v.unique_opens, v.unique_clicks, 'USD' AS currency
FROM rev r
LEFT JOIN vol v USING (client_id, metric_date, flow_id)
LEFT JOIN flow_names n USING (client_id, flow_id);
