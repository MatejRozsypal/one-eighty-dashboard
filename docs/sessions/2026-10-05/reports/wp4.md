# WP4 report: customer marts read WooCommerce

Branch `wp4-customer-marts`, commit `7fc3894`. Nothing deployed to prod.

## What changed

| File | Content |
|---|---|
| `infra/bigquery/229_customer_marts_woo.sql` | Ordered migration (not executed). It creates 2 new stg union views, then repoints the 7 marts at them. |
| `infra/bigquery/qa/229_regression.sql` | How the candidates are built (sed recipe plus copies of the 3 dependant views), the zero-diff, reconciliation and determinism queries, and a RESULTS block. |

### Design (W3)
- **`stg.stg_customer_orders`**: one row per order, UNION ALL of Shopify, Shoptet and WooCommerce. Columns: `platform, client_id, order_id, order_date, currency, market_currency, platform_customer_id, customer_email, customer_key = NULLIF(LOWER(TRIM(email)),''), is_returning_customer, revenue, net_sales, shipping, cogs, gross_profit, shipping_country`.
- **`stg.stg_customer_order_items`**: one row per line. Columns: `platform, client_id, order_id, order_date, line_id, item_name, product_key, product_name, revenue, line_cost`.
- **Marts repointed:** `mart_customer_lifetime`, `_cohort_grid`, `_payback`, `_product_steps`, `_daily`, `_market_daily` and `mart_order_gaps`.
- **Not redeployed:** `mart_customer_cohorts`, `mart_first_product_repeat` and `mart_product_journey` read the marts above by name, so they follow automatically.
- **Live names checked in INFORMATION_SCHEMA:** the 8 names in the brief are correct. No other customer or retention mart exists. `mart_customer_daily` and `_market_daily` are not read by any dashboard query.

### Shopify and Shoptet behaviour kept as it was
- Every live quirk is kept:
  - Shoptet revenue is `total_with_vat_czk` (VAT included) and its market is the order currency.
  - Shopify product-steps identity is `COALESCE(customer_id, LOWER(email))` with no date window.
  - The windows stay at 60 months, 24 months for order gaps, and none for product steps.
  - A Shopify order with no cost adds 0 to payback.
- **Shoptet stays out of `mart_customer_daily` and `_market_daily`.** Adding it is not a trivial change: its revenue includes VAT and has no shipping split. It is already logged as P2.
- **One harmonisation, 0 rows affected:** the email key is now `LOWER(TRIM())` everywhere. Before, lifetime, order gaps and Shoptet steps used `LOWER()`. Today no email in any platform has surrounding whitespace, so the output is the same.

### WooCommerce specifics
- **Identity:** `LOWER(TRIM(email))`. Guests are excluded (there are none today).
- **Revenue columns, read by name from `stg_woo_orders`:**
  - `revenue = net_revenue`
  - `net_sales = subtotal_price`
  - `gross_profit = subtotal_price - SUM(stg_woo_order_items.line_cost)`, and NULL when no line has a cost.
  - This follows the coordination note: Customers now matches Snapshot.
- **Payback:** a Woo customer with no costed order gets NULL gross profit, never 0. RawBark payback is therefore NULL, not a fake 0. This rule applies only to Woo, so Shopify and Shoptet stay byte-identical.
- **Product key:** `COALESCE(NULLIF(sku,''), product_id, item_name)`.
  - A `product_id` of '0' or '' counts as missing. This affects 37 Ethia lines for deleted bundles, which carry `product_id = 0`.
  - The display label for each key is its shortest line name. Woo variation lines are named "Parent - attribute", so this is usually the parent product.
- **Market:** `shipping_country`, which holds the billing country.

## Verification (2026-10-04)

**Zero diff for manami, dobias and venev** (TO_JSON_STRING, EXCEPT DISTINCT both directions, `date < CURRENT_DATE()`; multiset compare where rows can repeat):

| View | Rows | Diff |
|---|---|---|
| lifetime | 20,188 | 0 / 0 |
| cohort_grid | 3,472 | 0 / 0 |
| payback | 3,018 | 0 / 0 |
| daily | 2,468 | 0 / 0 |
| market_daily | 4,210 | 0 / 0 |
| order_gaps | 21,368 | 0 / 0 |
| product_steps (materialised snapshots) | 87,460 | 0 / 0 |

**Diffs I saw, explained row by row. None of them comes from 229:**
- **`mart_customer_cohorts`:** every column except two is exact. `avg_orders_per_customer` and `y1_orders_per_customer` (ROUND(AVG(INT64),2)) are off by 0.01 on 1 or 2 rows, always at exact half values (354/240 = 1.475, 324/288 = 1.125).
  - Prod gave both 1.12 and 1.13 for the same row in two queries. This is FLOAT64 summation order, the same class as the RB17 exception, and the view definition is unchanged.
- **Product steps / journey / first product repeat (dobias only):** when the two views are compared inside one large query, 1,255 to 1,434 rows can differ.
  - Cause: `stg_shopify_order_items` picks the product title with `ANY_VALUE(title)`, and 4 of 141 normalised dobias SKUs have several titles (for example HUNT60839 is both "Toy Goose" and "All Natural Canvas Dog Toys").
  - When all of an order's lines have NULL revenue, the product chosen for the order falls back to the alphabetically first name, so it flips between runs.
  - All 1,299 diff orders in the captured run contain such a line.
  - Prod also differed from its own snapshot (12 rows), and prod `first_product_repeat` differed from itself by 80 rows (FLOAT AVG) between two runs.

