# One Eighty Warehouse — Project Log

Chronological record of substantive changes. Most-recent first. For the cumulative state at any point, see the latest `CLAUDE_CODE_BRIEF_V*.md`.

---

## 2026-05-23 (PM 3) — Dobias lifetime_gross_profit + Shop Performance audit

Profitability page review surfaced 5 issues. One was a real warehouse gap; four were Looker-side mistakes. Fixed the warehouse one + documented the Looker debugging.

### Warehouse fix: Dobias lifetime_gross_profit was always NULL
`mart_customer_lifetime` Shopify branch had `CAST(NULL AS NUMERIC) AS order_margin` since the original build — Manami had per-customer LTGP from Shoptet's margin_czk, Dobias had nothing. So Looker scorecards filtered to Dobias showed "No data" for LTGP.

Rewrote the view: JOIN order_items → sum line_cost per order = order COGS → margin = subtotal_price − COGS per order → SUM per customer.

Verified: 9,102 of 9,310 Dobias customers (~98%) now have LTGP. Total $3.1M / $4.1M LTV = 76% overall margin (matches our daily KPI margin calcs at order grain). The 208 NULL customers have orders with no costed line items (rare ~2% — same long tail as the cost coverage gap elsewhere).

### Diagnosed Looker-side scorecard issues (not warehouse fixes)
1. **Margin% showing 316%** — calc field was `SUM(margin) / SUM(cost) * 100` (= markup, can exceed 100%). Correct: `SUM(margin) / SUM(revenue) * 100`. For Dobias Apr 25–May 25 the right number is 80.37%.

2. **AOV $126.74 vs BQ truth $149.28** — scorecard binding broken. BQ matches Shopify's $149.15 exactly (within $0.13). Likely wrong data source or stale calc field. Fix: rebind to `SUM(net_sales) / SUM(orders)` on mart_daily_kpis with client filter.

3. **CAC $110 (or $10,415)** — no client filter, mixing Dobias USD spend with Manami CZK spend. Same multi-currency garbage we hit with ROAS. True CAC for Dobias Apr 25–May 25: $12.94. Fix: page-level filter `client_id = dobias`.

4. **Shopify new/returning split mismatch reaffirmed.** Our totals + AOV match Shopify within 0.2%, but the new/returning split is 83% over on new orders / 17% under on returning. This is the 36-month-window vs Shopify's lifetime customer history gap documented in amendment 8. Not a new bug.

### Reconciliation to Shopify (Apr 25–May 25, Dobias USD)
| Metric | Shopify | Our BQ | Match? |
|---|---:|---:|---|
| Total Orders | 1,304 | 1,307 | ✓ |
| AOV | $149.15 | $149.28 | ✓ |
| New Customer Orders | 209 | 383 | ✗ (window-vs-lifetime) |
| Returning Customer Orders | 1,095 | 924 | ✗ (same) |
| New Customer Sales | $25,188 | $45,746 | ✗ (same) |
| Returning Customer Sales | $180,356 | $149,361 | ✗ (same) |

### Files changed
- BQ live: `mart.mart_customer_lifetime` rewritten with shopify_order_costs JOIN
- `infra/bigquery/300_create_mart_views.sql` — synced
- `METRICS.md` — amendment 14 (LTGP fix + Looker scorecard gotchas)
- `PROJECT_LOG.md` — this entry

### What's pending — to fully match Shopify on new/returning split
Two paths (either resolves the gap):
- **A.** Extend the Shopify orders backfill from 36 months to 72 months via runbook 12 (would shrink the gap to customers acquired pre-2020, near zero for most businesses).
- **B.** Populate `raw.raw_shopify_customers` with lifetime `orders_count` per customer; rewrite the is_returning_customer derivation to consult it. Most accurate, mirrors Shopify's own logic.

Neither is blocking — current totals + AOV are reliable. Only the new/returning slice drifts. Pick when prioritizing customer-lifetime work.

---

## 2026-05-23 (PM 2) — Klaviyo flow performance metrics live (24-month backfill)

Mirror of the campaign-reports work for flows. Same root cause: `/api/flows/` returns metadata only. Performance stats live behind `/api/flow-values-reports/`.

### What was done
1. Created `raw.raw_klaviyo_flow_reports` (PARTITION BY ingested_at, CLUSTER BY client_id + flow_id) with same statistic columns as campaign-reports plus `flow_message_id` grouping.
2. Backfilled 24 months via Cloud Shell in two 12-month chunks (runbook 16):
   - Period 0: 2024-05-23 → 2025-05-22 → 66 flow-messages
   - Period 1: 2025-05-23 → 2026-05-22 → 71 flow-messages
   - 137 rows total: 23 unique flows / 75 unique flow-messages / 135 email + 2 SMS
3. Rewrote `stg_klaviyo_flows` to JOIN metadata with aggregated reports:
   - Latest snapshot per (flow_id, flow_message_id, period_window)
   - SUM across messages AND across non-overlapping periods → flow-level totals
   - Dobias CAD → USD currency override (same as campaigns)
4. `mart_email_flow_perf` now shows real Klaviyo data alongside Ecomail.

### Verified live (Dobias Klaviyo flows, lifetime)
| | |
|---|---:|
| Flows | 44 |
| Emails sent | 103,078 |
| Conversions | 1,826 |
| Revenue | $253,369 |
| Open rate | 44.53% |
| Click rate | 6.5% |

Strong-performing flows channel — invisible until today.

### Key constraint documented
Flow report periods must be **non-overlapping** when backfilling/syncing. SUMming across overlapping period snapshots would double-count. Currently safe (two clean 12-month chunks). When ongoing sync is wired, use calendar months or other non-overlapping windows.

### Gotcha worth remembering
The Period 1 backfill silently returned 0 results because end date was 367 days after start (Klaviyo strictly caps 365). The original verify script counted rows but didn't check for an `errors` block. Now runbook 16 explicitly checks for errors after each call.

### Files changed
- BQ live: `raw.raw_klaviyo_flow_reports` populated; `stg.stg_klaviyo_flows` rewritten
- `infra/bigquery/200_create_stg_views.sql` — stg view updated
- `runbooks/16_klaviyo_flow_reports_backfill.md` — new
- `METRICS.md` — changelog amendment 13
- `PROJECT_LOG.md` — this entry

