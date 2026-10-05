# WP3 report: Woo revenue definition (fee lines) and honest COGS

Branch `wp3-woo-revenue`, worktree `oe-dash-wt/wp3-woo-revenue`. Commit `785ccfd`.
Nothing was written outside `mart_qa`. No prod object was changed.

## 1. What changed (files)

| File | What |
|---|---|
| `infra/bigquery/228_woo_fee_lines_cogs_null.sql` | Ordered prod migration, not executed: ALTER `ref.product_costs`, then `stg.stg_woo_orders`, `stg.stg_woo_order_items`, `mart.mart_daily_kpis`, `mart.mart_cm3_monthly`. Header: purpose, live base (2026-10-04), affected clients, regression result, deploy order. |
| `infra/bigquery/qa/228_regression.sql` | Candidate build (C1, C2), checks R0 to R7 with the 2026-10-04 results in comments. |
| `METRICS.md` | New subsections under Global conventions > Revenue: "WooCommerce revenue and fee lines" (measurement, definition, effect) and "WooCommerce COGS: no data is NULL, never 0". 6 new rows in Known data gaps. Nothing else touched (no "Last updated"/changelog edit, to avoid merge conflicts with WP4). |

## 2. Measurement and decision

Deduped revenue-bearing Woo orders, last 24 months, fee lines from `payload_json.fee_lines` (ex tax, order currency):

| Client | Orders | Negative fee lines | Positive fee lines |
|---|---|---|---|
| rawbark CZK | 24,654 | 10,633 lines / 8,254 orders / -1,681,114.88 CZK | 4 lines / +2,571.45 CZK ("Granule 10kg" 2,251.70, "Příplatek za 2kg" 265.29, a 1 CZK fee, one positive "Věrnostní sleva bronzová" 53.46) |
| rawbark EUR | 4,184 | 1,679 lines / 1,330 orders / -11,600.44 EUR | 1 line / +86.04 EUR ("PLATBA GRANULÍ OBJ 63726", mirror of a -86.04 "Platba z obj 63698") |
| ethia CZK | 1,804 | 137 lines / 135 orders / -9,925 CZK | none |

Largest rawbark discount names (CZK, 24 m): "Sleva za tlapičky" -729.8k (3,805 lines), "Věrnostní sleva pro chovnou stanici -20%" -323.6k, "Věrnostní sleva bronzová tlapička -3%" -216.8k, "Věrnostní sleva 3% (Bronzová)" -175.1k, "Věrnostní sleva 5% (Stříbrná)" -133.1k, plus ~45 small "Použití N tlapiček" redemptions. Ethia: "Sleva 5 % za balíček" -7,224 (92 lines), "Věrnostní sleva 1 to 5%" the rest.

Data quality of the split: 0 orders with NULL payload, 0 orders where `fees_total` differs from the sum of payload fee lines (all clients, full 60-month window).

**Decision (recorded in METRICS.md):**
- Negative fee lines (`fee_discounts`) reduce net sales (`subtotal_price`) and revenue (`net_revenue`), and are added to `total_discounts`.
- Positive fee lines are `other_charges`, **excluded from revenue**: 4,674 CZK over 24 months on 52.5M CZK RawBark revenue (0.009 %), 0 for Ethia. Immaterial, per the W2 recommendation. Locked rule revenue = net_sales + shipping, ex tax, still holds.
- Fallback when a payload ever lacks `fee_lines`: signed `fees_total` (negative part to discounts, positive part to other_charges).
- `subtotal_price` itself now includes the fee discounts (rather than a new `net_sales` column), so every reader of `stg_woo_orders.subtotal_price` follows automatically: `mart_daily_kpis.net_sales`, `mart_orders.net_sales` and `order_margin`, and WP4's customer marts if they read it.
- New stg columns (appended at the end): `stg_woo_orders.fee_discounts`, `stg_woo_orders.other_charges`, `stg_woo_order_items.fee_discount_alloc`.

Effect on revenue (mart_daily_kpis, candidate vs prod):

