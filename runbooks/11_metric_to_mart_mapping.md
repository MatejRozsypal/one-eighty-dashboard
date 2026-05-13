# Runbook 11 — Metric → Mart Mapping

Every metric on every page of the existing Looker dashboard, mapped to the BQ mart view + field + formula. Use as the single source of truth when rebuilding pages in Looker against `mart.*`.

**Two architectural decisions baked in:**
1. **No blending in Looker.** Every chart's data comes from one mart view. Cross-source joins happen in BQ.
2. **No raw or stg queries from Looker.** Always mart.

**Currency handling:**
- Manami: CZK throughout
- Dobias: CAD for shop + email, **USD for Meta** (locked at ad-account creation)
- Mart views expose currency per source; Looker chart titles should label "(USD)" on Meta tiles for Dobias.

---

## Page 1 — Profitability

| Tile | Mart view | Field / formula |
|---|---|---|
| **Revenue** | `mart_daily_kpis` | `SUM(revenue)` |
| **Gross profit** | `mart_daily_kpis` | `SUM(gross_profit)` |
| **Net profit** | `mart_daily_kpis` | `SUM(net_profit_naive)` (gross_profit − meta_spend; currency mismatch on Dobias documented) |
| **MER** | `mart_daily_kpis` | `SUM(revenue) / SUM(meta_spend)` (or `AVG(mer)` if you trust the per-day pre-computed) |
| **LTV** | `mart_customer_lifetime` | `AVG(lifetime_revenue)` |
| **Return Customer Rate** | `mart_daily_kpis` | `SUM(returning_customer_orders) / SUM(orders) * 100` |
| **AOV** | `mart_daily_kpis` | `SUM(revenue) / SUM(orders)` |
| **Orders** | `mart_daily_kpis` | `SUM(orders)` |
| **Time series — Revenue / Spend / Gross Profit** | `mart_daily_kpis` | x-axis = `date`; series = `SUM(revenue)`, `SUM(meta_spend)`, `SUM(gross_profit)` |
| **Channel Overview donut** | ❌ GA4 pending | Mark "GA4 pending" until BQ ↔ GA4 native link is set up |
| **Funnel** (session_start → ATC → checkout → purchase) | ❌ GA4 pending | Same |

---

## Page 2 — Shop Performance

| Tile | Mart view | Field / formula |
|---|---|---|
| **LTV** | `mart_customer_lifetime` | `AVG(lifetime_revenue)` |
| **AOV** | `mart_daily_kpis` | `SUM(revenue) / SUM(orders)` |
| **Gross Margin %** | `mart_daily_kpis` | `AVG(gross_margin_pct)` or `SUM(gross_profit) / SUM(revenue) * 100` |
| **LTGP** | `mart_customer_lifetime` | `AVG(lifetime_gross_profit)` |
| **Return Customer Rate** | `mart_daily_kpis` | `SUM(returning_customer_orders) / SUM(orders) * 100` |
| **Orders** | `mart_daily_kpis` | `SUM(orders)` |
| **New Customers** | `mart_daily_kpis` | `SUM(new_customer_orders)` (≈ new customers since they buy once on first acquisition) |
| **Returning Customers** | `mart_daily_kpis` | `SUM(returning_customer_orders)` |
| **CAC** | `mart_daily_kpis` | `SUM(meta_spend) / SUM(new_customer_orders)` |
| **Top SKUs bar (Cost + Margin)** | `mart_sku_perf` | dimension `sku_name`; stacked `SUM(cost)` (red) + `SUM(margin)` (green) |
| **SKU table (SKU, Variant, No., Cost, Margin)** | `mart_sku_perf` | dimensions: `sku_name`, `variant`; metrics: `SUM(units_sold)`, `SUM(cost)`, `SUM(margin)` |
| **keyEvents:purchase trend** | ❌ GA4 pending | — |
| **Active Users trend** | ❌ GA4 pending | — |
| **Products performance table** | `mart_product_perf` | dimension `product_name`; metrics `SUM(revenue)`, `SUM(units_sold)`; Looker handles % Δ via comparison toggle |
| **Funnel** | ❌ GA4 pending | — |

---

## Page 3 — Facebook Ads

| Tile | Mart view | Field / formula |
|---|---|---|
| **Revenue** | `mart_meta_campaign_perf` | `SUM(revenue)` (Meta-attributed) |
| **Ad spend** | `mart_meta_campaign_perf` | `SUM(spend)` |
| **Hrubý zisk Meta** (Meta gross profit) | `mart_daily_kpis` | `SUM(meta_gross_profit_naive)` (= meta_revenue − spend; placeholder until COGS join exists) |
| **Website purchases** | `mart_meta_campaign_perf` | `SUM(purchases)` |
| **CAC** | `mart_daily_kpis` | `SUM(meta_spend) / SUM(new_customer_orders)` (per Shop Performance) |
| **Cost per Result** | `mart_daily_kpis` or `mart_meta_campaign_perf` | `SUM(spend) / SUM(purchases)` |
| **CTR (all)** | `mart_daily_kpis` | `AVG(meta_ctr_pct)` or `SUM(meta_clicks) / SUM(meta_impressions) * 100` |
| **ROAS** | `mart_daily_kpis` | `SUM(meta_revenue) / SUM(meta_spend)` |
| **AOV** | `mart_meta_campaign_perf` | `SUM(revenue) / SUM(purchases)` (Meta-side AOV) |
| **New Customers** | `mart_daily_kpis` | `SUM(new_customer_orders)` |
| **Daily Revenue & Ad Spend time series** (with previous year) | `mart_daily_kpis` | x = `date`; series = `SUM(meta_spend)`, `SUM(meta_revenue)`; comparison toggle = previous year |
| **Campaign Performance table** | `mart_meta_campaign_perf` | dimension `campaign_name`; metrics: `SUM(spend)`, `SUM(revenue)`, `SUM(revenue)/SUM(spend)` (ROAS), `SUM(reach)`, `SUM(clicks)/SUM(impressions)*100` (CTR), `SUM(spend)/SUM(clicks)` (CPC), `SUM(purchases)` (website_purchases), `SUM(spend)/SUM(purchases)` (cost_per_result). **Daily Budget** column blocked — not in raw schema, would need `/{campaign_id}?fields=daily_budget` added to n8n fetch |
| **Ad Performance table** | `mart_meta_ad_perf` | dimensions `ad_name`, `campaign_id`; same metric family + `AVG(frequency)` and CPA = `SUM(spend)/SUM(purchases)` |