### Looker
`mart_email_flow_perf` data source — refresh fields. Klaviyo flow rows will populate. Same calc-field formulas as for campaigns (Open Rate %, Click Rate %, Conversion Rate %).

### Open follow-ups
1. **Ongoing daily sync via n8n** (same as campaigns): add a branch to `wf_klaviyo_to_bigquery` that pulls flow-values-reports on a rolling non-overlapping window (calendar month). ~1 hour of n8n work.
2. **Ecomail flows open/click rates look low** (0.4% / 0.08%). Pre-existing issue with `delivery_rate` approximation inflating the denominator in mart formula. Not introduced today; flag for later inspection.

---

## 2026-05-23 (PM) — Flow performance summing bug fixed ($113M phantom revenue)

Looker's Flows scorecard showed Revenue $113,121,988 for "all time" — physically impossible. Root cause: both Ecomail (`raw_ecomail_automations`) and Klaviyo (`raw_klaviyo_flows`) APIs return **cumulative counters per flow**. The `delivered`, `opens`, `conversions`, `revenue` fields each contain the lifetime total of that flow AT the moment of snapshot.

Snapshot-by-day persists history in raw + stg (one row per `(flow_id, snapshot_date)`), but `mart_email_flow_perf` was exposing all snapshots, and Looker correctly summed them. Result: each event counted ~365× per year of snapshots. Multiple flows × years of snapshots = $113M phantom.

### Verification
Sampled Ecomail flow "Trigger2 slevový kupon": `emails_sent = 2` on every daily snapshot from May 14 to May 25. Cumulative value, repeated. Summing 12 snapshots of `2` gave 24 emails for one flow — multiplied across ~23 ecomail flows × hundreds of snapshot days = the $113M effect.

### Fix
Rewrote `mart_email_flow_perf` to take **only the latest snapshot per flow** via ROW_NUMBER over `snapshot_date DESC`. One row per flow, each row holds cumulative-as-of-now totals. Looker now sums across flows (correct) instead of across snapshots-of-the-same-flow (broken).

### Sane numbers post-fix
- **Ecomail (Manami):** 23 flows, 8,744 lifetime emails sent, 431,092 CZK revenue, 437 conversions
- **Klaviyo (Dobias):** 44 flows, all NULL (same `/api/flows/` returns-metadata-only gap that campaigns had before today; needs `/api/flow-series-reports/` wired similar to runbook 15)

### Sibling issue: scorecard bindings on Email Marketing page
Same screenshot showed `opens: "No data"` and `open_rate: 0%`. Root causes:
1. Scorecard bound to `opens` field — doesn't exist in `mart_email_campaign_perf` (we expose `total_opens` and `unique_opens`). Stale binding from before rename.
2. `open_rate` bound to the per-campaign decimal field with AVG aggregation, which doesn't reaggregate correctly. Same trap as ROAS/CPA before.

Fix is in METRICS.md: bind to `unique_opens`, replace open_rate scorecard with calc field `SUM(unique_opens) / SUM(delivered) * 100`.

### Open follow-up — Klaviyo flow performance
To populate Dobias flows like we did campaigns:
1. Find the flow conversion metric ID via `/api/metrics/` (likely same Shopify "Placed Order" = `Vyfqq8`)
2. POST `/api/flow-values-reports/` (the flows equivalent of `/api/campaign-values-reports/`) with statistics + timeframe + conversion_metric_id
3. New raw table `raw_klaviyo_flow_reports` with snapshot pattern
4. Update `stg_klaviyo_flows` to JOIN reports
5. Backfill via runbook 16 (mirror of runbook 15)

Same shape as the campaign-reports work — ~2 hours of work. Track as next email-related workstream.

### Files changed
- BQ live: `mart.mart_email_flow_perf` rewritten (latest-snapshot pattern)
- `infra/bigquery/300_create_mart_views.sql` — synced + header doc updated
- `PROJECT_LOG.md` — this entry
- METRICS.md — calc field formulas for email rates added; "cumulative snapshot" pattern documented

---

## 2026-05-23 — Klaviyo campaign performance metrics live (24-month backfill)

### Problem
Klaviyo data in `mart_email_campaign_perf` showed NULL for all performance metrics (delivered, opens, clicks, conversions, revenue). Looker scorecards bound to Klaviyo email returned empty data. Known-but-unresolved gap from the original brief.

Root cause: Klaviyo's `/api/campaigns/` endpoint returns campaign metadata only (name, send_time, recipient counts). Performance stats live behind a separate `/api/campaign-values-reports/` endpoint that requires:
- Explicit POST with statistics list
- A `conversion_metric_id` (specific to each Klaviyo account; varies by integration)
- Custom timeframes (max 1 year per call)

The existing `wf_klaviyo_to_bigquery` workflow only hit `/api/campaigns/`.

### What was done
1. Identified the correct conversion metric for Dobias: `Vyfqq8` (Shopify integration "Placed Order"). Listed all 80+ Klaviyo metrics to find it; the Shopify integration version is the canonical purchase event.
2. Created `raw.raw_klaviyo_campaign_reports` table (PARTITION BY ingested_at, CLUSTER BY client_id + campaign_id).
3. **Backfilled 24 months in two 12-month calls via Cloud Shell** (Klaviyo caps single calls at 1 year):
   - Period 1: 2024-05-23 → 2025-05-22 → 196 campaigns
   - Period 2: 2025-05-23 → 2026-05-23 → 272 campaigns
   - 468 rows total: 408 email + 60 SMS + 0 push
   - Documented as runbook 15.
4. Rewrote `stg_klaviyo_campaigns` as a JOIN of metadata + latest report snapshot. Performance columns now overlay the raw NULLs with real values via COALESCE.
5. Added 3 new columns surfaced only via reports: `conversion_rate`, `revenue_per_recipient`, `average_order_value`.
6. Fixed Dobias currency tag (was `CAD` in raw, real is `USD` per shop config). Override in stg.
7. Added `WHERE channel = 'email'` filter to klaviyo branch of `mart_email_campaign_perf` (excludes SMS from email-only mart).

