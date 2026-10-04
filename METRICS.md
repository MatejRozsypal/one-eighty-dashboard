# One Eighty Warehouse — Metrics Dictionary

The canonical reference for every metric exposed in the `mart.*` layer. Looker Studio queries mart exclusively, so anything you can put on a dashboard is documented here.

**Update this file whenever:** a new metric lands, a formula changes, a placeholder cost gets wired, or a known data gap is resolved.

**Last updated:** 2026-10-05 (Reporting registry section added: metric ids, ratio recomputation, caveats; WooCommerce fee-line discounts in revenue, Woo COGS NULL when uncosted: migration 228, prepared and not yet deployed; Google Ads columns and `paid_spend` in daily and monthly marts since 2026-10-01)

---

## How to read this doc

Each metric has:
- **Name** — the exact column name in BigQuery
- **Type** — `$` (currency), `count`, `%`, `ratio`, `date`, `string`
- **Formula** — in plain language, with the SQL-level expression
- **Source** — which stg/raw view it derives from
- **Notes** — gotchas, known issues, future plans

---

## Global conventions

### Revenue
- **`revenue` is net sales + shipping income, ex-tax** — i.e., what the customer pays us, minus the part that goes to the tax authority. This is the headline top-line figure.
- `gross_revenue_incl_tax` is also exposed for transparency and for reconciliation against Shopify's "Total sales" view.

#### WooCommerce revenue and fee lines (decided 2026-10-04, migration 228)
WooCommerce orders carry "fee lines" next to product and shipping lines. Both Woo shops use them mostly as discounts (loyalty tiers, "Sleva za tlapičky", "Věrnostní sleva 3/5/8 %", "Sleva 5 % za balíček", paid-from-another-order credits), and only rarely as surcharges. Measured on the deduped, revenue-bearing orders of the last 24 months (amounts ex tax, order currency):

| Client | Negative fee lines (discounts) | Positive fee lines (surcharges) |
|---|---|---|
| rawbark CZK (24,654 orders) | 10,633 lines on 8,254 orders, -1,681,114.88 CZK | 4 lines, +2,571.45 CZK ("Granule 10kg", "Příplatek za 2kg", a 1 CZK fee, one mis-signed loyalty line) |
| rawbark EUR (4,184 orders) | 1,679 lines on 1,330 orders, -11,600.44 EUR | 1 line, +86.04 EUR (a payment moved between two orders) |
| ethia CZK (1,804 orders) | 137 lines on 135 orders, -9,925 CZK | none |

Every order's payload `fee_lines` sums exactly to `fees_total`, so the split is reliable.

Definition (stg.stg_woo_orders, all ex tax, converted to the client currency):
- `fee_discounts` = SUM of negative fee lines (signed, 0 or less). Falls back to `LEAST(fees_total, 0)` if a payload ever has no `fee_lines`.
- `other_charges` = SUM of positive fee lines (0 or more). **Not revenue**: over 24 months it is 4,674 CZK on 52.5M CZK of RawBark revenue (0.009 %) and 0 for Ethia, so it is immaterial. Revisit if it ever passes 0.5 % of revenue in a month.
- `subtotal_price` (net sales) = `subtotal_ex_tax + fee_discounts`. `mart_daily_kpis.net_sales`, `mart_orders.net_sales` and line revenue in `stg_woo_order_items` follow it.
- `net_revenue` (revenue) = `subtotal_ex_tax + fee_discounts + shipping - refunds * net_ratio`. So the locked rule holds: revenue = net sales + shipping, ex tax (Woo also deducts the net part of refunds).
- `total_discounts` = coupon discount + `ABS(fee_discounts)`.
- Order identity: `net_revenue + other_charges + total_tax = total_price - total_refunded`, within 1 CZK. Holds for all 1,805 Ethia orders and for all RawBark orders except 105 whose own Woo payload is internally inconsistent (see known gaps).
- Line level: the order's `fee_discounts` is spread over its lines in proportion to line `total` (equally if the line totals are 0). `stg_woo_order_items.fee_discount_alloc` holds the share; `revenue`, `margin` and `line_discount` include it, so Products reconciles with Snapshot net sales.

Effect vs the previous definition: RawBark revenue -7.0 % over the last 90 days (-379k CZK), -6.6 % in September 2026, -3.6 % over 24 months; Ethia -1.2 % over 90 days, -0.5 % over 24 months. The per-day change equals the per-day fee sum exactly.

#### WooCommerce COGS: no data is NULL, never 0
The Woo branch of `mart_daily_kpis` returns `cogs` = NULL (not 0) on a day where no line has a cost, so `cm1`, `cm2` and `cm3` are NULL too. `mart_cm3_monthly.cm3` is NULL for a month without COGS. Shopify and Shoptet are unchanged. A day where only some lines are costed still sums the costed lines (partial COGS); see known gaps.
Cost sources for Woo lines, in order: the cost stamped on the Woo line (Ethia has it on every line), then `ref.product_costs` matched on client and `variation_id`, else `product_id`, else `sku`, latest `effective_from` on or before the order date, converted with `ref.fx_rates` when the cost currency differs. No Woo client has `ref.product_costs` rows yet.

### Currency
- Shop figures are native per source. Manami operates in **CZK**, Dobias in **USD**.
- Ad spend (Meta, Google) is converted into the client's currency in `mart_daily_kpis` through `ref.fx_rates` when the ad-account currency differs from the client currency (`ref.clients.meta_currency` / `gads_currency`). When they match the rate is 1. A missing rate row makes the spend NULL, so keep `ref.fx_rates` current (runbook 23).
- The 4 stray CAD orders in Dobias data per period are real-presentment CAD orders (not Matrixify ghosts; those are filtered at stg). Trivial volume.
- Cross-client comparison is per-currency (rows carry `currency`).

### Time / dates
- `date` is the order date in **UTC**. Shopify's dashboard uses shop timezone, so date-aligned comparisons can show 14–20 order drift over a month. Documented as a known issue.

### Margin / Contribution Margins
The CM stack is **monotonically non-increasing**: `revenue ≥ CM1 ≥ CM2 ≥ CM3`. See the full breakdown in `mart_daily_kpis` below.

### Percentages
**No CM percentages are pre-computed** in the warehouse. Compute them as Looker calc fields:
- `CM1 % = cm1 / revenue * 100`
- `CM2 % = cm2 / revenue * 100`
- `CM3 % = cm3 / revenue * 100`

Why: avoids dollar/percent dual-field confusion in field pickers, and percentages don't aggregate correctly across rows when pre-computed.

---

## Known data gaps & caveats