---

## Page 4 — Email Marketing

Works for **both Manami (Ecomail) and Dobias (Klaviyo)** since `mart_email_campaign_perf` UNIONs the two into a unified shape. Filter by `client_id` and `platform`.

| Tile | Mart view | Field / formula |
|---|---|---|
| **Campaign Revenue** | `mart_email_campaign_perf` | `SUM(revenue)` |
| **Emails sent** | `mart_email_campaign_perf` | `SUM(sent)` |
| **Open Rate** | `mart_email_campaign_perf` | `SUM(unique_opens) / SUM(delivered) * 100` (or `AVG(open_rate_pct)`) |
| **CTR** | `mart_email_campaign_perf` | `AVG(ctr_pct)` (click-to-open) |
| **Conversion Rate** | `mart_email_campaign_perf` | `AVG(conversion_rate_pct)` |
| **Revenue + Emails sent time series** | `mart_email_campaign_perf` | x = `send_date`; series = `SUM(revenue)`, `SUM(sent)`; comparison = previous year |
| **Top campaigns horizontal bar (Revenue vs inject)** | `mart_email_campaign_perf` | dim `campaign_name`; metrics `SUM(revenue)` + `SUM(sent)`; sorted descending |
| **Flows Performance — Revenue, Emails sent, Open Rate, CTR, Conv Rate** | `mart_email_flow_perf` | Filter to latest `snapshot_date` per flow. SUM/AVG of relevant columns |
| **Campaigns table** | `mart_email_campaign_perf` | dim `campaign_name`, `send_date`; cols `SUM(sent)`, `AVG(click_rate)*100`, `AVG(open_rate)*100`, `SUM(conversions)`, `SUM(revenue)` |
| **Rev/email sent** | `mart_email_campaign_perf` | `SUM(revenue) / SUM(sent)` |
| **Subscribed** | `mart_email_subscribers` | `SUM(active_subscribers)` filtered to latest `snapshot_date` |

---

## Cohort analysis (new page suggestion)

`mart_customer_cohorts` enables a cohort-over-acquisition-month view. Single source for:

- Cohort month (dimension)
- Customer count (metric)
- LTV per cohort
- LTGP per cohort
- Return rate %
- Total revenue per cohort

Build this as Page 5 of the new dashboard for any "do early customers spend more?" analysis.

---

## Cross-source metrics — proof they don't need Looker blending

| Metric | Needs sources | Mart that pre-joins | Looker chart query |
|---|---|---|---|
| MER | shop revenue + Meta spend | `mart_daily_kpis` | `SUM(revenue) / SUM(meta_spend)` — both fields in ONE view |
| CAC | Meta spend + new customers | `mart_daily_kpis` | `SUM(meta_spend) / SUM(new_customer_orders)` — both in ONE view |
| Net profit | gross_profit + ad spend | `mart_daily_kpis` | `SUM(net_profit_naive)` — pre-computed |
| LTV/LTGP | all orders per customer | `mart_customer_lifetime` | `AVG(lifetime_revenue)` — pre-aggregated to customer level |

Everything is single-source-per-chart. Looker just drags fields.

---

## GA4-pending metrics (Phase 2)

Until GA4 → BQ native link is wired:

- Channel attribution (Direct, Paid Social, Organic Search, Unassigned)
- Conversion funnel (session_start → ATC → checkout → purchase)
- Active Users / Aktivní uživatelé
- keyEvents:purchase
- Page-level analytics

These need:
1. GA4 property → BQ data set linkage (Property settings → BigQuery Linking → Daily + Streaming export)
2. New stg views for `events_*` and `events_intraday_*` tables auto-created by GA4
3. New mart views: `mart_ga4_channels_daily`, `mart_ga4_funnel_daily`, `mart_ga4_users_daily`

~2 hours of work when ready. Bring up after Looker page 1-4 are wired.

---

## Daily Budget (Meta) — not in raw schema

The Campaign Performance table on Facebook Ads page has a "Daily Budget" column. Currently blocked because:
- `raw_meta_campaign_insights` ingests `/act_*/insights` which doesn't return budget
- Budget lives on `/{campaign_id}` endpoint (`daily_budget`, `lifetime_budget` fields)

To add:
1. Modify `wf_meta_ads` workflow — add a small second fetch for campaign metadata after the insights fetch
2. Either store as a separate table `raw_meta_campaigns` (metadata snapshot) or merge into `raw_meta_campaign_insights` via per-campaign join
3. Add `daily_budget`, `lifetime_budget`, `budget_remaining` columns to `mart_meta_campaign_perf`

~30 min once you want it.