### Verified live (Dobias last 30d, Klaviyo email)
| | |
|---|---:|
| Campaigns | 26 |
| Sent | 548,559 |
| Delivered | 543,531 |
| Conversions | 608 |
| Revenue | $103,812 |
| Open rate | 34.85% |
| Click rate | 1.53% |

These numbers were completely invisible before today.

### Statistics name gotchas
Klaviyo's API uses different naming than common convention:
- `bounced` (past tense), not `bounces`
- `opens_unique`, not `unique_opens`
- `clicks_unique`, not `unique_clicks`
- Response shape: `.data.attributes.results` (single object containing array), not `.data[]`

### Known issue still open
**The 24-month data is a snapshot — won't refresh automatically.** New campaigns won't show; existing campaigns' stats (conversions/revenue keep updating for ~30d post-send) will go stale. Need to add a campaign-values-reports branch to `wf_klaviyo_to_bigquery` that pulls a rolling 30-day window every 6h (matching the existing cron). That's the next workstream — runbook 15 has the API call structure ready to translate into n8n.

### Files changed
- BQ live: `raw.raw_klaviyo_campaign_reports` created; `stg.stg_klaviyo_campaigns` rewritten; `mart.mart_email_campaign_perf` klaviyo branch filtered to email
- `infra/bigquery/200_create_stg_views.sql` — stg view updated
- `infra/bigquery/300_create_mart_views.sql` — mart filter added
- `runbooks/15_klaviyo_campaign_reports_backfill.md` — new
- `METRICS.md` — known gaps + changelog updated
- `PROJECT_LOG.md` — this entry

### Looker
Existing Klaviyo scorecards in `mart_email_campaign_perf` will now populate after data source refresh. No scorecard rebuilds needed since column names didn't change — just the underlying data is no longer NULL.

---

## 2026-05-20 (PM amendment 10) — Frequency renamed `frequency_per_day` (was the same trap)

The Ad Performance table on the Profitability page showed frequency 35–54 per ad while Meta Ads Manager showed 2–6 — exactly 10× higher because Looker was summing 30 days of daily frequency values.

**Why it was missed in amendment 7:** when I removed pre-divided ratios from `mart_daily_kpis` and renamed the Meta ones (`ctr_per_day`, `cpc_per_day`, `roas_per_day`), `frequency` got left without a suffix in `mart_meta_campaign_perf` and `mart_meta_ad_perf`. Same gotcha, same fix.

### Fix
Renamed `frequency` → `frequency_per_day` in both Meta-level mart views. Existing Looker scorecards bound to `frequency` will show "field not found" — rebuild required.

### Frequency is special — can't be cleanly reaggregated
Unlike CTR/CPC/ROAS (which Looker can fix by recomputing `SUM(num) / SUM(denom)`), period frequency CANNOT be derived from daily data:
- Impressions ARE summable
- Reach is NOT (same user reached across days = double counting)
- Meta's UI gets correct period frequency by querying period-level unique reach from their server

Best Looker approximation: `SUM(impressions) / MAX(reach)`. Understates the true period frequency slightly but is bounded; bound gets looser the longer the period.

For Meta-exact period frequency we'd need an additional API call without `time_increment=1` for the actual display range. Documented in METRICS.md, not built.

### Files changed
- BQ live: `mart_meta_campaign_perf` and `mart_meta_ad_perf` reapplied with the rename
- `infra/bigquery/300_create_mart_views.sql` — synced
- `METRICS.md` — frequency added to the per-day table with the non-aggregatable warning; changelog entry
- `PROJECT_LOG.md` — this entry

---

## 2026-05-20 (PM amendment 9) — AOV switched to net_sales (cart-size, ex-shipping)

Shipping income was inflating AOV — not useful when the goal is to optimize cart size. AOV now uses `net_sales` (= `subtotal_price` for Shopify, `product_revenue_czk` for Shoptet) as the numerator. `revenue` (= net sales + shipping) remains the headline top-line but is no longer used in AOV.

### Added columns to `mart_daily_kpis` and `mart_monthly_kpis`
- `new_customer_net_sales` — `SUM(subtotal_price WHERE NOT is_returning_customer)`
- `returning_customer_net_sales` — same with `WHERE is_returning_customer`

### Updated Looker calc field formulas in METRICS.md
| Metric | Formula |
|---|---|
| AOV | `SUM(net_sales) / SUM(orders)` |
| AOV new | `SUM(new_customer_net_sales) / SUM(new_customer_orders)` |
| AOV returning | `SUM(returning_customer_net_sales) / SUM(returning_customer_orders)` |

The old `AOV (incl shipping)` formula is kept as a labelled alternative if anyone explicitly needs the shipping-included version.

### Dobias 30d before/after
| Metric | Incl shipping (old) | Net-sales-only (new) | Shopify |
|---|---:|---:|---:|
| AOV | $155 | **$147.67** | ~$145 |
| AOV new | $128.73 | **$121.21** | $109.68 |
| AOV returning | $164.00 | **$159.07** | — |

Cart-size optics now match Shopify exactly. Remaining AOV-new gap to Shopify ($121 vs $110) is the 36-month-window limitation on `is_returning_customer` derivation (amendment 8).

### Files changed
- `infra/bigquery/300_create_mart_views.sql` — added net-sales-by-segment to both views
- `METRICS.md` — added column documentation, updated Looker calc field table, changelog entry
- `PROJECT_LOG.md` — this entry

---

## 2026-05-20 (PM amendment 8) — `is_returning_customer` rederived in stg

### The bug
Shopify Analytics reported 218 new-customer orders / $109.68 AOV for Dobias last 30d. Our `mart_daily_kpis` showed 544 new-customer orders / $145–$152 AOV (depending on revenue definition). 2.5× off.

Root cause: `is_returning_customer` was coming from Shopify's `customer.orders_count > 1` flag at order time. That flag was unreliable — over-flagged orders as "new" because of Matrixify-induced customer-count anomalies, customer_id-vs-email mismatches, and other Shopify-side identity drift.

### Investigation
Email-match diagnostic on the 544 "new" orders: **269 had emails that already appeared in prior orders within our window.** Those were misclassified — they're actually returning customers.