| Issue | Impact | Status |
|---|---|---|
| **Refund netting not applied** | Shopify nets returns from net_sales; we don't. Net sales overstated by ~3% on Dobias (~$6k/month). Cascades into CM1/CM2/CM3 by same amount. | P1 — refetch orders with `totalRefundedSet` via Bulk API |
| **New/returning customer flag — 36-month window only** | `is_returning_customer` is derived from order sequence within our 36-month data window. Customers whose first-ever order was BEFORE that window will be flagged "new" on their first in-window order. Shopify uses lifetime history; we underestimate returning by ~50–80 customers/month on Dobias. AOV-new ~$121 vs Shopify ~$110 due to this. | Document only. Deeper backfill = diminishing returns |
| **COGS uses current cost, not cost-at-order** | Shopify snapshots cost at order time; we re-cost from latest products table. ~$4–5k/month drift on Dobias COGS. | Tracked; lower priority |
| **UTC vs shop timezone on order_date** | ~14-order drift per month vs Shopify dashboard | Tracked; low priority |
| **Manami revenue includes VAT** | Shoptet doesn't expose shipping/tax breakdown cleanly. Manami `revenue` ≈ `total_with_vat_czk` (VAT included). | Future Shoptet rework |
| ~~**Klaviyo `delivered` is NULL**~~ | **RESOLVED 2026-05-23.** Wired the `/api/campaign-values-reports/` endpoint with conversion_metric_id = Shopify "Placed Order" (Vyfqq8 for Dobias). 24-month backfill loaded via runbook 15. stg_klaviyo_campaigns JOINs metadata + latest report snapshot. All performance metrics flowing. | ✓ Resolved |
| **Klaviyo ongoing daily sync not wired in n8n** | The 24-month backfill is in BQ but won't refresh automatically. New campaigns and updated conversion stats need the `wf_klaviyo_to_bigquery` workflow to add a campaign-values-reports branch. | Build n8n branch (next workstream) |
| **Dobias Meta spend missing Dec'25 – Mar'26** | aMER NULL for those months in monthly view | Investigate backfill |
| **Cost placeholders** | `cm1_other_costs` (inbound freight + duties + packaging + payment fees) and `fulfillment_cost` (outbound fulfillment + returns) are 0 until data is wired. CM1 = CM2 today. | Roadmap |
| **RawBark has no COGS** | No cost on any Woo line and no `ref.product_costs` rows, so RawBark `cogs`, `cm1`, `cm2`, `cm3` are NULL on every day (since migration 228; before it they were 0 and CM equalled revenue). | Owner sends the cost list; load into `ref.product_costs` keyed by `variation_id` / `product_id` / `sku` |
| **Partial COGS days (Woo)** | If only some lines of a day are costed, `cogs` sums those lines and CM is overstated. Not the case today (Ethia 100 % costed, RawBark 0 %), but it will happen when RawBark costs start at an `effective_from` date, and SUMs over a range that mixes costed and NULL days skip the NULL days. | Watch when RawBark costs land |
| **Woo positive fee lines not in revenue** | `other_charges` (surcharges booked as fee lines) is excluded from revenue: 4,674 CZK over 24 months for RawBark, 0 for Ethia. | Accepted, immaterial |
| **RawBark orders with an inconsistent Woo total** | 105 orders (102 of them 2025-11-04 to 2025-11-12, plus 2 in 2026-03 and 1 in 2026-07) have a Woo `total` that differs from their own line, shipping, fee and tax lines, net +23.5k CZK. Revenue is built from the lines, so these orders fail the identity `net_revenue + other_charges + tax = total - refunds`. Last 90 days: -118 CZK (0.002 %). | Document only |
| **RawBark line items vs order subtotal** | 5 orders (2026-08 to 2026-10) have line items summing to about twice the order subtotal (duplicated lines in `raw_woo_order_items`), and 2 orders have no lines (one carries a -66.71 CZK credit fee). Products revenue for those orders does not reconcile with Snapshot. | Investigate the Woo items feed |
| **Woo fee credits between orders** | A few negative fee lines are credits for money paid on another order ("zaplacena částka z obj …", "Platba z obj …"); they reduce revenue like discounts. Largest is -2,523 CZK. | Accepted |

---

## `mart.mart_daily_kpis`

One row per (`client_id`, `date`, `currency`). The headline daily P&L view. Looker reads this directly for most scorecards.

### Keys
| Column | Type | Notes |
|---|---|---|
| `client_id` | string | `manami` or `dobias` |
| `date` | date | UTC; daily grain |
| `currency` | string | `CZK` (Manami) or `USD` (Dobias). Rare `CAD` rows possible for Dobias. |

### Revenue
| Column | Type | Formula | Notes |
|---|---|---|---|
| `revenue` | $ | Shopify: `SUM(subtotal_price + total_shipping)`. Shoptet: `SUM(total_with_vat_czk)`. | **Top-line, ex-tax.** What customer pays minus tax (Shopify). Shoptet still includes VAT (TODO). |
| `new_customer_revenue` | $ | Same as `revenue` but only orders where `is_returning_customer = FALSE` | "First-time customer revenue" |
| `returning_customer_revenue` | $ | Same as `revenue` but only orders where `is_returning_customer = TRUE` | |
| `net_sales` | $ | Shopify: `SUM(subtotal_price)`. Shoptet: `SUM(product_revenue_czk)`. | Merchandise sales, ex-shipping, ex-tax. Shopify defines net_sales = gross − discounts − returns; we miss the returns netting. **Use this (not `revenue`) for AOV calculations** — shipping inflates cart-size optics. |
| `new_customer_net_sales` | $ | Shopify: `SUM(subtotal_price WHERE NOT is_returning_customer)`. Shoptet: same with `product_revenue_czk`. | First-time-customer merchandise sales, ex-shipping. AOV-new denominator. |
| `returning_customer_net_sales` | $ | `SUM(subtotal_price WHERE is_returning_customer)`. | Repeat-customer merchandise sales, ex-shipping. AOV-returning denominator. |
| `shipping_revenue` | $ | Shopify: `SUM(total_shipping)`. Shoptet: NULL (not separable). | What the customer paid us for shipping. |
| `tax_collected` | $ | Shopify: `SUM(total_tax)`. Shoptet: NULL. | Held separately from revenue. |
| `gross_revenue_incl_tax` | $ | Shopify: `SUM(total_price)`. Shoptet: `SUM(total_with_vat_czk)`. | Includes tax. Use only for reconciliation against Shopify's "Total sales" report. |

### Cost
| Column | Type | Formula | Notes |
|---|---|---|---|
| `cogs` | $ | Shopify: `SUM(line_cost)` from stg_shopify_order_items. Shoptet: `SUM(product_revenue_czk − margin_czk)` (implicit). | Cost of goods sold. ~99.85% line coverage for Dobias. |
| `cm1_other_costs` | $ | **PLACEHOLDER = 0** | Bundles: inbound freight + duties + product packaging + payment processing fees. Populate when data lands. |
| `fulfillment_cost` | $ | **PLACEHOLDER = 0** | Bundles: outbound fulfillment (shipping cost, packaging) + returns processing. |

