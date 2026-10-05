# RawBark COGS v2: per-kg template, findings, SQL sketch

Date 2026-10-04. Read-only BigQuery (`oneeighty-warehouse`), nothing written. All figures from `stg.stg_woo_order_items`, client `rawbark`, `order_date >= 2024-10-04` (partition filter), revenue-bearing orders only.

## Files

- `/Users/matej/Documents/_One Eighty/OE Second Brain/_clients/rawbark/warehouse/rawbark-cogs-template-v2.csv` (47 rows, UTF-8 BOM, sorted by revenue desc, 13 columns as specified)
- `/Users/matej/Documents/_One Eighty/OE Second Brain/_clients/rawbark/warehouse/README-cogs.md` (Czech, no em dash). v1 is untouched.

## 1. Where pack weight lives, and why it must NOT be used per line

Field: `payload_json.meta_data[]` of the Woo line item, entry `key = 'pack_kg'` (string value, e.g. "24"), next to `key = 'dog_meal_type'`. These are the only two whitelisted meta keys. No pack_kg column exists in raw or stg; it has to be parsed out of `payload_json`.

Coverage of the field on granule lines (item_name `Granule na míru%`): 32,056 of 32,062 lines, 46,435,720 of 46,445,766 CZK = **99.98 % of granule revenue**. No line has two pack_kg entries.

But the semantics are not "kg on this line":
- `pack_kg` is the kg of that meal type configured in the order, repeated on every line of that order and meal. Summing it per line double counts (368,842 kg summed per line vs 283,614 kg real).
- Per-line kg is `quantity x pack size in the product name` (4 Kg or 10 Kg balení). Product names are stable per product_id over 24 months.
- Reconciliation of name-derived kg to the `pack_kg` meta (revenue-weighted, 46.4M CZK): line level equal 72.8 %, equal at order+meal level 26.3 %, order level 0.04 %, no pack_kg 0.01 %, **no match 0.84 % (387.7k CZK, 316 lines)**. So the name-derived kg reconciles for 99.1 % of granule revenue.
- Sanity check on price: implied revenue per kg = 163.7 CZK/kg overall (170.6 on line-equal lines, 148.2 on group-equal lines); the unit price falls with the configured total kg (volume tiers), e.g. product 57: qty 1 / 4 kg 821 CZK per unit, pack_kg 24 585 CZK per unit. Treating pack_kg as per-line kg (the v1 reading) gives a nonsense per-kg price that falls with quantity (84, 48, 37 CZK/kg for qty 2, 3, 4), which confirms it is not per line.

So the template uses `kg_sold_24m = units x kg_per_unit` (4 or 10 from the name). Total 283,614 kg; per-kg rows = 12 products, 46.44M of 51.11M CZK (90.9 %).

## 2. Template facts

- 12 `per_kg` rows: products 53 to 60, 61094, 61095, 61200 (beef/lamb), 61201. `variation_attributes` = `dog_meal_type=<meal>; kg_per_unit=<4|10>`.
- 35 `per_unit` rows, including vouchers (README: put 0), and two legacy "Granule na míru" products without size (61: 2 lines, 5,965 CZK, one line has pack_kg 24 and qty 43 which looks like a manual order; 223: 1 line, 139 CZK). Both are `per_unit`; immaterial.
- Total revenue now 51.11M CZK (v1 said 53.04M): the live `stg_woo_order_items` already includes the WP3 fee-line discount allocation (`fee_discount_alloc` column exists), so revenue is net of loyalty discounts. 0 lines with NULL revenue (232 FX rows are in).
- Note on live prod: `ref.product_costs` already has `product_id` and `variation_id` (STRING). Columns: client_id, sku, cost, currency, effective_from are NOT NULL; note, updated_at, product_id, variation_id nullable. 14 rows, all venev. So for product-keyed rows the loader writes `sku = ''` (NOT NULL) and `currency = 'CZK'`.

## 3. Proposed `ref.product_costs` change (not executed)

Keep `cost` as the single NOT NULL figure and reinterpret it by a new `cost_basis`, so existing venev rows stay valid (NULL basis = per_unit):

```sql
ALTER TABLE `oneeighty-warehouse.ref.product_costs`
  ADD COLUMN IF NOT EXISTS cost_basis STRING,      -- 'per_unit' (default when NULL) | 'per_kg'
  ADD COLUMN IF NOT EXISTS packaging_cost NUMERIC; -- per sold unit, optional, ex VAT, same currency as cost
```

Loader mapping from the CSV: per_kg row -> `cost = cost_per_kg_czk_ex_vat`, `cost_basis = 'per_kg'`; per_unit row -> `cost = unit_cost_czk_ex_vat`, `cost_basis = 'per_unit'`; `packaging_cost = packaging_cost_per_unit_czk_ex_vat`; `currency = 'CZK'`; `sku = COALESCE(sku, '')`. Rows with an empty cost are not loaded (stay NULL cogs, per WP3 rule). The key (variation > product > sku, latest `effective_from <= order_date`) is unchanged: per-kg rows are keyed by `product_id`, `variation_id = '0'` (the join already treats '0' as empty).

## 4. SQL sketch (not executed): how the cost is applied

Changes inside the live `stg.stg_woo_order_items` view (the `cost_rows`, `costed` and `priced` CTEs from WP3 228). Everything else is unchanged.

