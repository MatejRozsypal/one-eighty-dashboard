CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_cm3_monthly` AS
WITH contract AS (
  SELECT client_id, media_channels, contract_start_date
  FROM `oneeighty-warehouse.ref.contracts`
  WHERE valid_from <= CURRENT_DATE()
    AND (valid_to IS NULL OR valid_to >= CURRENT_DATE())
),
shop_monthly AS (
  SELECT
    client_id,
    DATE_TRUNC(order_date, MONTH)              AS month,
    SUM(net_revenue)                           AS revenue_net,
    SUM(cogs_total)                            AS cogs,
    SUM(fulfillment_variable)                  AS fulfillment_variable,
    COUNT(*)                                   AS orders,
    COUNTIF(NOT has_cost_imprint)              AS orders_without_cost_imprint,
    COUNTIF(NOT has_fulfillment_imprint)       AS orders_without_fulfillment_imprint
  FROM `oneeighty-warehouse.stg.stg_woo_orders`
  GROUP BY client_id, month
),
fixed_costs AS (
  SELECT client_id, month, SUM(amount_czk) AS fulfillment_fixed
  FROM `oneeighty-warehouse.ref.client_monthly_costs`
  GROUP BY client_id, month
),
meta_monthly AS (
  SELECT
    m.client_id,
    DATE_TRUNC(m.date_start, MONTH) AS month,
    SUM(m.spend * IF(c.meta_currency = c.currency, NUMERIC '1', COALESCE(fx.rate, NUMERIC '1'))) AS media_spend_meta,
    COUNT(DISTINCT m.date_start) AS meta_spend_days
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` m
  JOIN `oneeighty-warehouse.ref.clients` c ON c.client_id = m.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
    ON fx.from_currency = c.meta_currency AND fx.to_currency = c.currency
   AND fx.month_start = DATE_TRUNC(m.date_start, MONTH)
  GROUP BY m.client_id, month
),
google_monthly AS (
  SELECT
    g.client_id,
    DATE_TRUNC(g.date_start, MONTH) AS month,
    SUM(CAST(g.spend AS NUMERIC) * IF(c.gads_currency = c.currency, NUMERIC '1', COALESCE(fx.rate, NUMERIC '1'))) AS media_spend_google,
    COUNT(DISTINCT g.date_start) AS google_spend_days
  FROM `oneeighty-warehouse.stg.stg_google_ads_campaign_insights` g
  JOIN `oneeighty-warehouse.ref.clients` c ON c.client_id = g.client_id
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
    ON fx.from_currency = c.gads_currency AND fx.to_currency = c.currency
   AND fx.month_start = DATE_TRUNC(g.date_start, MONTH)
  GROUP BY g.client_id, month
),
combined AS (
  SELECT
    s.client_id,
    s.month,
    s.revenue_net,
    s.cogs,
    s.fulfillment_variable,
    COALESCE(f.fulfillment_fixed, 0) AS fulfillment_fixed,
    f.fulfillment_fixed IS NOT NULL  AS has_fixed_costs,
    IF('meta' IN UNNEST(ct.media_channels), COALESCE(mm.media_spend_meta, 0), 0)         AS media_spend_meta,
    IF('google_ads' IN UNNEST(ct.media_channels), COALESCE(gm.media_spend_google, 0), 0) AS media_spend_google,
    s.orders,
    s.orders_without_cost_imprint,
    s.orders_without_fulfillment_imprint,
    GREATEST(
      LEAST(
        DATE_DIFF(LAST_DAY(s.month), s.month, DAY) + 1,
        DATE_DIFF(CURRENT_DATE(), s.month, DAY) + 1
      ) - COALESCE(mm.meta_spend_days, 0),
      0
    ) AS spend_days_missing,
    ct.contract_start_date
  FROM shop_monthly s
  JOIN contract ct USING (client_id)
  LEFT JOIN fixed_costs    f  ON f.client_id  = s.client_id AND f.month  = s.month
  LEFT JOIN meta_monthly   mm ON mm.client_id = s.client_id AND mm.month = s.month
  LEFT JOIN google_monthly gm ON gm.client_id = s.client_id AND gm.month = s.month
)
SELECT
  client_id,
  month,
  revenue_net,
  cogs,
  fulfillment_variable,
  fulfillment_fixed,
  fulfillment_variable + fulfillment_fixed AS fulfillment,
  media_spend_meta,
  media_spend_google,
  media_spend_meta + media_spend_google    AS media_spend,
  revenue_net - cogs
              - (fulfillment_variable + fulfillment_fixed)
              - (media_spend_meta + media_spend_google) AS cm3,
  orders,
  orders_without_cost_imprint,
  spend_days_missing,
  (orders_without_cost_imprint = 0
     AND orders_without_fulfillment_imprint = 0
     AND has_fixed_costs
     AND spend_days_missing = 0) AS is_complete,
  ARRAY_TO_STRING(ARRAY(
    SELECT x FROM UNNEST([
      IF(orders_without_cost_imprint > 0, CONCAT(CAST(orders_without_cost_imprint AS STRING), ' orders without a COGS imprint'), NULL),
      IF(orders_without_fulfillment_imprint > 0, CONCAT(CAST(orders_without_fulfillment_imprint AS STRING), ' orders without a fulfillment imprint'), NULL),
      IF(NOT has_fixed_costs, 'no fixed monthly cost row (storage)', NULL),
      IF(spend_days_missing > 0, CONCAT(CAST(spend_days_missing AS STRING), ' days without Meta spend'), NULL)
    ]) AS x WHERE x IS NOT NULL
  ), '; ') AS incomplete_reason
FROM combined;