### Contribution Margin stack
| Column | Type | Formula | Notes |
|---|---|---|---|
| `cm1` | $ | `revenue − cogs − cm1_other_costs` | Gross contribution margin. Product viability. |
| `cm2` | $ | `cm1 − fulfillment_cost` | After-fulfillment margin. == CM1 today (placeholder). |
| `cm3` | $ | `cm2 − paid_spend` | After-marketing margin, net of ALL paid media (Meta + Google). **The live "true ROI of paid acquisition" figure.** Meta-only before 2026-07-03. |

When cost placeholders get populated, CM1/CM2/CM3 update automatically. No formula changes needed.

### Orders
| Column | Type | Formula | Notes |
|---|---|---|---|
| `orders` | count | `COUNT(DISTINCT order_id)` | |
| `unique_customers` | count | `COUNT(DISTINCT customer_email)` per day | Sum across days ≠ true monthly unique. |
| `new_customer_orders` | count | `COUNTIF(NOT is_returning_customer)` | First-time-customer orders (in our 36-month window). Guest orders excluded. |
| `returning_customer_orders` | count | `COUNTIF(is_returning_customer)` | `is_returning_customer` is **DERIVED in stg_shopify_orders** from order sequence by normalized email — NOT from Shopify's flag. See METRICS.md known data gaps. |

### Meta (Facebook/Instagram Ads)
| Column | Type | Formula | Notes |
|---|---|---|---|
| `meta_spend` | $ | `SUM(spend)` from stg_meta_campaign_insights | Dobias Dec'25 – Mar'26 missing (known gap). |
| `meta_revenue` | $ | `SUM(purchase_value)` | Meta's view of attributed purchase revenue. |
| `meta_purchases` | count | `SUM(purchases)` | |
| `meta_impressions` | count | `SUM(impressions)` | |
| `meta_clicks` | count | `SUM(clicks)` | |
| `meta_reach` | count | `SUM(reach)` | |

### Google Ads and blended paid spend
| Column | Type | Formula | Notes |
|---|---|---|---|
| `google_spend` | $ | `SUM(spend)` from stg_google_ads_campaign_insights, converted to client currency | NULL when the client has no Google Ads account. Account to client mapping lives in `ref.clients.gads_customer_id` (one account per client, see runbook 17). |
| `google_revenue` | $ | `SUM(purchase_value)` | Google's view of conversion value. |
| `google_purchases` | count | `SUM(purchases)` | Google conversions. |
| `google_impressions` | count | `SUM(impressions)` | |
| `google_clicks` | count | `SUM(clicks)` | |
| `paid_spend` | $ | `COALESCE(meta_spend,0) + COALESCE(google_spend,0)` | **Denominator for MER, aMER, CAC and CM3.** Meta + Google only; other channels (TikTok, Pinterest, Sklik, Heureka and similar) are not in the warehouse, so paid_spend understates a client that runs them. Equals `meta_spend` for clients without Google. |

All of these columns exist in both `mart_daily_kpis` and `mart_monthly_kpis` (monthly added 2026-10-01).

### Derived ratio metrics — NOT in the warehouse

**All ratio metrics (AOV, CPA, ROAS, MER, aMER, CAC, CTR, CPC, RCR%, CM%) are intentionally omitted from `mart_daily_kpis` and `mart_monthly_kpis`.** Pre-divided per-day ratios aggregate incorrectly across multi-day ranges (you get `AVG(daily_ratio)` instead of `SUM(num) / SUM(denom)`, which can differ by 10–30%).

Build them as Looker calc fields:

### Email rates (mart_email_campaign_perf, mart_email_flow_perf)
| Metric | Looker calc field formula |
|---|---|
| **Open Rate %** | `SUM(unique_opens) / SUM(delivered) * 100` |
| **Click Rate %** | `SUM(unique_clicks) / SUM(delivered) * 100` |
| **Conversion Rate %** | `SUM(conversions) / SUM(delivered) * 100` |
| **Revenue per email** | `SUM(revenue) / SUM(sent)` |
| **AOV per conversion** | `SUM(revenue) / SUM(conversions)` |