```sql
-- cost_rows: carry the new columns
cost_rows AS (
  SELECT
    pc.client_id,
    NULLIF(NULLIF(TRIM(pc.variation_id), ''), '0') AS variation_key,
    NULLIF(TRIM(pc.product_id), '')                AS product_key,
    NULLIF(TRIM(pc.sku), '')                       AS sku_key,
    pc.cost,
    COALESCE(pc.cost_basis, 'per_unit')            AS cost_basis,
    pc.packaging_cost,
    pc.currency, pc.effective_from, pc.updated_at
  FROM `oneeighty-warehouse.ref.product_costs` pc
),

-- lines: kg carried by the line, from the pack size in the product name
-- ("4 Kg balení", "10 Kg balení"). NOT the pack_kg meta, which is order+meal level.
lines AS (
  SELECT
    i.*, o.currency, o.fx_rate,
    SAFE_CAST(REGEXP_EXTRACT(i.name, r'(\d+)\s*[Kk]g') AS NUMERIC) AS kg_per_unit,
    i.quantity * SAFE_CAST(REGEXP_EXTRACT(i.name, r'(\d+)\s*[Kk]g') AS NUMERIC) AS line_kg
    -- ... fee_alloc as today
  FROM deduped i JOIN ok_orders o USING (client_id, order_id)
),

-- costed: same join and QUALIFY as today; ref cost converted to the order currency
-- (fx exactly as today) into ref_cost, ref_packaging, ref_basis
costed AS (
  SELECT
    l.*,
    cr.cost_basis AS ref_basis,
    cr.cost           * IF(COALESCE(cr.currency, l.currency) = l.currency, CAST(1 AS NUMERIC), fx.rate) AS ref_cost,
    cr.packaging_cost * IF(COALESCE(cr.currency, l.currency) = l.currency, CAST(1 AS NUMERIC), fx.rate) AS ref_packaging
  FROM lines l
  LEFT JOIN cost_rows cr ON /* unchanged join on client, effective_from, variation/product/sku */
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx ON /* unchanged */
  QUALIFY ROW_NUMBER() OVER (/* unchanged */) = 1
),

priced AS (
  SELECT
    c.*,
    c.total * c.fx_rate + c.fee_alloc AS line_revenue,
    -- cogs = kg on the line x cost per kg + packaging per unit; NULL when no data (never 0)
    CASE c.ref_basis
      WHEN 'per_kg'   THEN IF(c.line_kg IS NULL OR c.ref_cost IS NULL, NULL,
                              c.line_kg * c.ref_cost + c.quantity * COALESCE(c.ref_packaging, 0))
      WHEN 'per_unit' THEN IF(c.ref_cost IS NULL, NULL,
                              c.quantity * (c.ref_cost + COALESCE(c.ref_packaging, 0)))
    END AS ref_line_cost
  FROM costed c
)
-- final SELECT:
--   line_cost  = COALESCE(c.line_cost * c.fx_rate, ref_line_cost)      -- Woo-native cost still wins, as today
--   unit_cost  = SAFE_DIVIDE(line_cost, quantity)                       -- per-unit view of the line cost
--   margin     = line_revenue - line_cost
```

Notes on the sketch:
- If a granule line has no parsable kg (products 61, 223, a renamed product) or no cost row, `line_cost` is NULL, so `mart_daily_kpis.cogs` for the day sums only the costed lines (WP3 partial-COGS rule, see its open issue 7.1: needs a coverage flag on the dashboard once RawBark costs land).
- `packaging_cost` empty is treated as 0 (declared optional in the template and README). If that is not acceptable, change `COALESCE(c.ref_packaging, 0)` to NULL propagation.
- Currency: in `stg_woo_orders` the `currency` column is the reporting currency (CZK) and `fx_rate` converts the order currency (EUR orders have fx about 24, CZK orders 1). The CZK cost rows therefore need no conversion, and `ref_line_cost` must NOT be multiplied by `fx_rate` (as in the live COALESCE, only the Woo-native cost is). RawBark EUR orders are costed in CZK per kg like all others.
- Tie-break detail: a `per_kg` row and a `per_unit` row for the same product on the same date would collide in the QUALIFY; the template has one basis per product, and the loader should reject duplicates on (client, product, variation, sku, effective_from).
- Validation to run in `mart_qa` before prod (R7 pattern): fill 2 synthetic per_kg rows (turkey 4 kg / 10 kg product, two effective dates), check line_cost = quantity x kg_per_unit x cost_per_kg exactly, switch at the effective date, NULL before it, no row duplication, zero diff for venev/ethia/manami/dobias.

## 5. Open items / decisions

1. Owner to confirm with RawBark that `pack_kg` is the per-meal total and that the 4 kg / 10 kg in the name is the real bag size. Evidence is strong (99.1 % of granule revenue reconciles) but the 0.84 % non-matching revenue (316 lines) is unexplained.
2. Does the per-kg cost differ by bag size (4 kg vs 10 kg of the same meal)? Template keeps one row per product, so the owner can set the same value on both.
3. Ask the operator whether granule packaging should be per bag (`packaging_cost_per_unit`, as in the template) or already inside the per-kg figure.
4. WP2/WP3 reports described `pack_kg` as the per-line size and the product name as unreliable. The finding above reverses that for the name: name size x quantity is the reliable per-line kg. WP3's note on the key (product/variation/sku cannot express per-kg) is solved by `cost_basis`, no key change needed.
