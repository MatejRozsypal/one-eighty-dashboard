# One Eighty Dashboard — design brief, part 3: the complete metric set

Continues parts 1 and 2. Those specified screens; this one closes the gaps against the project's own metrics dictionary (`METRICS.md`) and the Looker spec (`runbooks/10_looker_studio_metrics_spec.md`), which between them define metrics the first two briefs never mentioned.

**Read §A first — it corrects a number already drawn.**

---

## A. Correction: AOV is defined wrong in parts 1–2

Parts 1 and 2 used `AOV = revenue ÷ orders`, giving Dobias **$152.28**.

The project's canonical definition is different:

```
AOV = net_sales ÷ orders        ← ex-shipping, ex-tax. Matches Shopify.
```

`revenue` in this warehouse means *net sales + shipping*, so dividing it by orders produces AOV-including-shipping — a different metric with a different value. `METRICS.md` marks the net-sales version as canonical precisely because it reconciles against Shopify's own dashboard, and reconciliation is the whole point.

**Both are legitimate and both should exist**, clearly distinguished:

| Metric | Formula | Label |
|---|---|---|
| **AOV** | `net_sales / orders` | "AOV (net)" — the canonical one, leads |
| AOV incl. shipping | `revenue / orders` | secondary, on the Orders page |

The same split applies to `AOV new` and `AOV returning` — both use net-sales numerators (`new_customer_net_sales`, `returning_customer_net_sales`), which exist as columns.

Note the reference dashboard in the original screenshot labels its tile **"AOV (NET)"**. Same reason.

---

## B. New screen · Retention → Time Between Orders

Explicitly requested. **Needs a new warehouse view** (~1 hour); the numbers below are computed live so the design can be built on real shape.

**Layout:**
- Headline stats: median, mean, p25/p75.
- **Distribution histogram** — the main visual.
- Optional: median gap by order number (1st→2nd vs 2nd→3rd, which typically shortens).

**Real data — Dobias, 24 months, 21,068 order-to-order gaps:**

| Statistic | Days |
|---|---:|
| **Median** | **59** |
| Mean | 85.0 |
| 25th percentile | 29 |
| 75th percentile | 107 |
| 90th percentile | 192 |

Distribution:

| Gap (days) | Repeat orders |
|---|---:|
| 0–7 | 1,648 |
| 8–14 | 1,120 |
| 15–30 | 2,812 |
| **31–60** | **5,347** |
| 61–90 | 3,533 |
| 91–180 | 4,298 |
| 181–365 | 1,884 |
| 365+ | 426 |

**Design notes:**

- **Lead with the median, not the mean.** The distribution is heavily right-skewed — a long tail of customers returning after a year drags the mean to 85 days while the typical customer returns in 59. That 26-day gap between the two numbers is the difference between "reorder reminder at 8 weeks" and "at 12 weeks", which is a real campaign decision. Show the mean, but subordinate it, and make the skew visible.
- The 0–7 day bucket (1,648) is mostly not reordering — it's split orders, corrections and forgotten items. Worth marking as such rather than reading it as ultra-loyalty.
- The modal bucket is 31–60 days, which matches a monthly supplement supply. The histogram should make that peak obvious — it's the product's natural consumption cycle and the single most actionable fact on the page.

---

## C. New screen · Retention → Customers

Customer-level economics. Currently missing entirely, though `mart.mart_customer_lifetime` is live and has everything.

**Headline stats — real data, all customers in the 36-month window:**

| Metric | Dobias (USD) | Manami (CZK) |
|---|---:|---:|
| Customers | 11,933 | 2,533 |
| **LTV** (lifetime revenue / customer) | $485.67 | 1,193.28 Kč |
| **LTGP** (lifetime gross profit / customer) | $372.65 | 815.05 Kč |
| **Avg orders per customer** | **3.20** | **1.20** |
| Avg AOV | $132.76 | 936.37 Kč |
| Repeat rate (≥2 orders) | 50.1% | 15.2% |
| Avg days active (repeat customers) | 409 | 138 |

Plus a customer table from `mart_customer_lifetime`: email, first order, last order, total orders, lifetime revenue, lifetime gross profit, AOV, days active, returning flag.