Bind scorecards to `unique_opens` (industry standard "Opens") or `total_opens` (includes repeat opens by same recipient), NOT `opens` (doesn't exist in mart).

### Shop / acquisition
| Metric | Looker calc field formula |
|---|---|
| **`AOV`** | **`SUM(net_sales) / SUM(orders)`** ← canonical: cart-size, ex-shipping ex-tax. Matches Shopify. |
| **`AOV new`** | **`SUM(new_customer_net_sales) / SUM(new_customer_orders)`** |
| **`AOV returning`** | **`SUM(returning_customer_net_sales) / SUM(returning_customer_orders)`** |
| `AOV (incl shipping)` | `SUM(revenue) / SUM(orders)` — if you specifically want shipping in the numerator. |
| `Avg revenue per order (incl shipping)` | `SUM(revenue) / SUM(orders)` — same; different label for the same number. |
| `Return customer rate (period)` | `SUM(returning_customer_orders) / SUM(orders) * 100` — **misleading. Use cohort_repeat_rate_pct from mart_customer_cohorts instead.** |
| `MER` | `SUM(revenue) / SUM(paid_spend)` (blended: Meta + Google) |
| `aMER` | `SUM(new_customer_revenue) / SUM(paid_spend)` |
| `CAC` | `SUM(paid_spend) / SUM(new_customer_orders)` |
| `Meta ROAS` | `SUM(meta_revenue) / SUM(meta_spend)` |
| `Meta CTR %` | `SUM(meta_clicks) / SUM(meta_impressions) * 100` |
| `Meta CPC` | `SUM(meta_spend) / SUM(meta_clicks)` |
| `Meta CPA` | `SUM(meta_spend) / SUM(meta_purchases)` |
| `CM1 %` | `SUM(cm1) / SUM(revenue) * 100` |
| `CM2 %` | `SUM(cm2) / SUM(revenue) * 100` |
| `CM3 %` | `SUM(cm3) / SUM(revenue) * 100` |
| `EBITDA est. (30% OpEx)` | `SUM(cm3) - SUM(revenue) * 0.30` |
| `EBITDA % (30% OpEx)` | `(SUM(cm3) - SUM(revenue) * 0.30) / SUM(revenue) * 100` |

---

## `mart.mart_monthly_kpis`

Monthly rollup of `mart_daily_kpis`. One row per (`client_id`, `month_start`, `currency`).

**Inherits everything from `mart_daily_kpis`** (column-for-column SUM, including `google_*` and `paid_spend` since 2026-10-01), plus:

| Column | Type | Formula | Notes |
|---|---|---|---|
| `month_start` | date | First day of month | |
| `unique_customers_sum_of_daily` | count | `SUM(daily unique_customers)` | Renamed to warn: **not a true monthly unique** (customer ordering on 5 different days counts 5×). For true monthly unique, query mart_orders. |
| `prev_month_new_customer_orders` | count | `LAG(new_customer_orders) OVER (client, currency ORDER BY month)` | |
| `prev_month_new_customer_revenue` | $ | `LAG(new_customer_revenue) OVER (...)` | |
| `prev_month_revenue` | $ | `LAG(revenue) OVER (...)` | |
| `mom_new_customer_orders_pct` | % | `new_customer_orders / prev_month_new_customer_orders − 1` | MoM growth on new customer acquisition. |
| `mom_new_customer_revenue_pct` | % | `new_customer_revenue / prev_month_new_customer_revenue − 1` | |
| `mom_revenue_pct` | % | `revenue / prev_month_revenue − 1` | MoM total revenue growth. |

### CAGR / Avg monthly growth — NOT pre-computed
Depends on selected date range. Compute as needed:
```sql
POWER(
  SAFE_DIVIDE(MAX_BY(new_customer_orders, month_start),
              MIN_BY(new_customer_orders, month_start)),
  1.0 / NULLIF(DATE_DIFF(MAX(month_start), MIN(month_start), MONTH), 0)
) - 1
```
Or as a Looker calc field over visible monthly rows.

---

## `mart.mart_orders`

One row per Shopify order. Order-level grain for filtering by country, customer, financial status.

| Column | Type | Notes |
|---|---|---|
| `client_id`, `date`, `order_id`, `order_number`, `currency`, `customer_email` | — | Identifiers |
| `shipping_country`, `shipping_province` | string | For market segmentation (US/CA/other) |
| `revenue` | $ | `subtotal_price + total_shipping` (same definition as mart_daily_kpis) |
| `net_sales` | $ | `subtotal_price` |
| `shipping_revenue` | $ | `total_shipping` |
| `tax_collected` | $ | `total_tax` |
| `gross_revenue_incl_tax` | $ | `total_price` |
| `total_discounts` | $ | Sum of order and line discounts |
| `financial_status`, `fulfillment_status`, `source_name` | string | For filtering |
| `is_returning_customer` | bool | Per Shopify at order time |
| `cancelled_at`, `processed_at` | timestamp | |

---

## `mart.mart_customer_lifetime`

One row per (`client_id`, `customer_email`, `currency`). A customer who ordered in two currencies (rare) shows as two rows.

| Column | Type | Formula | Notes |
|---|---|---|---|
| `total_orders` | count | All orders for this customer in 36mo window | |
| `lifetime_revenue` | $ | Shopify: `SUM(subtotal_price + total_shipping)`. Shoptet: `SUM(total_with_vat_czk)`. | All orders in our 36mo window. **Grows with cohort age — not comparable across cohorts.** |
| `lifetime_gross_profit` | $ | Manami: `SUM(margin_czk)`. Dobias: `SUM(subtotal − order_cogs)` via order_items JOIN. | NULL for customers with no costed orders (~2%). |
| `y1_orders` / `y1_revenue` / `y1_gross_profit` | count, $, $ | Orders within 365 days of customer's first order. Same metrics as lifetime but maturity-corrected. | **Use for cohort comparisons.** Apples-to-apples across cohorts. |
| `is_y1_complete` | bool | `DATE_DIFF(today, first_order_date, DAY) >= 365` | Filter to TRUE for honest Y1 scorecards (customer has had a full Y1 window). |
| `first_order_date`, `last_order_date` | date | | |
| `days_active` | count | `DATE_DIFF(last, first, DAY)` | |
| `is_returning` | bool | `total_orders > 1` | |
| `aov` | $ | `lifetime_revenue / total_orders` | |
| `avg_margin_per_order` | $ | `lifetime_gross_profit / total_orders` | |

---

## `mart.mart_customer_cohorts`

Per-cohort (first-order month) aggregation. **This is where the true RCR lives.**

| Column | Type | Formula | Notes |
|---|---|---|---|
| `cohort_month` | date | First day of customer's first-order month | |
| `customer_count` | count | Unique customers in this cohort | |
| `cohort_total_revenue` | $ | Sum of lifetime_revenue across cohort | |
| `cohort_total_gross_profit` | $ | Manami only (NULL for Dobias) | |
| `cohort_total_orders` | count | Sum of total_orders across cohort | |
| `ltv` | $ | `AVG(lifetime_revenue)` | Lifetime value, per cohort. |
| `ltgp` | $ | `AVG(lifetime_gross_profit)` | Lifetime gross profit. |
| `avg_orders_per_customer` | ratio | `AVG(total_orders)` | |
| `returning_customers` | count | Customers in cohort with ≥2 orders | |
| **`cohort_repeat_rate_pct`** | % | **`returning_customers / customer_count * 100`** | **True RCR.** Age- and growth-independent. Use this for cohort comparisons. |

---

## `mart.mart_sku_perf` and `mart.mart_product_perf`

SKU-level / product-level performance. One row per (`client_id`, `date`, `sku`/`product`, `currency`).

| Column | Type | Notes |
|---|---|---|
| `sku_name` / `product_name` | string | |
| `variant` / `sku` | string | SKU-level only |
| `product_line` | string | **Dobias only.** `'human'` for H+ supplements, `'canine'` for everything else. NULL for Manami. |
| `units_sold` | count | `SUM(quantity)` |
| `revenue` | $ | Line-level revenue. **For Shopify, this can slightly overstate when order-level discounts present** — about 5% on Dobias. Use mart_daily_kpis for headline GP. |
| `cost` | $ | SKU-level only. Dobias: from cost-matched products. Manami: from Shoptet. |
| `margin` | $ | `revenue − cost`. NULL for unmatched Shopify SKUs. |
| `margin_pct` | % | `margin / revenue * 100` |
| `currency` | string | |

---

## `mart.mart_meta_campaign_perf` and `mart.mart_meta_ad_perf`

One row per (`client_id`, `date`, `campaign` or `ad`). Same columns broadly.

### Aggregatable (sum across rows)
| Column | Type | Notes |
|---|---|---|
| `spend`, `revenue` (= purchase_value), `purchases`, `impressions`, `clicks`, `reach` | numbers | Safe to SUM in Looker. |
| `add_to_cart`, `initiate_checkout`, `landing_page_views`, `link_clicks`, `video_views` | count | Safe to SUM. |
| `video_play_actions`, `video_thruplays` | count | mart_meta_ad_perf only. |
| `frequency` | ratio | Meta-computed. |

### Per-day pre-divided — DO NOT SUM in Looker
Meta API returns these already divided per day per entity. **Use the underlying sums and re-aggregate in Looker** instead of binding scorecards to these fields with SUM:
| Column | Per-day formula | Looker re-aggregation |
|---|---|---|
| `ctr_per_day` | clicks / impressions | `SUM(clicks) / SUM(impressions) * 100` |
| `cpc_per_day` | spend / clicks | `SUM(spend) / SUM(clicks)` |
| `roas_per_day` | purchase_value / spend | `SUM(revenue) / SUM(spend)` |
| `cost_per_purchase_per_day` | spend / purchases | `SUM(spend) / SUM(purchases)` |
| `aov_meta_per_day` | purchase_value / purchases | `SUM(revenue) / SUM(purchases)` |
| `frequency_per_day` | impressions / reach (daily) | **Period frequency CANNOT be cleanly reaggregated** — see note below |

### Frequency is special — read this

`frequency` is impressions / unique-reach. **You can't reaggregate it from daily rows** because:
- Impressions ARE summable across days
- Reach is NOT summable — same user reached across multiple days would be counted multiple times
- Meta's Ads Manager dashboard pulls period-level unique reach from their server when you select a date range; we only have daily reach

Best approximation calc field for Looker:
```
SUM(impressions) / MAX(reach) AS approx_period_frequency
```
This UNDERSTATES the true period frequency slightly (because period reach typically > any single day's reach). Acceptable proxy for a single ad/campaign; gets worse the longer the period.

For an exact match to Meta's Ads Manager frequency, the only path is a separate Meta API call with the period as the time range (`time_range={since:X, until:Y}` without `time_increment=1`). Not currently done in `wf_meta_ads_to_bigquery`.

The `_per_day` suffix is a warning label: never sum or average these across rows.

---

## `mart.mart_email_campaign_perf` and `mart.mart_email_flow_perf`

Unified Ecomail (Manami) + Klaviyo (Dobias) email metrics. One row per campaign (or per-flow per-snapshot).

| Column | Type | Formula | Notes |
|---|---|---|---|
| `platform` | string | `ecomail` or `klaviyo` | |
| `campaign_name` / `flow_name`, `sent_at` / `send_date` | — | | |
| `sent`, `delivered`, `bounces` | count | | Klaviyo: populated via `raw_klaviyo_campaign_reports` JOIN in stg (resolved 2026-05-23). |
| `unique_opens`, `total_opens`, `unique_clicks`, `total_clicks` | count | | |
| `unsubscribes`, `spam_complaints` | count | | |
| `conversions`, `revenue` | count, $ | | |
| `open_rate_pct` | % | `unique_opens / delivered * 100` | True unique open rate. |
| **`click_rate_pct`** | % | **`unique_clicks / delivered * 100`** | **True click rate.** NOT click-to-open rate (CTOR). |
| `conversion_rate_pct` | % | `conversions / delivered * 100` | |
| `revenue_per_email` | $ | `revenue / sent` | |

---

## `mart.mart_email_subscribers`

Ecomail-only subscriber counts. One row per (list, snapshot_date).

| Column | Type | Notes |
|---|---|---|
| `total_subscribers`, `active_subscribers`, `unsubscribed`, `bounced`, `spam_complained`, `unconfirmed` | counts | |

---

## Reporting registry

The Reports product (`/reports`) does not read pre-computed metrics. It reads a **metric registry**
in the dashboard code (`dashboard/lib/reports/registry/`) that defines each metric from summed
warehouse components. This section is the warehouse-side contract of that registry. Status
2026-10-05: Reports is in progress and not deployed; phase 1 reads only `mart.mart_daily_kpis`.
Once `registry/metrics.ts` is merged it is the source of truth for the formulas, and this section
must be kept in step with it.

### Metric ids are a permanent contract

A metric id (for example `mer`, `cm3_pct`, `meta_cpm`) is stored in three places that outlive any
code change: saved report configs in Postgres, `ref.industry_benchmarks.metric_id`, and
bookmarked URLs. Therefore:

- **Append only.** Never reorder, remove or rename an id (`registry/ids.ts`).
- A rename adds the new id and keeps the old one as a deprecated alias. The old id keeps working.
- A metric whose definition changes in meaning gets a NEW id. Changing what `mer` means would
  silently change every saved report and every benchmark comparison.
- Phase 1 has 30 ids. Five more are reserved for phase 2 (`email_revenue`, `email_open_rate`,
  `email_click_rate`, `email_rev_per_email`, `meta_atc_rate`) and become queryable when their
  mart is wired into the compiler.

### Ratios are recomputed, never averaged

Every ratio metric is built from two sums, over whatever the widget shows: one day, a week bucket,
a month bucket, a whole range, one client, or several clients combined.

```
metric = SUM(numerator components) / SUM(denominator components)
```

- Nothing pre-divided is read: no `*_per_day` column, no per-day ratio. Averaging daily ratios
  gives the wrong answer (this file, "Derived ratio metrics").
- **Across clients**, each client's money is converted to the display currency first (default
  CZK) using `ref.fx_rates` for the month of the bucket, then summed, then divided. A combined MER
  is total revenue over total paid spend, not the mean of client MERs.
- **A missing FX rate** makes that bucket NULL (status `fx_missing`), never 0 and never a partial
  sum. The widget names the months.
- **Gaps are NULL, never 0.** A client without a connected source is excluded from that metric
  and the widget shows coverage ("1 of 2 clients"), instead of dragging the figure to zero.
- **Deltas**: relative change for money, ratio and count metrics; percentage points for percent
  metrics.
- A bucket that is not finished (the current week or month) is marked partial.

### Components and metric definitions (phase 1)

Components are `mart_daily_kpis` columns, summed. Metrics:

| Group | Metric id | Definition |
|---|---|---|
| Profitability | `revenue`, `net_sales`, `orders`, `cogs` | Sum of the column of the same name. |
| | `aov` | `net_sales / orders` (ex shipping, ex tax; same as the canonical AOV above). |
| | `cm1_pct` | `(revenue - cogs) / revenue`. |
| | `cm3` | `revenue - cogs - fulfillment_cost - paid_spend`, the mart definition. A NULL `paid_spend` or `fulfillment_cost` counts as 0 here, as in the mart. |
| | `cm3_pct` | `cm3 / revenue`. |
| Acquisition | `paid_spend` | Sum (Meta + Google). |
| | `mer` | `revenue / paid_spend`. Low-volume guard: hidden when spend is under 2 % of the largest spend in the range. |
| | `amer` | `new_customer_revenue / paid_spend`. |
| | `cac` | `paid_spend / new_customer_orders`. |
| | `new_customers` | Sum of `new_customer_orders`. |
| | `aov_new` | `new_customer_net_sales / new_customer_orders`. |
| | `new_revenue_share` | `new_customer_revenue / revenue`. |
| Retention | `returning_orders` | Sum of `returning_customer_orders`. |
| (period based) | `returning_order_share` | `returning_customer_orders / orders`. A period share, NOT a cohort repeat rate. |
| | `returning_revenue_share` | `returning_customer_revenue / revenue`. |
| | `aov_returning` | `returning_customer_net_sales / returning_customer_orders`. |
| Meta | `meta_spend` | Sum, client currency. |
| | `meta_roas` | `meta_revenue / meta_spend` (same low-volume guard as MER). |
| | `meta_ctr` | `meta_clicks / meta_impressions`. |
| | `meta_cpc` | `meta_spend / meta_clicks`. |
| | `meta_cpm` | `meta_spend / meta_impressions * 1000`. |
| | `meta_cpa` | `meta_spend / meta_purchases`. |
| | `meta_spend_share` | `meta_spend / paid_spend`. |
| Google | `google_spend` | Sum. |
| | `google_roas` | `google_revenue / google_spend`. |
| | `google_ctr` | `google_clicks / google_impressions`. |
| | `google_cpc` | `google_spend / google_clicks`. |

Deliberately NOT read from the mart: `unique_customers` (a sum over days is not a unique count),
the `*_per_day` and `frequency_per_day` fields (already divided), the mart's `cm1`, `cm2`, `cm3`
(CM3 is rebuilt from components so the COGS guard below applies), and `mart_email_flow_perf`
(cumulative snapshots, unsafe over a period).

The mart's `cm1` is `revenue - cogs - 0`: `cm1_other_costs` is not a column, it is a hard-coded
0 in the view (checked 2026-10-05). `cm1_pct` and `cm3` match the mart because of that. If
`cm1_other_costs` is ever wired, the registry must add it as a component in the same change.

### Caveats (shown with a `^` marker, detail on hover)

Computed per client from registry fields, never from a hardcoded client id:

| Caveat | When it applies |
|---|---|
| Revenue incl. VAT | Shoptet clients (Manami). Flagged only, not estimated ex VAT (owner decision). |
| Refunds not netted | Shopify clients (see Known data gaps). |
| Meta not connected, spend is Google only | Client has Google Ads but no Meta (RawBark): MER, aMER, CAC and CM3 cover Google spend only. |
| All Google conversion actions | Google ROAS: `purchase_value` counts every conversion action. |
| Platform-attributed | Meta and Google ROAS, CPA, email: the platform's own attribution. |
| New vs returning within history window | Everything built from new or returning orders (36-month window, see Known data gaps). |
| Order share, not cohort repeat rate | `returning_order_share`. |
| Foreign currency rows | A foreign-currency row was converted with the monthly rate. |

The former "Woo fee lines not netted" caveat no longer applies since migration 228 (fee-line
discounts are netted); its id stays reserved because ids are append-only.

### Statuses a cell can have

| Status | Meaning | Shown as |
|---|---|---|
| ok | A value. | The number. |
| not_connected | The client has no source for the metric (for example RawBark has no Meta). | Not connected |
| fx_missing | A needed `ref.fx_rates` month is missing. | No FX |
| not_measured | Revenue exists but no cost data: summed `cogs` is NULL on positive revenue (RawBark, since migration 228). Applies to `cogs`, `cm1_pct`, `cm3`, `cm3_pct`. | No cost data |
| no_data | Connected, but no rows in the range. | No data |

The no-value glyph in the UI is `n/a`. A NULL is never shown as 0.

### Benchmarks

Benchmarks are manual reference data (`ref.industry_benchmarks`, `ref.client_verticals`), only
for metrics flagged `benchmarkable` in the registry, and always shown with source and as-of date.
Units: percents as fractions, ratios as x, money in the row's currency (converted to the display
currency with the FX rate of the benchmark period's month). How to add rows and the rules
(never invent values): `runbooks/31_reporting_benchmarks.md`. Definitions differ between sources
and ours (VAT, blended or per-channel, attribution), which is why each row carries a
`definition_note`.

### Known limits of cross-client reports

- Manami revenue includes VAT; comparing it with ex-VAT clients overstates it.
- RawBark has no COGS (CM metrics show "No cost data") and no Meta (Google-only paid spend).
- Dobias Meta spend is missing Dec 2025 to Mar 2026 (aMER and CAC are NULL there).
- Money in a report in another currency than the client's is converted per month; a month without
  a rate is dropped from the result, not guessed (runbook 23).
- Ad accounts outside Meta and Google (TikTok, Sklik, Heureka and similar) are not in `paid_spend`.

---

## Looker Studio calc fields (add these on the data source)

### Margin percentages
- **CM1 %** → `SUM(cm1) / SUM(revenue) * 100`
- **CM2 %** → `SUM(cm2) / SUM(revenue) * 100`
- **CM3 %** → `SUM(cm3) / SUM(revenue) * 100`

### Profitability estimates
- **EBITDA estimate (30% OpEx)** → `SUM(cm3) - SUM(revenue) * 0.30`
- **EBITDA % (30% OpEx)** → `(SUM(cm3) - SUM(revenue) * 0.30) / SUM(revenue) * 100`

### Order economics
- **AOV (correct, weighted)** → `SUM(revenue) / SUM(orders)`
- **Shopify-style AOV** (if matching their dashboard) → `SUM(net_sales) / SUM(orders)`

### Marketing efficiency (re-aggregated, correct across periods)
- **MER** → `SUM(revenue) / SUM(paid_spend)`
- **aMER** → `SUM(new_customer_revenue) / SUM(paid_spend)`
- **CAC** → `SUM(paid_spend) / SUM(new_customer_orders)`
- Add `Google ROAS` = `SUM(google_revenue) / SUM(google_spend)` and `Google CPA` = `SUM(google_spend) / SUM(google_purchases)` as channel diagnostics next to the Meta ones.
- **Meta CTR** → `SUM(meta_clicks) / SUM(meta_impressions) * 100`
- **Meta CPC** → `SUM(meta_spend) / SUM(meta_clicks)`
- **Meta ROAS** → `SUM(meta_revenue) / SUM(meta_spend)`

Always re-aggregate from sums; never SUM or AVG a pre-computed ratio.

---

## Changelog (most recent first)

### 2026-10-05 (amendment 19): Reporting registry section

Documentation only, no warehouse change. New section "Reporting registry" records the contract of the Reports metric registry: ids are permanent and append-only, ratios are recomputed from summed components (also across clients, with per-month FX), gaps are NULL, cell statuses, caveats. Benchmarks are in `runbooks/31_reporting_benchmarks.md`.

### 2026-10-05 (amendment 18): WooCommerce fee lines and honest COGS (migration 228, not yet deployed)

1. **Fee-line discounts reduce Woo revenue.** `stg_woo_orders.subtotal_price` (net sales) and `net_revenue` now include the negative fee lines (loyalty and bundle discounts). Positive fee lines are exposed as `other_charges` and stay out of revenue (0.009 % of RawBark revenue over 24 months). New columns `fee_discounts`, `other_charges`, and `stg_woo_order_items.fee_discount_alloc`. Effect: RawBark revenue about -7.0 % over 90 days, Ethia about -1.2 %. Shopify and Shoptet clients: zero diff. Details under Global conventions, Revenue.
2. **Woo COGS is NULL, never 0, when no line is costed.** `mart_daily_kpis` and `mart_cm3_monthly` no longer coalesce Woo `cogs` to 0, so RawBark `cogs`, `cm1`, `cm2`, `cm3` are NULL until costs exist. Dormant cost join from `ref.product_costs` (client, `variation_id` / `product_id` / `sku`, effective-dated) picks them up when rows are loaded.
3. **Dashboard reads (frontend, same sprint).** A range with revenue and any day without COGS shows COGS, CM1 to CM3 and their percentages as "No cost data" instead of a partial sum. A month that mixes costed and uncosted days cannot be detected in the monthly mart, see Known data gaps.
4. **2026-10-01 (recorded here, was missing):** Google Ads columns and `paid_spend` in `mart_daily_kpis` and `mart_monthly_kpis`; MER, aMER, CAC and CM3 divide by `paid_spend`.

### 2026-05-25 (amendment 17) — CA store history unlocked + USD conversion

Major correction to two prior decisions:

1. **The Matrixify-filter hypothesis was wrong.** Those 48k orders are real Canadian-store historical data migrated to the US Shopify store in March 2026 via the Matrixify app — NOT duplicates. Earlier we filtered them out as "ghost orders"; that lost ~$8.7M CAD of legitimate historical revenue and ~12k unique CA customers.

2. **`order_date` semantics fixed.** Used to be DATE(created_at), which for migrated orders was the import date (March 2026). Now DATE(processed_at) — the original order placement timestamp. CA orders correctly distributed across their original months going back to 2013.

3. **USD conversion live.** New `ref.fx_rates` table (CAD→USD monthly rates from Bank of Canada, June 2022 – May 2026). `stg_shopify_orders` joins on order month and applies conversion. Primary amount columns (subtotal_price, total_shipping, total_tax, total_price) are now USD. Native-currency values preserved in `*_original` columns.

4. **New `store_origin` dimension** in stg_shopify_orders and stg_shopify_order_items: `'canada_migrated'` (Matrixify orders) or `'us_native'`. Lets Looker filter to "pre-merger CA business" vs "US-store business" if needed.

5. **`currency` column now always returns `'USD'`** for Dobias (post-conversion). For Manami stays `'CZK'` (no conversion needed, single-currency store).

### What this means in Looker
- All existing scorecards bound to `revenue`, `net_sales`, `total_price`, `subtotal_price`, `cm1/cm2/cm3` will auto-update to USD-converted values
- Historical periods now show combined CA + US business — Y/Y comparisons are now meaningful
- Number of Dobias orders in mart roughly doubles (we got back the ~48k CA history)
- Add `store_origin` as a chart dimension or page filter to split CA-migrated vs US-native

### Updated quarterly revenue (Dobias, USD-converted)
| Quarter | Revenue | CM1 | Orders |
|---|---:|---:|---:|
| 2026 Q2 (partial) | $420k | $337k | 2,777 |
| 2026 Q1 (migration) | $498k | $401k | 3,461 |
| 2025 Q4 | $681k | $541k | 4,595 |
| 2024 Q4 (peak) | $707k | $574k | 4,295 |
| 2023 Q3 (early CA) | $133k | $106k | 985 |

### Known coverage limit
~34k orders pre-June 2022 (going back to Dec 2013) are in raw but have NULL USD-converted columns because `ref.fx_rates` starts June 2022. These are outside our 36-month analytics window so they don't surface in mart anyway. If you want to use pre-2022 history, add FX rates back to that period in `ref.fx_rates`.

### 2026-05-23 (amendment 16)
- **Y1 LTGP / LTV added** to `mart_customer_lifetime` and `mart_customer_cohorts`. Maturity-corrected: each customer's value within 365 days of their first order, comparable across cohorts.
- New columns in `mart_customer_lifetime`: `y1_orders`, `y1_revenue`, `y1_gross_profit`, `is_y1_complete` (BOOL).
- New columns in `mart_customer_cohorts`: `y1_complete_customers`, `y1_ltv`, `y1_ltgp`, `y1_orders_per_customer`.
- **Use Y1 metrics for cohort comparisons** — eliminates the "older cohorts have higher lifetime LTV simply because they've had more time" trap. Filter to `is_y1_complete = TRUE` for honest scorecards.
- Striking finding: Dobias Y1 LTGP dropped from $551 (May 2024 cohort) to $170–$212 (last year's cohorts). Real signal — could indicate channel mix decline or first-year seasonality.

### 2026-05-23 (amendment 15)
- **Dobias product_line dimension added** to `stg_shopify_order_items`, `mart_sku_perf`, `mart_product_perf`. Classifier: regex `' H\+'` in product/line-item title → `'human'`; everything else for Dobias → `'canine'`. Manami/Shoptet → NULL (no line concept).
- Dobias 30d split: Canine 26 products / $169,576 revenue / 80.7% margin; Human 7 products / $35,387 revenue / 78.7% margin.
- Use in Looker: drag `product_line` as a dimension or filter on SKU/Product Performance charts. To split by line in scorecards on these views, use calc field: `SUM(revenue) WHERE product_line = 'human'`.

### 2026-05-23 (amendment 14)
- **Dobias `lifetime_gross_profit` now populated.** `mart_customer_lifetime` was setting Shopify order_margin to NULL — only Manami had per-customer LTGP. New logic joins `stg_shopify_order_items` to compute per-order COGS, then derives per-order margin = subtotal − COGS. Dobias: 9,102 of 9,310 customers (~98%) now have LTGP; total $3.1M / $4.1M LTV = 76% overall margin. 208 customers stay NULL (orders with no costed line items — rare, ~2%).
- Documented common Looker scorecard mistakes uncovered today:
  - **Margin% scorecards showing >100%** = using `SUM(margin) / SUM(cost) * 100` (markup formula). Correct: `SUM(margin) / SUM(revenue) * 100`.
  - **CAC drift** with multi-client unfiltered data = same multi-currency mixing pattern as ROAS. Always set page-level filter `client_id = <client>`.

### 2026-05-23 (amendment 13)
- **Klaviyo flow performance live.** Mirror of campaign-reports work: new `raw_klaviyo_flow_reports` table populated via `/api/flow-values-reports/` endpoint (24-month backfill via runbook 16). `stg_klaviyo_flows` now JOINs metadata with aggregated reports — performance metrics SUM'd from flow-message granularity up to flow level, across non-overlapping period windows.
- Dobias result: 44 flows / 103k lifetime emails sent / 1,826 conversions / $253k revenue / 44.5% open rate / 6.5% click rate.
- `mart_email_flow_perf` now shows real Klaviyo data alongside Ecomail.
- Currency override for Dobias Klaviyo flows: CAD → USD (same n8n default issue campaigns had).
- **Known constraint: periods must be non-overlapping** when backfilling/syncing flows. SUMming across overlapping snapshots would double-count. Runbook 16 documents the pattern.
- Still open: ongoing daily sync via n8n (currently snapshot-only after backfill).

### 2026-05-23 (amendment 12)
- **Flow performance views rewritten to take latest snapshot only.** Both Ecomail (`raw_ecomail_automations`) and Klaviyo (`raw_klaviyo_flows`) APIs return cumulative counters per flow at each snapshot. Old `mart_email_flow_perf` returned all snapshots; Looker summing them caused $113M phantom revenue. Now: `ROW_NUMBER() OVER (PARTITION BY flow_id ORDER BY snapshot_date DESC) WHERE rn=1` — one row per flow with cumulative-as-of-now totals.
- Added `latest_snapshot_date` column for transparency on data freshness per flow.
- Loaded Looker calc field formulas for email rates (replacing per-row decimals with reaggregated calcs):
  - `Open Rate % = SUM(unique_opens) / SUM(delivered) * 100`
  - `Click Rate % = SUM(unique_clicks) / SUM(delivered) * 100`
  - `Conversion Rate % = SUM(conversions) / SUM(delivered) * 100`
- Documented the "cumulative snapshot" pattern as a class of bug to watch for in any flow-style data source.

### 2026-05-23 (amendment 11)
- **Klaviyo performance metrics resolved.** Wired `/api/campaign-values-reports/` endpoint, backfilled 24 months for Dobias via Cloud Shell (runbook 15). New raw table `raw_klaviyo_campaign_reports` (468 rows: 408 email + 60 SMS across 24 months). `stg_klaviyo_campaigns` now JOINs metadata + latest report snapshot — delivered/opens/clicks/conversions/revenue populated for the first time.
- Added `mart_email_campaign_perf` filter `WHERE channel = 'email'` to klaviyo branch (exclude SMS from email-only mart).
- New columns surfaced in `stg_klaviyo_campaigns`: `conversion_rate`, `revenue_per_recipient`, `average_order_value`, `channel`.
- **Currency fix:** Dobias Klaviyo data was wrongly tagged `CAD` in raw (n8n default from pre-confirmation era). stg now overrides to `USD` per Dobias's USD-shop reality.
- Known follow-up: ongoing daily sync requires modifying `wf_klaviyo_to_bigquery` to add a campaign-values-reports branch. Currently the data is frozen at backfill snapshot.

### 2026-05-20 (amendment 10)
- **Renamed `frequency` → `frequency_per_day`** in `mart_meta_campaign_perf` and `mart_meta_ad_perf`. Looker was summing daily frequency values across 30 days, inflating frequency 10× over Meta Ads Manager. Same trap as the other Meta per-day ratios; was missed in amendment 7.
- Documented that period frequency CANNOT be reaggregated from daily data (reach is non-additive). Best Looker approximation: `SUM(impressions) / MAX(reach)`.

### 2026-05-20 (amendment 9)
- **AOV now defined on `net_sales`, not `revenue`.** Shipping diluted cart-size optics. AOV = `SUM(net_sales) / SUM(orders)`.
- Added `new_customer_net_sales` and `returning_customer_net_sales` columns to `mart_daily_kpis` and `mart_monthly_kpis` for the segmented AOV formulas.
- Verified on Dobias 30d: AOV $147.67 (matches Shopify ~$145), AOV new $121.21 (closer to Shopify's $109.68; remaining gap is 36-month-window limitation per amendment 8).

### 2026-05-20 (amendment 8)
- **`is_returning_customer` redefined in `stg_shopify_orders`.** Was: Shopify's `customer.orders_count > 1` flag (unreliable — over-flagged orders as "new"). Now: derived from order sequence by normalized email (`LOWER(TRIM(customer_email))`) within our 36-month window. Guest orders (no email) → NULL (excluded from both new and returning counts).
- Dobias 30d impact: new_customer_orders 544 → 418; new_customer_revenue $76k → $54k; AOV new $152 → $129 (vs Shopify $110); aMER 15.72 → 10.86. CM stack unchanged (doesn't depend on the flag).
- Remaining gap to Shopify's lifetime definition (~200 orders) is the 36-month window limit. Documented as a known gap.

### 2026-05-20 (amendment 7)
- **Dropped all pre-divided ratio columns from `mart_daily_kpis` and `mart_monthly_kpis`:** aov, aov_new, aov_returning, return_customer_rate_period, mer, amer, cac, meta_roas, meta_ctr_pct, meta_cpc, meta_cost_per_purchase
- Reason: per-day ratios were silently misaggregating in Looker (Meta ROAS showing 3.35 when correct was 4.08; CPA showing $33 when correct was $40). Defining as Looker calc fields forces SUM(num)/SUM(denom) re-aggregation. See "Derived ratio metrics — NOT in the warehouse" section.
- Existing Looker scorecards bound to these fields will throw "field not found" — rebuild using the calc-field formulas above.

### 2026-05-20 (amendment 6)
- CM stack made monotonic: `revenue ≥ CM1 ≥ CM2 ≥ CM3`
- Added cost placeholder columns: `cm1_other_costs`, `fulfillment_cost`
- CM1 now = `revenue − cogs − cm1_other_costs` (used to be `net_sales − cogs`)

### 2026-05-20 (amendment 5)
- Dropped `cm1_pct`, `cm2_pct`, `cm3_pct` — percentages move to Looker calc fields
- Dropped `meta_gross_profit_naive`

### 2026-05-20 (amendment 4)
- CM stack realigned to D2C standard mirroring Shopify report
- Shoptet COGS fixed (was mixing in VAT/shipping)

### 2026-05-20 (amendment 3)
- Dropped duplicate `gross_profit` column (was identical to CM1)
- Renamed `gross_profit_product_only` → `product_margin` (later dropped)

### 2026-05-20 (amendment 2)
- Added `new_customer_revenue`, `returning_customer_revenue`, `aov_new`, `aov_returning`, `amer` (Acquisition MER)
- Created `mart_monthly_kpis` view with MoM growth
- Renamed cohorts `return_rate_pct` → `cohort_repeat_rate_pct` (true RCR)
- Period-based RCR renamed to `return_customer_rate_period` with warning

### 2026-05-20 (initial mart audit)
- Revenue redefined: net sales + shipping (ex-tax). Old `total_price` preserved as `gross_revenue_incl_tax`
- Fixed line-item discount allocation bug in gross profit
- Renamed misnamed `ctr_pct` (was CTOR) to `click_rate_pct` in email views
- Suffixed Meta pre-divided fields with `_per_day` to flag non-aggregatability

---

*Anything missing or unclear? Add it. This file is the single source of truth for what every dashboard metric means.*
