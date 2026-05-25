# One Eighty Warehouse — Metrics Dictionary

The canonical reference for every metric exposed in the `mart.*` layer. Looker Studio queries mart exclusively, so anything you can put on a dashboard is documented here.

**Update this file whenever:** a new metric lands, a formula changes, a placeholder cost gets wired, or a known data gap is resolved.

**Last updated:** 2026-05-20 (CM stack monotonic; cost placeholders introduced)

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

### Currency
- Native per source, no FX. Manami operates in **CZK**, Dobias in **USD**.
- The 4 stray CAD orders in Dobias data per period are real-presentment CAD orders (not Matrixify ghosts; those are filtered at stg). Trivial volume.
- Cross-client comparison is per-currency for now. `ref.fx_rates` is on the roadmap (lower priority post-Dobias-USD-only).

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
| `cm3` | $ | `cm2 − meta_spend` | After-marketing margin. **The live "true ROI of paid acquisition" figure.** |

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
| `MER` | `SUM(revenue) / SUM(meta_spend)` |
| `aMER` | `SUM(new_customer_revenue) / SUM(meta_spend)` |
| `CAC` | `SUM(meta_spend) / SUM(new_customer_orders)` |
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

**Inherits everything from `mart_daily_kpis`** (column-for-column SUM), plus:

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
- **MER** → `SUM(revenue) / SUM(meta_spend)`
- **aMER** → `SUM(new_customer_revenue) / SUM(meta_spend)`
- **CAC** → `SUM(meta_spend) / SUM(new_customer_orders)`
- **Meta CTR** → `SUM(meta_clicks) / SUM(meta_impressions) * 100`
- **Meta CPC** → `SUM(meta_spend) / SUM(meta_clicks)`
- **Meta ROAS** → `SUM(meta_revenue) / SUM(meta_spend)`

Always re-aggregate from sums; never SUM or AVG a pre-computed ratio.

---

## Changelog (most recent first)

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