**Design notes:**
- **3.20 vs 1.20 orders per customer** is the sharpest contrast between these two businesses in the whole product. Dobias is a subscription-shaped supplement business; Manami is essentially single-purchase. Any layout implying a "normal" range will be wrong for one of them.
- LTV and LTGP should sit adjacent. The gap between them *is* the COGS — for Dobias, $485.67 → $372.65 means 77% of lifetime revenue survives as gross profit. That ratio is more useful than either number alone.
- These are **36-month-window** figures, not true all-time. `METRICS.md` flags that customers whose first order predates the window are misclassified as new. Needs a footnote, not a hidden caveat.

---

## D. New screen · Growth (month over month)

`mart.mart_monthly_kpis` is live with `LAG()`-based MoM growth and is currently unused by any design.

**Layout:** monthly table + bar/line combo, with MoM % on revenue, new customer orders and new customer revenue.

**Real data — 2026:**

| Month | Dobias revenue | MoM | Dobias new orders | MoM | Manami revenue | MoM | Manami new orders | MoM |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Jul | $194,708 | −2.8% | 278 | −2.5% | 275,227 Kč | +24.7% | 226 | +24.2% |
| Jun | $200,269 | −2.4% | 285 | +23.9% | 220,773 Kč | −9.0% | 182 | −16.1% |
| May | $205,165 | −3.4% | 230 | −31.5% | 242,646 Kč | +65.9% | 217 | +66.9% |
| Apr | $212,418 | +11.1% | 336 | +29.2% | 146,258 Kč | +12.0% | 130 | +11.1% |
| Mar | $191,188 | +17.4% | 260 | +16.6% | 130,578 Kč | +16.4% | 117 | +14.7% |
| Feb | $162,874 | +12.8% | 223 | +12.6% | 112,220 Kč | +14.2% | 102 | +6.3% |
| Jan | $144,413 | −11.2% | 198 | −26.7% | 98,257 Kč | −29.1% | 96 | −11.9% |

**Design notes:**
- **Dobias has declined three months running** after peaking in April. Manami is up 180% since January. Opposite trajectories in one product — good test of whether the design editorialises. It shouldn't; it should just be legible.
- July is partial (data through Jul 30), so its MoM is not comparable. Partial-period rows in a monthly table must be visually distinct or every month-end will produce a false alarm.
- CAGR / average monthly growth is deliberately **not** pre-computed, because the right value depends on the selected range. If the design shows it, it's computed over visible rows — label it accordingly.

---

## E. Metrics missing from the existing screens

Add these to screens already specified.

### E1 · Profitability snapshot — add

| Metric | Formula | Note |
|---|---|---|
| **EBITDA (est.)** | `cm3 − revenue × 0.30` | 30% OpEx assumption. **Must be labelled as an estimate with the assumption visible** — it's a hardcoded guess, not measured. |
| EBITDA % | `(cm3 − revenue × 0.30) / revenue` | |
| Gross margin % | `product_margin / net_sales` | Merchandise margin, ex-shipping |
| LTV / LTGP | from `mart_customer_lifetime` | Cross-link to the Customers screen |

**Revenue composition** — currently only the top-line total is shown. The components exist and reconcile:

`net_sales` + `shipping_revenue` = `revenue` · plus `tax_collected` = `gross_revenue_incl_tax` · and `total_discounts` separately.

Worth a small breakdown block — "what the customer paid vs what we booked" is the second question after seeing revenue, and it's the number that reconciles against Shopify.

**Cost placeholders** — `cm1_other_costs` (inbound freight, duties, packaging, payment fees) and `fulfillment_cost` are both hardcoded zero. Part 1 covered fulfilment; `cm1_other_costs` needs the same treatment and was missed.

### E2 · Paid — add the full Meta set

Parts 1–2 covered spend, revenue, ROAS, CPA, CTR. Also available:

`reach` · `frequency` · `CPC` · `CPM` · `add_to_cart` · `initiate_checkout` · `landing_page_views` · `link_clicks` · `video_views`

