# Runbook 10 — Looker Studio Metrics Spec

Maps every existing dashboard metric to its BigQuery `stg.*` source + field + aggregation, so the dashboards can be rebuilt with BQ as data source. Use as reference while building Looker Studio reports.

**Project / dataset:** `oneeighty-warehouse.stg`

**Always-on filters at report level:**
- `client_id` → set as a fixed filter or a report-level control so Manami's data never mixes with Dobias's by default.
- Date range → driven by the page-level date picker (already in the existing dashboards).

**Currency caveat:**
- Manami → CZK throughout.
- Dobias → CAD for Shopify + Klaviyo, **USD for Meta Ads** (immutable ad-account setting; documented in [runbook 08](08_dobias_full_onboarding.md)). When viewing Dobias, label Meta-derived metrics "(USD)" in chart titles.

**GA4-derived metrics:**
GA4 ingestion isn't wired yet — anything that came from GA4 (Channel Overview donut, session→add_to_cart→begin_checkout→purchase funnel, Active Users trend, keyEvents:purchase) is currently **unavailable**. Mark those tiles "GA4 pending" in Looker until we wire the native BQ ↔ GA4 link. Tracked as TODO; everything else lists below.

---

## Page 1 — Profitability

### Top scorecards (8 KPIs)

| Tile | Source | Field / formula | Notes |
|---|---|---|---|
| **Revenue** (51,829.7) | `stg.stg_shoptet_orders` | `SUM(totalPriceWithVatCZK)` | Manami only; for Dobias use `SUM(total_price)` on `stg.stg_shopify_orders` |
| **Gross profit** (33,884.34) | `stg.stg_shoptet_orders` | `SUM(totalMarginCZK)` | Manami only; Dobias = `SUM(subtotal_price) - SUM(cost_of_goods)` once cost data is in Shopify, otherwise leave blank |
| **Net profit** (15,656.86) | Blended | `Gross profit − Meta ad_spend − Klaviyo/Ecomail costs (~0) − other` | See "Computed metrics" section below |
| **MER** (2.84) | Blended | `Revenue / SUM(spend)` from `stg.stg_meta_campaign_insights` | Marketing Efficiency Ratio |
| **LTV** (1,139 Kč) | `stg.stg_shoptet_orders` | `SUM(totalPriceWithVatCZK) / COUNT(DISTINCT email)` | All-time customer lifetime value |
| **Return Customer Rate** (1.7%) | `stg.stg_shoptet_orders` | `COUNT(DISTINCT CASE WHEN isReturningCustomer=TRUE THEN email END) / COUNT(DISTINCT email)` | |
| **AOV** (864 Kč) | `stg.stg_shoptet_orders` | `SUM(totalPriceWithVatCZK) / COUNT(DISTINCT code)` | Average Order Value |
| **Orders** (60) | `stg.stg_shoptet_orders` | `COUNT(DISTINCT code)` | Filter out cancelled — stg view already does this |

### Time series chart (Purchase Conversion Value / Total Cost / Gross Profit)

- **Type:** Line chart
- **Date dimension:** `orderDate`
- **Series 1 — Purchase Conversion Value (revenue):** `SUM(totalPriceWithVatCZK)` from `stg.stg_shoptet_orders`
- **Series 2 — Total Cost (ad spend):** `SUM(spend)` from `stg.stg_meta_campaign_insights`, joined on date
- **Series 3 — Gross Profit:** `SUM(totalMarginCZK)` from `stg.stg_shoptet_orders`
- **Blend:** Looker's "Blend Data" with date as the join key, OR build a `mart.mart_daily_kpis` view (see "Mart views" section)

### Channel Overview donut

- **GA4-pending.** Source is GA4 sessions by default channel grouping. Mark "GA4 pending" until wired.

### Funnel (session_start → add_to_cart → begin_checkout → purchase)

- **GA4-pending.** Mark "GA4 pending".

---

## Page 2 — Shop Performance

### Top scorecards

| Tile | Source | Field / formula |
|---|---|---|
| **LTV** | `stg.stg_shoptet_orders` | Same as Profitability page |
| **AOV** | `stg.stg_shoptet_orders` | Same |
| **Gross Margin** (65%) | `stg.stg_shoptet_orders` | `SUM(totalMarginCZK) / SUM(productRevenueCZK) * 100` |
| **LTGP** (565 Kč) | `stg.stg_shoptet_orders` | `SUM(totalMarginCZK) / COUNT(DISTINCT email)` — gross profit per customer |
| **Return Customer Rate** | `stg.stg_shoptet_orders` | Same as Profitability |
| **Orders** | `stg.stg_shoptet_orders` | `COUNT(DISTINCT code)` |
| **New Customers** | `stg.stg_shoptet_orders` | `COUNT(DISTINCT CASE WHEN isReturningCustomer=FALSE THEN email END)` |
| **Returning Customers** | `stg.stg_shoptet_orders` | `COUNT(DISTINCT CASE WHEN isReturningCustomer=TRUE THEN email END)` |
| **CAC** (2,012 Kč) "In progress" | Blended | `SUM(meta_spend) / new_customers_count` — leave "In progress" until GA4 lands for full attribution |