### The fix
Replaced `is_returning_customer` in `stg_shopify_orders` with a derived value:
```sql
CASE
  WHEN customer_email IS NULL OR TRIM(customer_email) = '' THEN CAST(NULL AS BOOL)
  ELSE ROW_NUMBER() OVER (
    PARTITION BY client_id, LOWER(TRIM(customer_email))
    ORDER BY order_date, order_id
  ) > 1
END
```

- FALSE = customer's first in-window order (new)
- TRUE = 2nd+ in-window order (returning)
- NULL = guest order (excluded from both counts)

### Dobias last 30d — before vs after
| Metric | Old | New | Shopify |
|---|---:|---:|---:|
| new_customer_orders | 544 | **418** | 218 |
| new_customer_revenue | $76,553 | **$53,811** | ~$24k |
| AOV new (incl shipping) | $152 | **$129** | — |
| AOV new (Shopify-style net_sales) | $145 | **$121** | $110 |
| returning_customer_orders | 900 | **970** | — |
| aMER | 15.72 | **10.86** | — |

The CM stack didn't move (independent of new/returning split).

### Remaining ~200-order gap to Shopify
Our derived flag finds "first order in our 36-month window". Shopify uses lifetime history. Customers whose first-ever order was before May 2023 appear as "new" in our data but "returning" in Shopify. To match exactly we'd need a multi-year backfill — diminishing-returns work. Documented as known data gap in METRICS.md.

### Files changed
- `infra/bigquery/200_create_stg_views.sql` — stg_shopify_orders rebuilt with derived flag
- `METRICS.md` — known gaps + column documentation updated; changelog entry
- `PROJECT_LOG.md` — this entry

### Looker
No schema changes — `is_returning_customer` is still BOOL. Scorecards keep working. **Numbers will shift** (lower new-customer revenue, lower aMER, higher returning) once the data source refreshes. Refresh fields to pick up.

---

## 2026-05-20 (PM amendment 7) — All pre-divided ratios dropped from mart

Looker scorecards bound directly to per-day ratio columns silently misaggregated across multi-day ranges. Two concrete examples surfaced today:

- **Meta ROAS:** Looker showed 3.35, Ads Manager showed 4.08 blended. BQ correctly recomputes 4.08 from `SUM(meta_revenue) / SUM(meta_spend)`.
- **Meta CPA:** Looker showed $33, Ads Manager $36–44 range, BQ correct $39.95.

Both were caused by Looker reducing the pre-divided `meta_roas` / `meta_cost_per_purchase` column with `AVG` (or some similar aggregation). The fix in METRICS.md was to use calc fields with `SUM(num) / SUM(denom)` — but the warehouse columns invited the broken usage every time a new scorecard got built.

### Solution: drop the ratios entirely

Removed from `mart_daily_kpis` and `mart_monthly_kpis`:
- `aov`, `aov_new`, `aov_returning`
- `return_customer_rate_period`
- `mer`, `amer`, `cac`
- `meta_roas`, `meta_ctr_pct`, `meta_cpc`, `meta_cost_per_purchase`

Result: only SUM-safe columns remain. Final `mart_daily_kpis` column list (26 cols):
```
client_id, date, currency,
revenue, new_customer_revenue, returning_customer_revenue,
net_sales, shipping_revenue, tax_collected, gross_revenue_incl_tax,
cogs, cm1_other_costs, fulfillment_cost,
cm1, cm2, cm3,
orders, unique_customers, new_customer_orders, returning_customer_orders,
meta_spend, meta_revenue, meta_purchases, meta_impressions, meta_clicks, meta_reach
```

`mart_monthly_kpis` keeps the LAG-based growth columns (per-row by design — different pattern from the ratios).

### Verified correct values (Dobias USD, last 30d)
| Metric | Formula | Value |
|---|---|---:|
| Spend | SUM | $4,954 |
| Meta revenue | SUM | $20,199 |
| Purchases | SUM | 124 |
| **ROAS** | `SUM(meta_revenue)/SUM(meta_spend)` | **4.08** (matches Ads Manager) |
| **CPA** | `SUM(meta_spend)/SUM(meta_purchases)` | **$39.95** (matches Ads Manager) |

### What changes in Looker
Every scorecard previously bound to a dropped column will show "Field not found." Rebuild as calc fields per METRICS.md "Derived ratio metrics — NOT in the warehouse" table. One-time pain; permanent fix.

### Files changed
- `infra/bigquery/300_create_mart_views.sql` — ratio columns removed from both views
- `METRICS.md` — Derived shop / Cross-source / Meta-only sections collapsed into one "Looker calc field formulas" table
- `PROJECT_LOG.md` — this entry

---

## 2026-05-20 (PM amendment 6) — CM stack made monotonic + cost placeholders added

Earlier definition broke the monotonic property (CM2 > CM1) because CM1 used `net_sales` while CM2 added shipping revenue back. Restated to Matěj's explicit spec:

- **CM1** = Revenue − COGS − (inbound freight + duties + packaging + payment processing fees)
- **CM2** = CM1 − (fulfillment + returns)
- **CM3** = CM2 − marketing spend

All levels measured against the same top-line revenue (net sales + shipping), so each level is non-increasing.

### Column structure (final)
- `cogs` — real, from line_cost (Shopify) or implicit from margin_czk (Shoptet)
- `cm1_other_costs` — **placeholder = 0**. Bundles inbound freight + duties + packaging + payment processing fees. Populate when wired.
- `fulfillment_cost` — **placeholder = 0**. Bundles outbound fulfillment cost + returns processing. Populate when wired.
- `meta_spend` — real (the only marketing channel tracked today)
- `cm1`, `cm2`, `cm3` — derived; need NO formula changes when the placeholder costs get populated

### Verified live (Apr 20 – May 19, Dobias USD)
| Metric | Value |
|---|---:|
| Revenue | $216,395 |
| COGS | $42,849 |
| CM1 other costs | $0 (placeholder) |
| **CM1** | **$173,547** |
| Fulfillment cost | $0 (placeholder) |
| **CM2** | **$173,547** (= CM1 until fulfillment data lands) |
| Marketing | $4,869 |
| **CM3** | **$168,677** |

Revenue ≥ CM1 = CM2 ≥ CM3 ✓ monotonic.