| Window | rawbark | ethia |
|---|---|---|
| last 90 days | 5,384,335 to 5,005,243 CZK (-379,092, -7.04 %) | 282,094 to 278,610 (-3,484, -1.24 %) |
| September 2026 | 1,855,848 to 1,732,576 (-6.64 %) | 104,174 to 103,290 (-0.85 %) |
| last 24 months | 54,497,906 to 52,537,722 (-3.60 %) | 1,879,235 to 1,869,378 (-0.52 %) |

(The 90-day figure matches the audit's ~7.5 %; the loyalty programme grew recently, so the 24-month share is lower.)

## 3. Views

- `stg.stg_woo_orders`: new `fees` CTE parses fee lines; changed `subtotal_price`, `total_discounts`, `net_revenue`; added `fee_discounts`, `other_charges`.
- `stg.stg_woo_order_items`: `ok_orders` also reads `fee_discounts`; line share = `total / SUM(total) over order` (equal split if the order's line totals sum to 0); `revenue`, `margin` include the share, `line_discount` adds it; dormant cost join: `unit_cost = COALESCE(woo unit_cost, ref cost)`, `line_cost = COALESCE(woo line_cost, ref cost * quantity)`, match on client + `variation_id` (non-empty, not '0'), else `product_id`, else `sku`, latest `effective_from <= order_date`, ties broken by `updated_at`, `cost`; cost converted with `ref.fx_rates` when its currency differs (NULL when the month's rate is missing, per the locked rule).
- `mart.mart_daily_kpis`: one edit in the Woo branch, `COALESCE(c.cogs, 0) AS cogs` to `c.cogs AS cogs`. Proven byte for byte (R0): MD5 of the 228 body equals MD5 of the live text with exactly that one REPLACE (matched once).
- `mart.mart_cm3_monthly`: one edit, `revenue_net - COALESCE(cogs, 0)` to `revenue_net - cogs`. Same MD5 proof.
- `mart_orders`, `mart_product_perf`, `mart_sku_perf`, `mart_unit_economics`, `mart_monthly_kpis`, `mart_profit_share_monthly`: read the changed columns but need **no text change**; candidates are the live text with refs remapped (MD5 equal to live after mapping back).
- `ref.product_costs`: ALTER adds `product_id STRING, variation_id STRING`. Deviation from the plan's INT64: raw Woo stores both ids as STRING, so STRING avoids casts in the join. Tested on `mart_qa.wp3_product_costs` (copy + the two columns).

## 4. Verification (protocol 5.R), all on 2026-10-04

| Check | Result |
|---|---|
| R0 text identity | Pass (see above). |
| R1 zero diff, all columns, both directions, `date < CURRENT_DATE()` | manami, dobias, venev: **0 rows** in `mart_daily_kpis`, `mart_orders`, `mart_product_perf`, `mart_sku_perf`, `mart_unit_economics`. `mart_monthly_kpis`: dobias 0, venev 0, manami 10/9 rows that differ **only** in FLOAT64 `google_spend`, `google_revenue`, `google_purchases` at 1e-11 (RB17 exception; which months differ changes between runs); with those three columns excluded, 0. `mart_cm3_monthly`, `mart_profit_share_monthly`: 0 rows both sides (`ref.contracts` empty). |
| R2 per-day delta = fee sum, exactly | rawbark: 1,463 days, 0 mismatches on revenue, net_sales, new/returning splits; total delta = total fee = -2,210,991.23265 CZK (60 months); cogs 0 to NULL on all 1,463 days, cm1 to cm3 NULL; all other columns equal. ethia: 516 days (103 with fees), 0 mismatches, -9,857 CZK; cogs unchanged on every day; cm1 delta = fee. |
| R3 order level | `mart_orders`: changed orders = orders with a fee exactly (ethia 134, rawbark 10,938); revenue, net_sales, order_margin delta = fee and total_discounts delta = -fee on every one; no other column changed. Identity `net_revenue + other_charges + total_tax = total_price - total_refunded` within 1 CZK: ethia 1,805/1,805 pass; rawbark 49,903/50,008 pass. The 105 failures all have a Woo payload whose own `total` differs from its line + shipping + fee + tax lines (102 in 2025-11-04..12, net +23,321 CZK; 2 in 2026-03; 1 in 2026-07, -120.54); none has a refund. Pre-existing source issue, not caused by 228. |
| R4 line level | SUM(line revenue) = order `subtotal_price` within 1 CZK: ethia all; rawbark all but 5 orders (72751, 72727, 72972, 70580, 72705: raw lines sum to about 2x the order, same 5 before 228). Allocation error max 7.9e-6 CZK. Every changed line explained (revenue and margin delta = share, line_discount delta = -share). product_perf, sku_perf, unit_economics: 0 days off; units, rows, cost, gross_retail, cogs, orders unchanged. One rawbark fee order (63698, -66.71 CZK credit) has no lines, so its fee stays order-level only. |
| R5 determinism | 5 runs (cache defeated by changing the query text), identical fingerprints for wp3 stg orders, items and daily kpis (google float columns excluded). |
| R6 reconciliation, last 90 days | ethia 278,610.16 vs Woo-totals-based 278,610.16 (0, order by order). rawbark 5,005,242.62 vs 5,005,360.27 (-117.65 CZK, -0.0024 %). Under 2 %. |
| R7 cost join test | Synthetic rows in a temporary `mart_qa.wp3_product_costs_test` (dropped): variation beats product, product beats sku, effective dating switches 50 to 60 at 2026-09-01, EUR cost converted per month (483.58 / 485.08 CZK), NULL for October (no FX yet) and before `effective_from`; no row duplication. |

## 5. mart_qa objects created (all still present except the R7 test pair)

`mart_qa.wp3_product_costs` (table), views `wp3_stg_woo_orders`, `wp3_stg_woo_order_items`, `wp3_mart_daily_kpis`, `wp3_mart_cm3_monthly`, `wp3_mart_orders`, `wp3_mart_product_perf`, `wp3_mart_sku_perf`, `wp3_mart_unit_economics`, `wp3_mart_monthly_kpis`, `wp3_mart_profit_share_monthly`. Created and dropped: `wp3_product_costs_test`, `wp3_stg_woo_order_items_costtest`.

## 6. Ready for prod (owner OK required)

Run `infra/bigquery/228_woo_fee_lines_cogs_null.sql` statements in file order:
1. `ALTER TABLE ref.product_costs ADD COLUMN IF NOT EXISTS product_id STRING, ADD COLUMN IF NOT EXISTS variation_id STRING` (must precede 3, the view references the columns).
2. `CREATE OR REPLACE VIEW stg.stg_woo_orders`
3. `CREATE OR REPLACE VIEW stg.stg_woo_order_items`
4. `CREATE OR REPLACE VIEW mart.mart_daily_kpis`
5. `CREATE OR REPLACE VIEW mart.mart_cm3_monthly`

Before 2: snapshot `mart_qa.base_<view>_20261005` for the 4 views plus `mart_orders`, `mart_product_perf`, `mart_sku_perf`, `mart_unit_economics`, `mart_monthly_kpis`. After 5: re-run R1 to R6 against prod (swap instructions in the regression file header). Then drop `mart_qa.wp3_*`. Note: WP2's live export (`infra/bigquery/live/`) will be stale for these 4 views after deploy; re-export.

## 7. Open issues

- Partial-COGS days: if only some Woo lines of a day are costed, `cogs` sums those lines (as specified: NULL only when no line is costed). Today Ethia is 100 % and RawBark 0 %, so no partial days exist; it will matter when RawBark costs land with an `effective_from`.
- `fulfillment_cost` for Woo is still `SUM(COALESCE(...,0))` = 0 (no imprint on any order), so CM2 = CM1. Same "no data is not zero" problem, out of WP3 scope.
- 105 rawbark orders with an internally inconsistent Woo total, and 5 orders with duplicated raw lines (see R3, R4). Documented in METRICS.md known gaps; the items duplication looks like a feed issue worth a look in `wf_woocommerce`.
- A few negative fee lines are credits for money paid on another order, not discounts (largest -2,523 CZK; the EUR -86.04/+86.04 pair nets revenue down by 86.04 EUR because the + side is other_charges). Accepted as immaterial.

## 8. Requests to orchestrator

**A. Dashboard reads of cogs/CM that break or mislead with NULL cogs (do not edit here; for WP5 or whoever owns these files):**

1. `dashboard/lib/queries/pnl.ts` `sum()` / `aggregate()` (approx. lines 290 to 335): sums cogs and cm1 to cm3 skipping NULL days. For RawBark today every day is NULL, so totals are correctly null. But on a range that mixes costed and NULL days (RawBark once costs start), CM covers only the costed days while revenue covers all, so `cm1Pct`/`cm2Pct`/`cm3Pct` and the CM cards are wrong without any signal. Needs a coverage rule (for example cogs and CM null, or flagged, if any day with revenue has NULL cogs).
2. `dashboard/components/dashboard/MarginStack.tsx:53-55, 71`: `t.cm1 ?? 0`, `t.cm2 ?? 0`, `t.cm3 ?? 0`, `t.cogs ?? 0` drive bar geometry, so RawBark's waterfall draws CM1 to CM3 as zero-height steps under a full revenue bar. Needs the "No cost data" state (P0-3, WP5).
3. `dashboard/app/(app)/snapshot/page.tsx:137-152`: CM3 and CM3 % cards and sparkline. Null-safe (renders the no-value glyph), but should show "No cost data" rather than the generic empty state (WP5).
4. `dashboard/lib/queries/products.ts:68-71, 83`: `acc.margin += num(r.margin) ?? 0`, so RawBark products show margin 0 and margin % 0 % (reads as "zero margin"). Pre-existing (Woo line margin was already NULL), but it is a COGS-null consumer: keep margin null when every row is null.
5. `dashboard/lib/queries/goals.ts:61` (`SUM(cm3)` over `mart_daily_kpis`), `growth.ts:52` and `yoy.ts:107, 156` (`mart_monthly_kpis.cm3`, itself `SUM` of daily cm3): SQL SUM skips NULL days, so a month mixing costed and NULL days gets a partial CM3 with no flag; `yoy.ts:156` also adds up only the non-null months into a yearly CM3. All-NULL months are correctly null.
6. `dashboard/lib/queries/unitEconomics.ts:76-77, 108-127`: `SUM(cogs)`, `SUM(gross_profit)` become NULL for RawBark, so COGS %, Gross profit % and Contribution margin % are null (correct). Same partial-range caveat as 5.
7. `dashboard/lib/queries/orders.ts:131-142`: `margin === 0 ? null` heuristic over `num(...) ?? 0`. Works for RawBark (all NULL), partial-range caveat as 5.
8. `dashboard/components/dashboard/BottomLine.tsx:43, 55`: guarded by null checks, fine.
9. `dashboard/lib/queries/lifetime.ts`, `cohortGrid.ts` (`gross_profit` from customer marts): depends on how WP4 builds Woo COGS; WP4 should also keep Woo cogs NULL, not 0.

**B. Coordination with WP4:** after 228, `stg_woo_orders.subtotal_price` and `net_revenue` include fee discounts and two columns are appended (`fee_discounts`, `other_charges`). WP4 candidates built on current prod `stg.stg_woo_orders` will show a Woo diff once 228 is deployed. Deploy 228 before 229, or have WP4 point its Woo candidates at `mart_qa.wp3_stg_woo_orders` to test the combination. WP4's Woo net sales should read `subtotal_price` (not `subtotal_ex_tax` from raw) so Customers matches Snapshot.

**C. METRICS.md** "Last updated" line and changelog entry were not edited (to avoid conflicts); add one at merge time.