### Top SKUs bar chart (stacked Cost/Margin)

- **Source:** `stg.stg_shoptet_order_items`
- **Dimension:** `itemName`
- **Metric 1 (Cost, red):** `SUM(itemTotalPurchasePriceCZK)`
- **Metric 2 (Margin, green):** `SUM(itemMarginCZK)`
- **Sort:** descending by total bar height
- **Limit:** 10–15 rows

### SKUs table (right side)

- **Source:** `stg.stg_shoptet_order_items`
- **Dimensions:** `itemName` (SKU), `itemVariantName` (Variant)
- **Metrics:**
  - `No.` = `SUM(itemAmount)`
  - `Cost` = `SUM(itemTotalPurchasePriceCZK)`
  - `Margin` = `SUM(itemMarginCZK)`
- **Conditional formatting:** column gradient on Cost (red) and Margin (green)
- **Sort:** by `No.` descending

### keyEvents:purchase + Active Users charts

- **GA4-pending.** Both come from GA4. Mark as such.

### Products performance table (bottom)

- **Source:** `stg.stg_shoptet_order_items`
- **Dimensions:** `itemName` (Product)
- **Metrics:**
  - `Revenue` = `SUM(itemTotalPriceWithVatCZK)`
  - `% Δ` = period-over-period comparison (Looker's built-in comparison)
  - `Units sold` = `SUM(itemAmount)`
  - `% Δ` for units = same comparison
- **Sort:** by Revenue descending

---

## Page 3 — Facebook Ads

All Meta-derived. Source is `stg.stg_meta_campaign_insights` and `stg.stg_meta_ad_insights`.

### Top scorecards

| Tile | Source | Field / formula |
|---|---|---|
| **Revenue** (35,853 Kč) | `stg_meta_campaign_insights` | `SUM(purchase_value)` |
| **Ad spend** (17,592 Kč) | `stg_meta_campaign_insights` | `SUM(spend)` |
| **Hrubý zisk Meta** (18,261.42) | Computed | `SUM(purchase_value) − SUM(spend)` |
| **Website purchases** (47) | `stg_meta_campaign_insights` | `SUM(purchases)` |
| **CAC** (246) "In progress" | Computed | `SUM(spend) / new_customers` — needs cross-join with Shoptet for new_customers |
| **Cost per Result** (374 Kč) | Computed | `SUM(spend) / SUM(purchases)` |
| **CTR (all)** (2.56%) | `stg_meta_campaign_insights` | `SUM(clicks) / SUM(impressions) * 100` |
| **ROAS** (2.04) | Computed | `SUM(purchase_value) / SUM(spend)` |
| **AOV** (763 Kč) | Computed | `SUM(purchase_value) / SUM(purchases)` |
| **New Customers** (59) | `stg.stg_shoptet_orders` | Same formula as Shop Performance page |

### Daily revenue & ad spend time series (with previous year)

- **Source:** `stg_meta_campaign_insights`
- **Date dimension:** `date_start`
- **Series 1 — Total Cost:** `SUM(spend)` (yellow line)
- **Series 2 — Purchase Conversion Value:** `SUM(purchase_value)` (blue line)
- **Comparison:** "Previous year" toggle in date range control — Looker handles the prior-year overlay automatically when comparison is set on the date range filter

### Campaign Performance table

- **Source:** `stg_meta_campaign_insights`
- **Dimension:** `campaign_name`
- **Metrics:**
  - `Ad spend` = `SUM(spend)` (Kč conditional format: yellow scale)
  - `Revenue` = `SUM(purchase_value)` (green scale)
  - `ROAS` = `SUM(purchase_value) / SUM(spend)` (blue bullet chart)
  - `Reach` = `SUM(reach)`
  - `CTR (all)` = `SUM(clicks) / SUM(impressions) * 100`
  - `CPC` = `SUM(spend) / SUM(clicks)`
  - `Website purchases` = `SUM(purchases)`
  - `Cost per result` = `SUM(spend) / SUM(purchases)`
  - `Daily Budget` — **not in raw schema**. Either add `daily_budget` as a new ingest field from `/{campaign_id}?fields=daily_budget` OR leave blank for now.
- **Sort:** by Revenue descending

### Ad Performance table

- **Source:** `stg_meta_ad_insights`
- **Dimensions:** `ad_name`, `campaign_name` (truncated to N chars)
- **Metrics:**
  - `Ad spend` = `SUM(spend)`
  - `Revenue` = `SUM(purchase_value)`
  - `ROAS` = `SUM(purchase_value) / SUM(spend)` (blue bullet)
  - `Reach` = `SUM(reach)`
  - `CTR (all)` = `SUM(clicks) / SUM(impressions) * 100`
  - `CPC` = `SUM(spend) / SUM(clicks)`
  - `Freq` = `AVG(frequency)`
  - `Conv` = `SUM(purchases)` (green bar)
  - `CPA` = `SUM(spend) / SUM(purchases)`
- **Sort:** by Revenue descending

---

## Page 4 — Email Marketing

**Manami → Ecomail** sources: `stg.stg_ecomail_campaigns` + `stg.stg_ecomail_automations`.
**Dobias → Klaviyo** sources: `stg.stg_klaviyo_campaigns` + `stg.stg_klaviyo_flows`.

Make two versions of the page (one per client) since field names differ between Ecomail and Klaviyo. Or use a parameter switch with `IF(client_param='manami', ...ecomail field..., ...klaviyo field...)`.

### Top scorecards (campaigns block)

Using **Ecomail** field names (Manami):

| Tile | Field / formula |
|---|---|
| **Campaign Revenue** (4,846 Kč) | `SUM(conversions_value)` |
| **Emails sent** (3,059) | `SUM(inject)` |
| **Open Rate** (23.4%) | `SUM(open) / SUM(delivery) * 100` |
| **CTR** (4.18%) | `SUM(click) / SUM(open) * 100` (click-to-open) |
| **Conversion Rate** (0.70%) | `SUM(conversions) / SUM(delivery) * 100` |

For Klaviyo (Dobias):

| Tile | Field / formula |
|---|---|
| Campaign Revenue | `SUM(revenue)` |
| Emails sent | `SUM(recipients)` |
| Open Rate | `SUM(unique_opens) / SUM(delivered) * 100` |
| CTR | `SUM(unique_clicks) / SUM(unique_opens) * 100` |
| Conversion Rate | `SUM(conversions) / SUM(delivered) * 100` |

### Time series chart (Revenue + Emails sent with previous year)

- **Source:** `stg_ecomail_campaigns` (Manami) or `stg_klaviyo_campaigns` (Dobias)
- **Date dimension:** `DATE(sent_at)` (Ecomail) / `DATE(send_time)` (Klaviyo)
- **Series 1 — Revenue:** `SUM(conversions_value)` / `SUM(revenue)`
- **Series 2 — Emails sent:** `SUM(inject)` / `SUM(recipients)`
- **Comparison:** previous year via Looker comparison toggle

### Horizontal bar (Revenue vs inject for campaigns)

- **Source:** Ecomail
- **Dimension:** `title` (campaign name)
- **Metric 1 — Revenue:** `SUM(conversions_value)` (blue bar)
- **Metric 2 — inject:** `SUM(inject)` (red bar) — sent count
- **Sort:** by Revenue descending
- **Limit:** top 5–10

### Flows performance (all-time scorecards)

- **Source:** `stg_ecomail_automations` (Manami) / `stg_klaviyo_flows` (Dobias)
- **Filter:** `snapshot_date = (SELECT MAX(snapshot_date) FROM ...)` — only the latest snapshot
- All metrics use the same formulas as campaigns above, but the absolute values (revenue 92M, emails_sent 1.28M) are cumulative all-time values from Ecomail's API

### Campaigns + Flows tables

- **Campaigns table source:** `stg_ecomail_campaigns` (or Klaviyo)
- **Dimensions:** `title` (Campaign Name), `DATE(sent_at)` (Date)
- **Metrics:** Emails Sent, Click Rate, Open Rate, Conversions, Conversion Value (each per the formula table above)
- **Flows table** — looks identical in the screenshot; either same data or a separate flows table. **Note:** the second table appears duplicate of the first in the screenshot — verify and remove one if so.

### Rev/email sent + subscribed scorecards

- **Rev/email sent** (1.58 Kč) = `SUM(conversions_value) / SUM(inject)`
- **Subscribed** (1,686) = `SUM(active_subscribers)` from `stg_ecomail_lists`, filtered to latest snapshot_date

---

## Computed metrics — Net profit, MER, blended

These require **multiple data sources** in one chart. Two ways to do it in Looker:

### Option A — Looker "Blend Data" feature

1. **Resource → Manage blended data → Add a Blend**.
2. Source A: `stg_shoptet_orders` aggregated daily (`orderDate`, `SUM(totalPriceWithVatCZK)`, `SUM(totalMarginCZK)`).
3. Source B: `stg_meta_campaign_insights` aggregated daily (`date_start`, `SUM(spend)`, `SUM(purchase_value)`).
4. **Join:** Left Outer on `orderDate = date_start`.
5. Output dimensions: date. Output metrics: revenue, margin, spend.
6. Computed metric in the blend:
   - `Net profit = SUM(totalMarginCZK) - SUM(spend)`
   - `MER = SUM(totalPriceWithVatCZK) / SUM(spend)`

### Option B — Build a `mart.*` view in BQ (recommended for prod)

Pre-aggregate per client per day in BQ. Looker just reads one source.

```sql
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_daily_kpis` AS
WITH shop AS (
  SELECT
    client_id,
    orderDate AS date,
    SUM(totalPriceWithVatCZK)  AS revenue,
    SUM(totalMarginCZK)        AS gross_profit,
    SUM(productRevenueCZK)     AS product_revenue,
    COUNT(DISTINCT code)       AS orders,
    COUNT(DISTINCT email)      AS unique_customers,
    COUNTIF(NOT isReturningCustomer) AS new_customer_orders
  FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
  WHERE orderDate >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  GROUP BY client_id, orderDate
),
meta AS (
  SELECT
    client_id,
    date_start AS date,
    SUM(spend)          AS meta_spend,
    SUM(purchase_value) AS meta_revenue,
    SUM(purchases)      AS meta_purchases,
    SUM(impressions)    AS meta_impressions,
    SUM(clicks)         AS meta_clicks
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights`
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
  GROUP BY client_id, date_start
)
SELECT
  COALESCE(s.client_id, m.client_id) AS client_id,
  COALESCE(s.date, m.date)           AS date,
  s.revenue, s.gross_profit, s.product_revenue, s.orders, s.unique_customers, s.new_customer_orders,
  m.meta_spend, m.meta_revenue, m.meta_purchases, m.meta_impressions, m.meta_clicks,
  -- computed
  SAFE_DIVIDE(s.revenue, m.meta_spend) AS mer,
  s.gross_profit - COALESCE(m.meta_spend, 0) AS net_profit
FROM shop s
FULL OUTER JOIN meta m
  ON s.client_id = m.client_id AND s.date = m.date;
```

Then in Looker:
- Source: `mart.mart_daily_kpis`
- All scorecards and time series come from this single view
- Much faster + simpler than blends

We can build out `mart.mart_meta_campaign_perf` and `mart.mart_email_perf` similarly when you're ready. Each mart view = one Looker page's data, pre-shaped.

---

## Setup checklist (per page)

For each Looker Studio page:

1. **Add data sources** for the stg views the page needs (Resource → Add data source → BigQuery).
2. **Set partition filter** in Looker's "Date Range Dimension" field — Looker auto-adds the partition filter to satisfy BQ's `require_partition_filter`.
3. **Add report-level filter:** `client_id` IN (selected).
4. **Add date range control** — defaults to "Last 30 days".
5. **Add previous-period comparison toggle** on the date range control — auto-renders the previous-year overlays on time series charts.
6. **Build scorecards first**, then time series, then tables.
7. **Save → share** as a copy of your existing dashboard, swap data source mid-way for like-for-like sanity check.

---

## What to do when…

- **A metric returns 0:** check the date range matches your data (e.g. Meta data only goes back to 2025-05 for Manami, 2026-04 for Dobias).
- **A chart errors with "missing partition filter":** add a date range control that's wired to the date dimension of that source. Stg views have a 36-month internal WHERE that should satisfy this automatically.
- **Cross-source chart looks weird:** use Option B (mart view) instead of Looker's blend feature — much more reliable.
- **Numbers don't match Manami's existing dashboard:** verify the existing dashboard uses raw Shoptet API or Supermetrics. The new stg numbers should match within rounding (and may DIFFER by < 1% due to currency conversion or attribution windows). If off by > 5%, paste both numbers + the SQL Looker shows it's running.

---

## Pages that aren't built yet (Looker)

Per your existing dashboard, you also have:
- Google Ads page — pending Google Ads data ingest (not in scope for v1)
- Organic Instagram page — `stg.stg_instagram_media` + `stg_instagram_account_insights` (latter is currently disabled due to token scope — see `TODO_facebook_instagram_pending.md`)
- Cross-client comparison view — needs both clients' data, will work once Shopify + Dobias Meta are flowing