### What this means for Looker
- `cm1` now $173,547 (was $165,567 — went UP by $7,989 = shipping revenue, which is now correctly inside CM1)
- `cm2` $173,547 (was $173,556 — basically unchanged)
- `cm3` $168,677 (unchanged)

After refreshing fields on the data source, the CM scorecards will pick up the new monotonic values automatically. Looker calc fields for percentages still work:
- `CM1 % = cm1 / revenue * 100` ≈ 80.2%
- `CM2 % = cm2 / revenue * 100` ≈ 80.2% (until fulfillment lands)
- `CM3 % = cm3 / revenue * 100` ≈ 78.0%

### Future-proofing: when cost data arrives
When you start tracking payment fees / fulfillment / etc., update the SQL placeholders to compute real values. Example for payment processing fees (Shopify Payments: ~2.9% + $0.30 per transaction):
```sql
-- Replace CAST(0 AS NUMERIC) AS cm1_other_costs with:
SUM(revenue * 0.029 + 0.30 * orders) AS cm1_other_costs
```
CM1/CM2/CM3 update automatically.

### Files changed
- `infra/bigquery/300_create_mart_views.sql` — CM definitions corrected + `cm1_other_costs` column added; mart_monthly_kpis kept in sync
- `PROJECT_LOG.md` — this entry

---

## 2026-05-20 (PM amendment 5) — CM columns reduced to single canonical form

Final cleanup of the margin layer so there's exactly one column per CM concept.

### Dropped
- `cm1_pct`, `cm2_pct`, `cm3_pct` — duplicated the dollar CMs as percentages, creating dollar-vs-percent ambiguity in Looker field-pickers. Percentages now derived in Looker calc fields:
  - `CM1 % = cm1 / revenue * 100`
  - `CM2 % = cm2 / revenue * 100`
  - `CM3 % = cm3 / revenue * 100`
- `meta_gross_profit_naive` — confusingly named, easy to derive (`meta_revenue − meta_spend`). Dropped to reduce noise.

### Final `mart_daily_kpis` column list (live, 36 columns)
```
client_id, date, currency,
revenue, new_customer_revenue, returning_customer_revenue,
net_sales, shipping_revenue, tax_collected, gross_revenue_incl_tax,
cogs,
orders, unique_customers, new_customer_orders, returning_customer_orders,
meta_spend, meta_revenue, meta_purchases, meta_impressions, meta_clicks, meta_reach,
fulfillment_cost,
cm1, cm2, cm3,
aov, aov_new, aov_returning,
return_customer_rate_period,
mer, amer, cac,
meta_roas, meta_ctr_pct, meta_cpc, meta_cost_per_purchase
```

Only ONE `cm1`, one `cm2`, one `cm3` — all dollar values. Same in `mart_monthly_kpis` (plus the `mom_*` and `prev_month_*` growth columns).

### Looker calc fields to add after refreshing the data source
| Calc field name | Formula |
|---|---|
| CM1 % | `cm1 / revenue * 100` |
| CM2 % | `cm2 / revenue * 100` |
| CM3 % | `cm3 / revenue * 100` |
| EBITDA estimate | `cm3 - revenue * 0.30` |
| EBITDA % | `(cm3 - revenue * 0.30) / revenue * 100` |

### Files changed
- `infra/bigquery/300_create_mart_views.sql` — pct columns and meta_gross_profit_naive removed from both views; header doc updated.
- `PROJECT_LOG.md` — this entry.

### Verified numbers (Apr 19 – May 19, Dobias USD)
Revenue $224,665 / COGS $44,379 / Shipping $8,255 / Marketing $4,869 / **CM1 $172,030 / CM2 $180,286 / CM3 $175,416**. Differences vs Shopify ($161k / $169k / $164k) remain explained by refund-netting (~$6k) and COGS-at-current vs COGS-at-order (~$5k) — formulas correct, data gaps tracked.

---

## 2026-05-20 (PM amendment 4) — CM stack realigned to Shopify-standard