- The funnel steps (impressions → clicks → landing page views → add to cart → initiate checkout → purchases) make a real funnel visual — worth designing.
- **Ad-level table** from `mart.mart_meta_ad_perf` — ad name, campaign, spend, revenue, ROAS, reach, CTR, CPC, frequency, conversions, CPA. Currently only campaign level is designed.
- ⚠ **Frequency does not sum.** `METRICS.md` has a dedicated section on this. It's `frequency_per_day` and averaging it across a date range is wrong. Either show it only at single-day grain or recompute as `impressions / reach`. Design must not place it in a summable column beside spend.
- ⚠ Same for `ctr_per_day`, `cpc_per_day`, `roas_per_day` — the `_per_day` suffix is a warning. Always recompute from summed components.
- `daily_budget` is **not ingested**. Skip it.

### E3 · Email — add

| Metric | Formula |
|---|---|
| Conversion rate % | `unique_orders / delivered × 100` |
| Revenue per email sent | `revenue / sent` |
| Total opens / total clicks | (vs unique — repeat opens by one recipient) |
| Bounces | `bounces` |

Plus **flows all-time performance** from `mart_email_flow_perf`, alongside campaigns. Flows are the bigger revenue line in most Klaviyo accounts and part 2 under-weighted them.

### E4 · Orders — add

`total_discounts` · `fulfillment_status` · `source_name` · `cancelled_at` · `shipping_province`

Province enables US state / Canadian province breakdown, a level below the country split already designed.

---

## F. Pending data — design as "not yet connected"

These are in the project scope but have no data. Design the empty states; they're what ships first.

| Feature | Source | Status |
|---|---|---|
| **Channel overview** (donut by acquisition channel) | GA4 | Not wired — GA4 BigQuery link not enabled |
| **Site funnel** (session → add to cart → checkout → purchase) | GA4 | Not wired |
| **Active users trend** | GA4 | Not wired |
| Instagram organic | `stg_instagram_media` | Partial — account insights blocked on token scope |
| Facebook organic posts | `stg_facebook_posts` | Blocked — needs Page Access Token swap |
| Email list growth | `mart_email_subscriber_daily` | Blocked on a Klaviyo segment |
| Google Ads detail | `stg_google_ads_campaign_insights` | Live in stg, **no mart view yet** |

GA4 accounts for three of these. Since GA4 is the only source of traffic and funnel data, its absence is structural: **the dashboard currently cannot answer "where did the traffic come from."** Worth designing the placeholder honestly rather than quietly omitting a channel view.

---

## G. Metric definition tooltips

Given the above, this is no longer optional. Metrics like CM3, aMER, LTGP, "AOV (net)" vs "AOV incl shipping", period RCR vs cohort repeat rate, and `frequency_per_day` all need one sentence of explanation, and several need a caveat.

`METRICS.md` already contains the text. Design a tooltip that fits: definition, formula, source, and — where one exists — a known limitation. The limitation line matters most; it's what stops someone quoting a number to a client that's 3% overstated because refunds aren't netted yet.

**Known caveats that must be surfacable in the UI:**

- Refunds are **not** netted from revenue — net sales overstated ~3% (~$6k/month on Dobias)
- COGS uses current cost, not cost-at-order — ~$4–5k/month drift
- Order dates are UTC; Shopify's dashboard uses shop timezone — ~14 orders/month drift
- Manami's revenue **includes VAT** (Shoptet doesn't split it cleanly) — so Manami's CM% is not directly comparable to Dobias's
- New/returning is derived from a 36-month window, not lifetime history

That last group is why this dashboard should feel more trustworthy than Looker: not because the numbers are perfect, but because it says where they aren't.

---

## H. Updated deliverable

Adds to parts 1–2:

7. **Time Between Orders** — desktop + mobile, with the real histogram
8. **Customers** — desktop + mobile
9. **Growth (MoM)** — desktop
10. **Metric tooltip** component, including the caveat variant
11. **Revenue composition** block for the Profitability snapshot
12. **Meta funnel** visual and ad-level table
13. **GA4-pending** placeholder treatment, reusable across the three GA4 features

And apply the **AOV correction from §A** to the screens already drawn.
