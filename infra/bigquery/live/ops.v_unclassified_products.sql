CREATE OR REPLACE VIEW `oneeighty-warehouse.ops.v_unclassified_products` AS
WITH lines AS (
  SELECT client_id, order_date,
    NULLIF(TRIM(item_code), '') AS code,
    REGEXP_EXTRACT(NULLIF(TRIM(item_code), ''), r'^[^/]+') AS code_base,
    item_name AS name, revenue_czk AS revenue, 'CZK' AS currency
  FROM `oneeighty-warehouse.stg.stg_shoptet_order_items`
  UNION ALL
  SELECT client_id, order_date, NULLIF(TRIM(sku), ''), NULLIF(TRIM(sku), ''),
    item_name, revenue, currency
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
  UNION ALL
  SELECT client_id, order_date,
    COALESCE(NULLIF(TRIM(sku), ''), NULLIF(NULLIF(variation_id, ''), '0'), NULLIF(product_id, '')),
    COALESCE(NULLIF(TRIM(sku), ''), NULLIF(product_id, '')),
    item_name, revenue, currency
  FROM `oneeighty-warehouse.stg.stg_woo_order_items`
),
grouped AS (
  SELECT client_id, order_date, code, code_base, name, currency,
    COUNT(*) AS n_lines, SUM(revenue) AS revenue
  FROM lines
  WHERE client_id IN (SELECT client_id FROM `oneeighty-warehouse.ref.product_classes`)
  GROUP BY client_id, order_date, code, code_base, name, currency
),
matched AS (
  SELECT g.client_id, g.order_date, g.code, g.code_base, g.name, g.currency, g.n_lines, g.revenue,
    ARRAY_AGG(IF(r.client_id IS NULL, NULL, STRUCT(r.match_type, r.updated_at))
              IGNORE NULLS ORDER BY r.priority LIMIT 1)[SAFE_OFFSET(0)] AS rule
  FROM grouped g
  LEFT JOIN `oneeighty-warehouse.ref.product_classes` r
    ON r.client_id = g.client_id
   AND (r.valid_from IS NULL OR g.order_date >= r.valid_from)
   AND (r.valid_to IS NULL OR g.order_date < r.valid_to)
   AND CASE r.match_type
         WHEN 'code'        THEN g.code = r.pattern
         WHEN 'code_base'   THEN g.code_base = r.pattern
         WHEN 'code_prefix' THEN STARTS_WITH(g.code, r.pattern)
         WHEN 'name_prefix' THEN STARTS_WITH(g.name, r.pattern)
         WHEN 'name_regex'  THEN REGEXP_CONTAINS(g.name, r.pattern)
         WHEN 'default'     THEN TRUE
       END
  GROUP BY g.client_id, g.order_date, g.code, g.code_base, g.name, g.currency, g.n_lines, g.revenue
),
per_code AS (
  SELECT client_id, code,
    ANY_VALUE(code_base) AS code_base,
    ARRAY_AGG(name ORDER BY order_date DESC LIMIT 1)[OFFSET(0)] AS latest_name,
    MIN(order_date) AS first_seen,
    MAX(order_date) AS last_seen,
    SUM(n_lines) AS n_lines,
    SUM(revenue) AS revenue,
    ANY_VALUE(currency) AS currency,
    LOGICAL_OR(rule IS NULL) AS any_no_rule,
    LOGICAL_AND(rule.match_type = 'default') AS default_only,
    MAX(rule.updated_at) AS default_rule_updated_at
  FROM matched
  GROUP BY client_id, code
)
SELECT
  client_id, code, code_base, latest_name,
  IF(any_no_rule, 'no rule', 'default') AS status,
  first_seen, last_seen, n_lines, revenue, currency
FROM per_code
WHERE any_no_rule
   OR (default_only AND first_seen > DATE(default_rule_updated_at));