Reconciliation against Matěj's Shopify report (Apr 19 – May 19, Dobias USD) revealed the CM definitions needed restating to match the standard D2C convention Shopify uses. Shopify CMs:
- CM1 $161,308 — implies CM1 = Net Sales − COGS (shipping excluded from numerator)
- CM2 $168,999 — CM1 plus shipping revenue ($7.7k), no fulfillment cost subtracted (Shopify doesn't track it either)
- CM3 $164,450 — CM2 minus $4,549 marketing

### Final definitions (now live)
- **CM1 = Net Sales − COGS** (product viability; pure merchandise margin)
- **CM2 = CM1 + Shipping Revenue − Fulfillment Cost** (= revenue − COGS − fulfillment; lets you see if shipping itself is profitable)
- **CM3 = CM2 − Marketing Spend** (true ROI of paid acquisition)
- All `cm*_pct` use **revenue** (net + shipping) as denominator for cross-period comparability

### Dropped columns
- `product_margin` (now redundant — exactly equals CM1 under the new definitions)
- `gross_margin_pct` (replaced by `cm1_pct` over revenue; if a Net-Sales-based margin % is wanted, add Looker calc: `cm1 / net_sales × 100`)

### Shoptet COGS fix
- Shoptet `cogs` was computed as `total_with_vat_czk − margin_czk`, which mixed in VAT and shipping. Corrected to `product_revenue_czk − margin_czk` (the implicit product COGS).

### Reconciliation: warehouse vs Shopify, Apr 19 – May 19, Dobias USD

| Metric | Warehouse | Shopify | Gap | Cause |
|---|---:|---:|---:|---|
| Orders | 1,449 | 1,435 | +14 | **Timezone:** `order_date` is UTC; Shopify dashboard uses shop tz |
| Net sales | $216,409 | $210,000 | +$6,409 | **Refund-netting not applied** (Priority 1 in original brief). Shopify nets returns from net_sales; we don't |
| Shipping | $8,255 | $7,800 | +$455 | Same refund-netting |
| Revenue (net+ship) | $224,665 | $217,800 | +$6,864 | Same refund-netting |
| COGS | $44,379 | ~$48,700 | −$4,321 | **Cost-at-order vs current cost.** Shopify uses cost snapshot at order time; we use current `inventoryItem.unitCost`. SKU costs have come down slightly |
| **CM1** | $172,030 | $161,308 | +$10,722 | Refund + COGS gaps compound |
| **CM2** | $180,286 | $168,999 | +$11,287 | Same |
| **CM3** | $175,416 | $164,450 | +$10,966 | Same |

**The formulas are right.** The systematic ~$11k gap across all three CMs is fully explained by two pre-existing tracked issues:
- ~$6k from missing refund-netting (already P1 in the original brief — refund pull from Bulk API + subtract in stg/mart)
- ~$4–5k from COGS-at-current vs COGS-at-order time (new issue — Shopify snapshots `cost` at order time; we re-cost with the latest products table value)

### New tracked issues
- **Timezone correction** for order_date — UTC → shop-tz (or just expose both). Causes ~1% order-count drift.
- **COGS-at-order snapshot** — would need to pull `lineItem.discountedUnitPriceSet` + `lineItem.product.totalInventory` cost from each order's bulk export, rather than join against current product cost. This is more work but exactly matches Shopify.

### On the Looker $51k/$4.5k/$2.5k CM display
Definitely a stale data-source schema. CM definitions have changed 4 times today. Looker Studio caches column meanings; if the chart was bound when CM2/CM3 were collapsed-to-zero placeholders or pointed at the now-dropped `product_margin`, you'll see weird small numbers. Fix:
1. Resource → Manage data sources → Edit `mart_daily_kpis` → **Refresh fields**
2. Open each CM scorecard, check the bound field name still exists, and re-pick if greyed out
3. If still wrong, delete the data source and re-create from `oneeighty-warehouse.mart.mart_daily_kpis` fresh

### Files changed
- `infra/bigquery/300_create_mart_views.sql` — mart_daily_kpis CM definitions, Shoptet COGS, dropped product_margin + gross_margin_pct columns; mart_monthly_kpis kept in sync
- `PROJECT_LOG.md` — this entry

---

## 2026-05-20 (PM amendment 3) — Cleanup: removed duplicate gross_profit columns

After the CM stack landed, both `gross_profit` (== `cm1`) and `gross_profit_product_only` (a different concept) lived in the views — confusing in Looker.

### Removed
- `gross_profit` from `mart_daily_kpis` and `mart_monthly_kpis` (always == `cm1`; pick `cm1`).

### Renamed
- `gross_profit_product_only` → `product_margin` (= net_sales − COGS; true merchandise margin, ex-shipping). Pairs with `gross_margin_pct`.

### Final column inventory (mart_daily_kpis and mart_monthly_kpis) — margin-related:
- `cogs`
- `product_margin` (net_sales − cogs)
- `cm1` (revenue − cogs; includes shipping in numerator — the headline)
- `cm2` (cm1 − fulfillment_cost; == cm1 today, placeholder)
- `cm3` (cm2 − meta_spend; the live after-marketing margin)
- `gross_margin_pct` (= product_margin / net_sales × 100; % version of product_margin)
- `cm1_pct`, `cm2_pct`, `cm3_pct` (all over revenue)
- `fulfillment_cost` (placeholder = 0)

### Note on the Looker net_sales = $420k doubling (not a warehouse issue)
Verified live BQ: `mart_daily_kpis` and `mart_orders` both return identical totals (revenue $216,635, net_sales $208,633 for Dobias 30d). Row count = distinct key count, no duplication.

Most likely cause in Looker Studio:
1. **Stale field schema.** The `revenue` column meaning changed when the mart was rewritten. Resource → Manage data sources → Edit → **Refresh fields** on every data source touching mart_daily_kpis, mart_orders, mart_monthly_kpis.
2. **Two data sources blended in one scorecard** (mart_daily_kpis + mart_orders both expose net_sales — blending sums both).
3. **Date filter mismatch** between the two scorecards being compared.

Recommended debugging order: (a) refresh fields on all mart data sources, (b) click into the scorecard showing $420k and check whether the data source is one of the views or a blend, (c) compare its date range to the $210k scorecard.

### Files changed
- `infra/bigquery/300_create_mart_views.sql` — `mart_daily_kpis` and `mart_monthly_kpis` cleaned.
- `PROJECT_LOG.md` — this entry.

---

## 2026-05-20 (PM amendment 2) — Acquisition MER, AOV split, true RCR, monthly growth

### Added to `mart_daily_kpis`
- **`new_customer_revenue`** — revenue from first-time-customer orders (Shopify: `subtotal + shipping`; Shoptet: `total_with_vat_czk`)
- **`returning_customer_revenue`** — revenue from repeat-customer orders
- **`aov_new`** = new_customer_revenue / new_customer_orders
- **`aov_returning`** = returning_customer_revenue / returning_customer_orders
- **`amer`** (Acquisition MER) = new_customer_revenue / meta_spend
- **`return_customer_rate`** renamed to **`return_customer_rate_period`** with an inline comment flagging it as the period-based (Shopify-style) RCR that inflates with business age. Pointer to the true cohort-based RCR.

### Cohort view clarified
- `mart_customer_cohorts.return_rate_pct` renamed to **`cohort_repeat_rate_pct`** — this is the True RCR: unique customers in cohort with ≥2 lifetime orders / cohort size. Age- and growth-independent.

### New view `mart_monthly_kpis`
- Monthly rollup of `mart_daily_kpis` (one row per client_id, month_start, currency)
- Includes `LAG()`-based **MoM growth** on three metrics: `mom_new_customer_orders_pct`, `mom_new_customer_revenue_pct`, `mom_revenue_pct`
- Exposes `prev_month_*` columns for sanity / debugging
- All daily-summable metrics rolled up; derived rates re-computed correctly from monthly sums
- **CAGR / avg monthly growth** deliberately NOT pre-computed in the view because the right value depends on the user's selected date range. Compute in Looker on top of this view:
  ```
  avg_monthly_growth =
    POWER( last_month_value / first_month_value, 1.0 / (months_in_range - 1) ) - 1
  ```
  Or in SQL ad-hoc:
  ```sql
  POWER(
    SAFE_DIVIDE(MAX_BY(new_customer_orders, month_start),
                MIN_BY(new_customer_orders, month_start)),
    1.0 / NULLIF(DATE_DIFF(MAX(month_start), MIN(month_start), MONTH), 0)
  ) - 1
  ```

### Sample numbers (Dobias 30d, USD)
| Metric | Value |
|---|---:|
| Revenue | $216,635 |
| New customer revenue | $76,553 (35%) |
| Returning customer revenue | $140,082 (65%) |
| New orders | 502 |
| Returning orders | 900 |
| **aMER** | **15.72** (new cust revenue per $1 ad spend) |
| MER (blended) | 44.49 |
| **AOV new** | **$152.50** |
| **AOV returning** | **$155.65** |
| Period RCR (Shopify-style) | 64.19% |

### Cohort true RCR (Dobias USD, showing age effect)
| Cohort month | Size | Returning | True RCR |
|---|---:|---:|---:|
| 2025-10 | 238 | 73 | 30.67% |
| 2025-12 | 247 | 79 | 31.98% |
| 2026-01 | 189 | 62 | 32.80% |
| 2026-03 | 374 | 78 | 20.86% (younger) |
| 2026-05 | 268 | 12 | 4.48% (just born) |

The Oct'25 cohort, 7 months old, has ~30% true RCR. Newer cohorts haven't had time to mature. This is the kind of structural insight Shopify's period RCR hides.

### MoM new-customer-orders growth (Dobias USD)
| Month | New orders | MoM | aMER |
|---|---:|---:|---:|
| 2026-05 (partial) | 425 | +72.06% | 20.99 |
| 2026-04 | 247 | +39.55% | 17.42 |
| 2026-03 | 177 | +59.46% | NULL* |
| 2026-02 | 111 | +18.09% | NULL* |
| 2026-01 | 94 | −13.76% | NULL* |
| 2025-12 | 109 | −6.03% | NULL* |

*aMER NULL Dec'25 – Mar'26 — Meta spend for Dobias appears unbacked for those months despite the 12-month backfill. Tracked as ingest issue to investigate. The math is correct (NULL meta_spend → NULL division), but the underlying Meta data should be there.

### Files changed
- `infra/bigquery/300_create_mart_views.sql` — `mart_daily_kpis` extended, `mart_customer_cohorts` column renamed + commented, **new `mart_monthly_kpis` view appended**.
- `PROJECT_LOG.md` — this entry.

### Known issue surfaced
- **Dobias Meta data missing Dec'25 – Mar'26.** Workflow backfill was supposed to cover 12 months; aMER NULL across those months. Likely a backfill that didn't complete or a date-range bug. Worth investigating before relying on early-2026 MoM aMER values.

---

## 2026-05-20 (PM amendment) — CM stack corrected to D2C standard

Initial CM model had CM2 = CM1 − marketing and CM3 as placeholder. Corrected to the standard D2C definition (Matěj):

- **CM1** = Revenue − COGS  (Gross contribution margin — product viability)
- **CM2** = CM1 − Fulfillment costs (shipping, packaging, payment processing, returns) — After-fulfillment margin
- **CM3** = CM2 − Marketing spend (Meta today; Google / affiliates later) — After-marketing margin

`fulfillment_cost` is a **placeholder column = 0** until we ingest shipping cost, packaging, payment-processing fees, and returns. So CM2 == CM1 today; CM3 is the live "true ROI of paid acquisition" figure. When fulfillment data lands, only the CM2 line moves and CM3 drops accordingly — no schema changes needed downstream.

**Dobias 30d post-correction** (USD):
- Revenue $216,635
- COGS $42,889 → **CM1 $173,745 (80.2%)**
- Fulfillment $0 (placeholder) → **CM2 $173,745 (80.2%)**
- Meta $4,869 → **CM3 $168,876 (77.95%)** ← the live after-marketing margin

Looker EBITDA calc field unchanged: `cm3 − revenue × 0.30`.

Files changed: `infra/bigquery/300_create_mart_views.sql` (header docs + mart_daily_kpis CM2/CM3 expressions + new `fulfillment_cost` column).

When wiring fulfillment data: target is per-order `shipping_cost`, `packaging_cost`, `payment_fee`, `refund_cost` in stg, aggregated daily into `fulfillment_cost` in mart_daily_kpis. Then CM2 expression becomes `CM1 − fulfillment_cost` and the placeholder zero goes away.

---

## 2026-05-20 — Mart-layer formula audit + contribution-margin model

Triggered by a cross-check audit of every formula in `mart.*` before the Looker rebuild. Found 3 substantive bugs and reshaped the daily P&L around a contribution-margin stack at Matěj's request.

### Decisions
- **Revenue redefined.** `revenue` is now **net sales + shipping** — what the customer pays us, ex-tax. Shipping is included because the customer pays for it and it tells us whether shipping is profitable. Old `total_price` (incl. tax) preserved as `gross_revenue_incl_tax` for refund reconciliation and transparency.
  - Shopify: `subtotal_price + total_shipping`
  - Shoptet: `total_with_vat_czk` (VAT-netting deferred — Shoptet doesn't split shipping ex-VAT cleanly; flagged as TODO)
- **CM1 / CM2 / CM3 contribution-margin stack added** to `mart_daily_kpis`:
  - **CM1** = revenue − COGS  (= what we used to call gross_profit)
  - **CM2** = CM1 − Meta spend (the only paid channel today)
  - **CM3** = CM2 − [other variable costs]  — placeholder; identical to CM2 until payment-fees / fulfillment / brand-marketing data lands
  - Plus `cm1_pct`, `cm2_pct`, `cm3_pct` (all over revenue)
- **EBITDA stays out of the warehouse.** Looker Studio computes it as a calc field: `cm3 − revenue × 0.30`. When per-client tuning is needed, move OpEx % to `ref.clients.opex_pct` and join in mart.
- **Dropped from `mart_daily_kpis`:** `net_profit_naive`, `net_profit_estimated`. Replaced by CM2/CM3 + Looker-side EBITDA calc.

### Bugs fixed
1. **Line-item revenue overstate (~6% on gross profit)** — `stg_shopify_order_items.revenue = qty*price − line_discount` didn't allocate Shopify cart-level (order-level) discounts to lines. mart_daily_kpis was using line-revenue indirectly. Fix: `mart_daily_kpis` now computes `gross_profit = SUM(subtotal_price + shipping) − SUM(line_cost)` directly from order-header subtotal (which is already net of all discounts), bypassing the line-revenue formula. Impact for Dobias 30d: gross profit fell from $176,745 → **$173,745** (closer to truth; ~$3k correction).
2. **`gross_margin_pct` denominator inflated** — was `gross_profit / total_price` (incl. tax & shipping). Now `gross_profit_product_only / net_sales`, the true merchandise margin. Dobias 30d: 79.08% → **79.44%** (small swing because shipping/tax washes out close to the COGS pull).
3. **Email `ctr_pct` was misnamed CTOR** — formula was `clicks / opens` (click-to-open rate) but labeled `ctr_pct`. Renamed to `click_rate_pct` with the correct **`unique_clicks / delivered × 100`** definition. Per Matěj's request: we track click rate, not CTOR. Applied in both `mart_email_campaign_perf` and `mart_email_flow_perf`.

### Naming changes
- **Meta pre-divided fields renamed with `_per_day` suffix** to flag them as non-aggregatable across rows. Affected: `ctr` → `ctr_per_day`, `cpc` → `cpc_per_day`, `purchase_roas`/`roas` → `roas_per_day`, plus the derived `cost_per_purchase_per_day` and `aov_meta_per_day`. The component sums (spend, clicks, impressions, purchases, purchase_value) remain available so Looker can recompute correctly across date ranges.
- Affected views: `mart_meta_campaign_perf`, `mart_meta_ad_perf`.

### Structural changes
- **`mart_daily_kpis` rewritten** to aggregate Shopify revenue from `stg_shopify_orders` directly, then LEFT-JOIN a separate COGS CTE from `stg_shopify_order_items`. This avoids the previous `ANY_VALUE(dm.gross_profit)` fragility from joining a pre-aggregated CTE onto each order row.
- **`mart_orders` rebuilt** with the new revenue definition. New columns: `net_sales`, `shipping_revenue`, `tax_collected`, `gross_revenue_incl_tax`. The old `total_price` field is gone — Looker bindings that referenced it need to switch to `revenue` (new definition) or `gross_revenue_incl_tax` (old definition).
- **`mart_customer_lifetime`** uses the new Shopify revenue definition (subtotal + shipping) for `lifetime_revenue`. Cohort view follows automatically.

### Known issues surfaced (not fixed in this pass)
- **Klaviyo `delivered` is NULL** in `stg_klaviyo_campaigns` → all Klaviyo derived rates (open_rate_pct, click_rate_pct, conversion_rate_pct, revenue_per_email) come back NULL. Klaviyo's `/api/campaigns/` endpoint doesn't return delivery counts directly; needs a separate fetch (likely `/api/campaign-values-reports/` with `delivered` statistic). Tracked as a Priority-4 item.
- **Stray 11 CAD revenue** for Dobias survives the Matrixify filter — 2 real orders via numeric-channel `source_name` (one $11 refunded, one $0 PAID). Trivial volume; not Matrixify; no fix needed. Noted.
- **Manami revenue includes VAT** because Shoptet doesn't expose shipping or tax breakdowns in our ingest. Until we fix, Manami `net_sales` ≈ `product_revenue_czk` but `revenue` ≈ `total_with_vat_czk` (inflated vs the "customer-paid ex-tax" definition).
- **Cost-coverage in stg_shopify_order_items is 99.85% of line revenue**, not 89% as v3 brief stated. The brief's figure was conservative — coverage is essentially complete.

### Verification numbers (Dobias 30d, USD, post-fix)

| Metric | Value |
|---|---|
| Revenue (net sales + shipping) | $216,635 |
| Net sales | $208,633 |
| Shipping revenue | $8,002 |
| Tax collected | $6,961 |
| Gross revenue incl. tax | $223,496 |
| COGS | $42,889 |
| Gross profit / CM1 | $173,745 |
| CM2 (after $4,869 Meta) | $168,876 |
| CM3 (placeholder = CM2) | $168,876 |
| Merchandise margin % | 79.44% |
| CM1 % | 80.2% |
| CM2 % | 77.95% |
| Orders | 1,400 |

EBITDA at 30% OpEx (compute in Looker): `168,876 − 0.30 × 216,635 = $103,886`.

### Verification (Manami 30d, CZK)

| Metric | Value |
|---|---|
| Revenue | 227,691 CZK |
| Net sales | 216,276 CZK |
| COGS (implicit) | 77,590 CZK |
| Gross profit / CM1 | 150,102 CZK |
| CM2 (after 60,058 CZK Meta) | 90,044 CZK |
| Orders | 243 |

### Files changed
- `infra/bigquery/300_create_mart_views.sql` — rewritten (mart_customer_lifetime, mart_customer_cohorts, mart_daily_kpis, mart_orders, mart_meta_campaign_perf, mart_meta_ad_perf, mart_email_campaign_perf, mart_email_flow_perf). `mart_sku_perf`, `mart_product_perf`, `mart_email_subscribers` unchanged but file-level header updated.
- `PROJECT_LOG.md` — new file (this).

### Live state
All `CREATE OR REPLACE VIEW` statements executed against BigQuery. New schema is live in `mart.*`. Looker data sources will need **Refresh fields** before chart-binding work begins.

### What this means for the Looker rebuild
- Any chart bound to the old `gross_profit`, `net_profit_naive`, `net_profit_estimated` columns must be re-pointed: `gross_profit` survives (now == CM1); `net_profit_naive` → `cm2`; `net_profit_estimated` → calc field `cm3 − revenue × 0.30`.
- Charts on `revenue` change meaning (was total_price; now net sales + shipping). To keep the old definition for one specific chart, bind to `gross_revenue_incl_tax`.
- Meta chart bindings: `ctr`/`cpc`/`roas` → `ctr_per_day`/`cpc_per_day`/`roas_per_day` if used as scorecards on a single row. For date-range scorecards, **recompute** in Looker: `CTR = SUM(clicks)/SUM(impressions)`, `CPC = SUM(spend)/SUM(clicks)`, `ROAS = SUM(purchase_value)/SUM(spend)`.
- Email chart bindings: `ctr_pct` → `click_rate_pct` (the number will look ~5–10× lower than before, because the old field was actually CTOR).

---