**Woo reconciliation (W3)**, run on the current stg and again on top of the WP3 candidates:

| Check | Ethia | RawBark |
|---|---|---|
| Lifetime orders = stg orders with email | 1,805 = 1,805 | 50,008 = 50,008 |
| Customers = distinct emails | 1,256 | 14,485 |
| First order date | 2025-03-02 | 2022-10-01 |
| Cohort grid month 0 = cohort size | 0 mismatches | 0 mismatches |
| Revenue: stg = lifetime = grid | 1,881,068 | 89,245,759 |
| 90-day returning share, mart = stg | 50.18% | 86.99% |
| LTV = orders per customer x AOV | 1,498 = 1.437 x 1,042 | 6,162 = 3.452 x 1,785 |
| LTGP | 1,042 (about 70% of LTV) | NULL |
| Payback, 12 months (gp30 / gp90) | 768 / 882 (30-day gross profit is below one AOV, so no per-day inflation) | NULL / NULL |

- `mart_customer_daily` equals `mart_daily_kpis` on every day for orders, revenue, net_sales and new/returning orders: Ethia 461 days, RawBark 1,463 days, 0 diffs.
- **On top of the WP3 candidates (`wp4_w3_*` on `wp3_stg_woo_*`):**
  - All of the checks above pass again.
  - Revenue is Ethia 1,871,143 and RawBark 87,032,746 (lifetime -2.5% for RawBark).
  - `wp4_w3_mart_customer_daily` equals `wp3_mart_daily_kpis` on every day.

**Determinism:** 5 cache-busted runs gave identical FARM_FINGERPRINT(STRING_AGG ordered) for all 12 candidate views. For `first_product_repeat` the FLOAT average is rounded to 9 decimals first.

**Candidates equal the migration file:** all 9 changed views are md5-equal to the file after stripping whitespace and comments.

## mart_qa objects (all views; temporary tables already dropped)
- `wp4_`: `stg_customer_orders`, `stg_customer_order_items`, `mart_customer_lifetime`, `_cohorts`, `_cohort_grid`, `_payback`, `_product_steps`, `_daily`, `_market_daily`, `mart_order_gaps`, `mart_first_product_repeat`, `mart_product_journey`.
- `wp4_w3_`: `stg_customer_orders`, `stg_customer_order_items`, `mart_customer_lifetime`, `_cohort_grid`, `_payback`, `_daily`, `_product_steps`.
- Drop all of them after deploy.

## Ready for prod deploy (owner OK)
1. `228_woo_fee_lines_cogs_null.sql` (WP3) first.
2. `229_customer_marts_woo.sql`, the statements in file order: stg items, stg orders, lifetime, cohort_grid, payback, product_steps, daily, market_daily, order_gaps.
3. Snapshot `base_*_20261005` before the deploy. After it, re-run sections 1 and 2 of `qa/229_regression.sql` against prod.

## Open issues
- RawBark October EUR orders (17) have NULL revenue until WP2 refreshes FX. They count as orders but add no revenue in the customer marts too.
- RawBark has 2 orders with no line items: they are in the lifetime and cohort marts but not in product steps (same rule as Shopify).
- Partial cost coverage: a Woo customer with some costed orders gets a gross profit from those orders only. This is the same as Shopify.

## Requests to orchestrator
1. **Dashboard platform filters (read-only check):** no customer-page query filters by platform or capability. `lib/queries/{lifetime,cohorts,cohortGrid,gaps,repeatTiming,journey}.ts` read by `client_id` (and `currency` = client currency, which is CZK for both Woo clients), so Woo rows appear as soon as 229 is deployed. What can still hide or mislabel them:
   - **WP1:** the nav and capability model must count `woocommerce` as a shop for Customers, Cohorts, Repurchase, Repeat timing and Time between orders.
   - **`lib/queries/orders.ts:32`:** `ShopPlatform = "shopify" | "shoptet"` has no woocommerce. This is the Orders page, not mine. Woo falls through to "country", which is correct.
   - **`lib/queries/health.ts:143`:** only Shopify and Shoptet (WP8).
2. **WP5 (UI):** RawBark LTGP, payback and cohort gross profit are now NULL. Customers (`money(summary.ltgp)`) and Snapshot (`getPayback`) must render the "No cost data" state, not 0.
   - The "36-month window" copy (`customers/page.tsx:96,245`, `cohorts/page.tsx:136,375`, `lib/queries/lifetime.ts:5`) should say 60.
3. **New logged items (not in WP4 scope, would change Shopify output):**
   1. `stg_shopify_order_items` uses `ANY_VALUE(title)`, which makes dobias product names, product steps, journey and first-product-repeat nondeterministic. Fix: a deterministic title pick.
   2. `mart_customer_cohorts` and `mart_first_product_repeat` take AVG over INT64 into FLOAT64. Cast to NUMERIC before AVG so the rounding is stable.
   3. Shopify payback adds 0 for uncosted customers. Dobias has 255 cohort dates and Venev 17 where every customer is uncosted, so the mart shows 0 gross profit instead of NULL.
