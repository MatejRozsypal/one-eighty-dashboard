-- 218_mart_sku_inventory.sql
-- =============================================================================
-- Per-SKU inventory health: velocity, days of cover, ABCD grade, sell-through.
--
-- Feeds the Inventory page. The frontend service account (sa-frontend-reader)
-- holds dataViewer on `mart` only, so everything the page needs has to surface
-- here — it cannot read stg or raw itself.
--
-- ── The window, and why it ends at the snapshot rather than today ────────────
-- There is exactly ONE stock snapshot per client in raw_shopify_products
-- (dobias 2026-05-19, venev 2026-08-03) — the products webhook is not
-- appending. Days of cover is stock ÷ velocity, so pairing a May stock level
-- with August velocity produces a ratio whose two halves describe different
-- moments and whose error runs in an unknown direction.
--
-- So the sales window is the 90 days ENDING AT THE SNAPSHOT DATE. The resulting
-- figure is a true statement about a point in the past — "as of 19 May, cover
-- was 14 days" — rather than a false statement about now. `snapshot_date` and
-- `snapshot_age_days` are exposed so the page can say how old that point is,
-- loudly. Once the daily snapshot job lands (runbook 26) this collapses to the
-- ordinary trailing-90-day window and the distinction disappears.
--
-- ── Velocity is NOT yet corrected for stockouts ──────────────────────────────
-- Correct velocity is units ÷ days the SKU was actually in stock, not ÷ calendar
-- days: sales during a stockout are a censored observation of demand, and
-- fitting to them biases demand down, which lowers the reorder, which causes
-- more stockouts (the "spiral-down effect"). We cannot compute days-in-stock
-- without inventory history, which we do not have. `velocity_basis` says
-- 'calendar_days' so the page can flag it rather than imply a precision that
-- isn't there. This is the single strongest reason to start snapshotting.
--
-- ── SKU normalisation mirrors 217 exactly ────────────────────────────────────
-- Venev renumbered its SKUs by appending 'A'; Dobias' catalogue prefixes 'DD-'
-- where its order lines do not. Both sides of every join below use the same
-- CASE as stg_shopify_order_items. If 217's rule changes, this must follow.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_sku_inventory` AS

WITH
-- The stock snapshot. stg_shopify_products already reduces raw to the latest
-- row per variant; we fold variants up to the normalised SKU because that is
-- the grain the order lines join on.
snapshot AS (
  SELECT
    client_id,
    CASE WHEN client_id = 'venev'
         THEN REGEXP_REPLACE(TRIM(UPPER(sku)), r'A$', '')
         ELSE TRIM(UPPER(REGEXP_REPLACE(sku, r'^DD-', ''))) END AS norm_sku,
    SUM(inventory_quantity)                          AS on_hand,
    -- MAX, not ANY_VALUE: where two variants fold together and only one carries
    -- a cost, taking the populated one beats a coin flip.
    MAX(cost)                                        AS unit_cost,
    ANY_VALUE(title)                                 AS product_title,
    LOGICAL_OR(status = 'ACTIVE' OR status = 'active') AS is_active,
    MAX(DATE(ingested_at))                           AS snapshot_date
  FROM `oneeighty-warehouse.stg.stg_shopify_products`
  WHERE sku IS NOT NULL AND sku != ''
  GROUP BY client_id, norm_sku
),

-- One snapshot date per client, so the sales window is client-specific.
snap_date AS (
  SELECT client_id, MAX(snapshot_date) AS snapshot_date
  FROM snapshot
  GROUP BY client_id
),

-- Lifetime first sale per SKU — drives the U grade (<8 weeks of history).
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

-- Sales in the 90 days ending at the client's snapshot date.
sales AS (
  SELECT
    i.client_id,
    CASE WHEN i.client_id = 'venev'
         THEN REGEXP_REPLACE(TRIM(UPPER(i.sku)), r'A$', '')
         ELSE TRIM(UPPER(REGEXP_REPLACE(i.sku, r'^DD-', ''))) END AS norm_sku,
    ANY_VALUE(i.item_name)    AS item_name,
    ANY_VALUE(i.product_line) AS product_line,
    ANY_VALUE(i.currency)     AS currency,
    SUM(i.quantity)           AS units_90d,
    SUM(i.revenue)            AS revenue_90d,
    -- NULL-preserving on purpose. A SKU with no cost must not report a margin
    -- equal to its revenue; 217 established that rule for bundles and the same
    -- reasoning applies here. SUM ignores NULLs, so guard with a coverage flag.
    SUM(i.margin)             AS margin_90d,
    COUNTIF(i.unit_cost IS NULL) AS lines_without_cost,
    COUNT(*)                     AS lines_total
  FROM `oneeighty-warehouse.stg.stg_shopify_order_items` i
  JOIN snap_date s ON s.client_id = i.client_id
  WHERE i.sku IS NOT NULL AND i.sku != ''
    AND i.order_date > DATE_SUB(s.snapshot_date, INTERVAL 90 DAY)
    AND i.order_date <= s.snapshot_date
  GROUP BY i.client_id, norm_sku
),

