CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_sku_inventory` AS
WITH
snapshot AS (
  SELECT
    client_id,
    CASE WHEN client_id = 'venev'
         THEN REGEXP_REPLACE(TRIM(UPPER(sku)), r'A$', '')
         ELSE TRIM(UPPER(REGEXP_REPLACE(sku, r'^DD-', ''))) END AS norm_sku,
    SUM(inventory_quantity)                            AS on_hand,
    MAX(cost)                                          AS unit_cost,
    ANY_VALUE(title)                                   AS product_title,
    LOGICAL_OR(status = 'ACTIVE' OR status = 'active') AS is_active,
    MAX(DATE(ingested_at))                             AS snapshot_date
  FROM `oneeighty-warehouse.stg.stg_shopify_products`
  WHERE sku IS NOT NULL AND sku != ''
  GROUP BY client_id, norm_sku
),
snap_date AS (
  SELECT client_id, MAX(snapshot_date) AS snapshot_date
  FROM snapshot GROUP BY client_id
),
first_sale AS (
  SELECT
    client_id,
    CASE WHEN client_id = 'venev'
         THEN REGEXP_REPLACE(TRIM(UPPER(sku)), r'A$', '')
         ELSE TRIM(UPPER(REGEXP_REPLACE(sku, r'^DD-', ''))) END AS norm_sku,
    MIN(order_date) AS first_order_date
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
  WHERE sku IS NOT NULL AND sku != ''
  GROUP BY client_id, norm_sku
),
sales AS (
  SELECT
    i.client_id,
    CASE WHEN i.client_id = 'venev'
         THEN REGEXP_REPLACE(TRIM(UPPER(i.sku)), r'A$', '')
         ELSE TRIM(UPPER(REGEXP_REPLACE(i.sku, r'^DD-', ''))) END AS norm_sku,
    ANY_VALUE(i.item_name)       AS item_name,
    ANY_VALUE(i.product_line)    AS product_line,
    ANY_VALUE(i.currency)        AS currency,
    SUM(i.quantity)              AS units_90d,
    SUM(i.revenue)               AS revenue_90d,
    SUM(i.margin)                AS margin_90d,
    COUNTIF(i.unit_cost IS NULL) AS lines_without_cost,
    COUNT(*)                     AS lines_total
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items` i
  JOIN snap_date s ON s.client_id = i.client_id
  WHERE i.sku IS NOT NULL AND i.sku != ''
    AND i.order_date > DATE_SUB(s.snapshot_date, INTERVAL 90 DAY)
    AND i.order_date <= s.snapshot_date
  GROUP BY i.client_id, norm_sku
),
combined AS (
  SELECT
    COALESCE(sa.client_id, sn.client_id)                AS client_id,
    COALESCE(sa.norm_sku,  sn.norm_sku)                 AS sku,
    COALESCE(sa.item_name, sn.product_title, 'Unknown') AS item_name,
    sa.product_line,
    sa.currency,
    IFNULL(sa.units_90d,   0)        AS units_90d,
    IFNULL(sa.revenue_90d, 0)        AS revenue_90d,
    sa.margin_90d,
    sn.on_hand,
    sn.unit_cost,
    sn.is_active,
    sn.norm_sku IS NOT NULL          AS in_catalogue,
    IFNULL(sa.lines_without_cost, 0) AS lines_without_cost,
    IFNULL(sa.lines_total, 0)        AS lines_total,
    fs.first_order_date
  FROM sales sa
  FULL OUTER JOIN snapshot sn
    ON sn.client_id = sa.client_id AND sn.norm_sku = sa.norm_sku
  LEFT JOIN first_sale fs
    ON fs.client_id = COALESCE(sa.client_id, sn.client_id)
   AND fs.norm_sku  = COALESCE(sa.norm_sku,  sn.norm_sku)
),
graded AS (
  SELECT
    c.*,
    sd.snapshot_date,
    DATE_DIFF(CURRENT_DATE(), sd.snapshot_date, DAY) AS snapshot_age_days,
    SAFE_DIVIDE(
      SUM(GREATEST(IFNULL(c.margin_90d, 0), 0)) OVER (
        PARTITION BY c.client_id
        ORDER BY GREATEST(IFNULL(c.margin_90d, 0), 0) DESC, c.sku
        ROWS UNBOUNDED PRECEDING
      ),
      NULLIF(SUM(GREATEST(IFNULL(c.margin_90d, 0), 0)) OVER (PARTITION BY c.client_id), 0)
    ) AS cum_contribution_share
  FROM combined c
  JOIN snap_date sd ON sd.client_id = c.client_id
)
SELECT
  client_id, sku, item_name, product_line, currency,
  snapshot_date, snapshot_age_days,
  units_90d, revenue_90d, margin_90d,
  SAFE_DIVIDE(margin_90d, NULLIF(revenue_90d, 0)) AS margin_pct,
  on_hand, unit_cost,
  on_hand * unit_cost                             AS stock_value_at_cost,
  units_90d / 90                                  AS velocity_per_day,
  'calendar_days'                                 AS velocity_basis,
  CASE WHEN units_90d > 0 THEN SAFE_DIVIDE(on_hand, units_90d / 90) ELSE NULL END
                                                  AS days_cover,
  SAFE_DIVIDE(units_90d, NULLIF(units_90d + GREATEST(IFNULL(on_hand, 0), 0), 0))
                                                  AS sell_through_90d,
  CASE
    WHEN units_90d = 0                                               THEN 'D'
    WHEN first_order_date > DATE_SUB(snapshot_date, INTERVAL 56 DAY) THEN 'U'
    WHEN cum_contribution_share IS NULL                              THEN NULL
    WHEN cum_contribution_share <= 0.80                              THEN 'A'
    WHEN cum_contribution_share <= 0.95                              THEN 'B'
    ELSE 'C'
  END                                             AS abc,
  cum_contribution_share,
  unit_cost IS NOT NULL                           AS has_cost,
  IFNULL(on_hand, 0) < 0                          AS negative_stock,
  in_catalogue, is_active, lines_without_cost, lines_total
FROM graded;