-- Full outer join: a SKU can have stock and no sales (dead stock — the whole
-- point of the D grade) or sales and no stock row (discontinued, or sold under
-- a SKU that has left the catalogue; dobias has sold 387 SKUs against 215 in
-- the current catalogue).
combined AS (
  SELECT
    COALESCE(sa.client_id, sn.client_id)   AS client_id,
    COALESCE(sa.norm_sku,  sn.norm_sku)    AS sku,
    COALESCE(sa.item_name, sn.product_title, 'Unknown') AS item_name,
    sa.product_line,
    sa.currency,
    IFNULL(sa.units_90d,   0)              AS units_90d,
    IFNULL(sa.revenue_90d, 0)              AS revenue_90d,
    sa.margin_90d,
    sn.on_hand,
    sn.unit_cost,
    sn.is_active,
    sn.norm_sku IS NOT NULL                AS in_catalogue,
    IFNULL(sa.lines_without_cost, 0)       AS lines_without_cost,
    IFNULL(sa.lines_total, 0)              AS lines_total,
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

    -- Cumulative contribution share, for the ABC cutoffs.
    --
    -- Negatives are clamped to zero before accumulating: one loss-making SKU
    -- would otherwise make the running total non-monotonic and shift the grade
    -- of every SKU below it. Ranking still uses the clamped value, so a
    -- loss-maker sorts to the bottom, which is where it belongs.
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
  client_id,
  sku,
  item_name,
  product_line,
  currency,
  snapshot_date,
  snapshot_age_days,

  -- ── Sales ────────────────────────────────────────────────────────────────
  units_90d,
  revenue_90d,
  margin_90d,
  SAFE_DIVIDE(margin_90d, NULLIF(revenue_90d, 0))   AS margin_pct,

  -- ── Stock ────────────────────────────────────────────────────────────────
  on_hand,
  unit_cost,
  on_hand * unit_cost                                AS stock_value_at_cost,

  -- ── Velocity and cover ───────────────────────────────────────────────────
  units_90d / 90                                     AS velocity_per_day,
  'calendar_days'                                    AS velocity_basis,
  CASE
    WHEN units_90d > 0 THEN SAFE_DIVIDE(on_hand, units_90d / 90)
    ELSE NULL  -- no sales: cover is infinite, which is a different statement
  END                                                AS days_cover,

  -- Sell-through, Shopify help-centre form: sold ÷ (sold + still on hand).
  -- Labelled in the UI with both its window and its denominator — five
  -- denominators are in circulation and an unlabelled figure is uninterpretable.
  SAFE_DIVIDE(units_90d, NULLIF(units_90d + GREATEST(IFNULL(on_hand, 0), 0), 0))
                                                     AS sell_through_90d,

  -- ── ABCD grade ───────────────────────────────────────────────────────────
  -- Cumulative cutoffs on contribution: first 80% = A, next 15% = B, rest = C.
  -- D and U are ours; Shopify has neither. See INVENTORY_DESIGN_PROPOSAL §4.1.
  CASE
    WHEN units_90d = 0                                            THEN 'D'
    WHEN first_order_date > DATE_SUB(snapshot_date, INTERVAL 56 DAY) THEN 'U'
    WHEN cum_contribution_share IS NULL                           THEN NULL
    WHEN cum_contribution_share <= 0.80                           THEN 'A'
    WHEN cum_contribution_share <= 0.95                           THEN 'B'
    ELSE 'C'
  END                                                AS abc,
  cum_contribution_share,

  -- ── Data-quality flags ───────────────────────────────────────────────────
  -- Surfaced rather than silently worked around. A SKU failing one of these is
  -- excluded from recommendations by the page instead of being given a wrong
  -- one: 65% of inventory records are inaccurate in the published literature,
  -- and this warehouse already shows negative stock and 57% missing costs.
  unit_cost IS NOT NULL                              AS has_cost,
  IFNULL(on_hand, 0) < 0                             AS negative_stock,
  in_catalogue,
  is_active,
  lines_without_cost,
  lines_total

FROM graded;
