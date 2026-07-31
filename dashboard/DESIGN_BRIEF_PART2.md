# One Eighty Dashboard — design brief, part 2: the complete UI

Continues `DESIGN_BRIEF.md`. Part 1 covered the Profitability snapshot, the app shell and the rules. This part specifies **every remaining screen**, with real data for each.

Same constraints throughout: One Eighty design system, English UI, mono tabular figures, platform badge on every metric, direction ≠ sentiment on every delta, "no data" ≠ "zero".

---

## A. Fixes to what's already designed

Three things to correct in the current Profitability snapshot before going further.

**1. The period and the numbers disagree.**
The control bar shows `12M` selected, `Jul 30, 2025 – Jul 29, 2026`, but the cards show `$204,974` revenue — which is the **30-day** figure. As drawn, it reads as a business doing $205k a *year*, which changes how every other number on the page feels. Select **30D** and set the range to `Jun 30 – Jul 29, 2026`, comparison `May 31 – Jun 29, 2026`.

**2. The user is Matěj Rožsypal**, not Matěj Šimek.

**3. The headline row is a 3-column grid with four cards**, so Paid spend wraps alone and the row looks broken. Make it 4-up on wide screens, 2×2 below.

**Two things to keep** — both are better than what was briefed:

- The `WAREHOUSE` badge on CM3 and CM3% is a genuinely good call. CM3 isn't from one platform; it's Shopify revenue minus warehouse COGS minus Meta and Google spend. Consider making that literal on hover — a badge that expands to the contributing sources — because "where did this number come from" is the first question anyone asks about a margin figure.
- Sparkline color following sentiment (green for revenue and CM3, neutral for spend) works well. One inconsistency: CM3%'s sparkline is neutral while its delta chip is red. Pick one — the delta is right, so the sparkline should be neutral *or* the whole card should read negative. Neutral sparkline + colored delta is probably the calmer choice; just apply it consistently.

---

## B. Remaining screens

Ordered by how soon each can be built. **Screens B1–B5 have live data today.** B6–B7 need new warehouse work and are marked accordingly — design them, but know they ship later.

---

### B1 · Profitability → Orders

Order-level detail. The page you open when a number on the snapshot looks wrong.

**Backed by:** `mart.mart_orders` — live.

**Layout:**
- Summary row: Orders, Revenue, AOV, % returning.
- **Market split** — this is the section Matěj specifically wanted. Dobias sells into the US and Canada from one store, and the split matters.
- Orders table: date, order number, customer email, country, revenue, net sales, shipping, discounts, financial status, new/returning.
- Filters: country, financial status, new vs returning.

**Real data — Dobias, last 30 days, market split:**

| Country | Orders | Revenue | AOV | Returning |
|---|---:|---:|---:|---:|
| US | 962 | $152,244 | $158.26 | 77.9% |
| CA | 398 | $55,164 | $138.60 | 83.2% |
| *(blank)* | 6 | $718 | $119.65 | 83.3% |
| RS | 3 | $460 | $153.23 | 33.3% |
| GB | 2 | $441 | $220.53 | 100.0% |
| NL | 1 | $421 | $421.05 | 0.0% |

**Design notes:**
- That blank country is real — 6 orders with no shipping country. Don't hide it, don't label it "Unknown" as if that were a place. It's missing data and should look like missing data.
- The long tail is 1–3 orders per country. A pie chart would be unreadable. A ranked bar or table with a collapsed "Other" row is better.
- The table needs to feel fast at 1,300+ rows. Show the interaction model — sticky header, virtualised scroll or pagination, and where sorting lives.

---

### B2 · Profitability → Products

What actually makes the margin.

**Backed by:** `mart.mart_product_perf` and `mart.mart_sku_perf` — live.

**Layout:**
- Toggle: Products / SKUs.
- **Product line filter.** Dobias sells canine and human supplements from one store; splitting them is a real analytical need.
- Table: product, line, units, revenue, margin, margin %.
- A margin-vs-revenue scatter or ranked bar — the useful question is "which products are big *and* profitable", which a sorted table alone doesn't answer.

**Real data — Dobias, last 30 days:**

| Product | Line | Units | Revenue | Margin | Margin % |
|---|---|---:|---:|---:|---:|
| GutSense® | canine | 837 | $41,080 | $36,552 | 89.0% |
| FeelGood Omega® (#1 best-seller) | canine | 1,139 | $37,525 | $27,342 | 72.9% |
| SoulFood® | canine | 567 | $29,610 | $25,459 | 86.0% |
| JointPowder | canine | 296 | $19,899 | $14,524 | 73.0% |
| GreenMin® | canine | 485 | $19,811 | $16,004 | 80.8% |
| LiverTune® | canine | 263 | $13,546 | $10,863 | 80.2% |
| FeelGood Omega® H+ | human | 257 | $8,627 | $6,407 | 74.3% |
| JointButter® H+ | human | 83 | $5,502 | $4,839 | 88.0% |
| MitoBoost™ | canine | 128 | $5,330 | $4,039 | 75.8% |
| GutSense® H+ | human | 83 | $4,359 | $3,276 | 75.2% |
| SkinSpray | canine | 133 | $4,157 | $3,320 | 79.9% |
| SoulFood® H+ | human | 80 | $4,040 | $2,834 | 70.2% |

**Design notes:**
- Product names are long, contain ®/™, and one is a full sentence. Truncation rules matter — design the longest one, not a tidy placeholder.
- Margin % spans 70–89%. Don't design a bar scaled 0–100%; the whole set would sit in a narrow band at the right. Scale to the data.
- Note the pattern worth surfacing: the #1 seller by units (FeelGood Omega, 1,139) is only #2 by revenue and has the *lowest* margin % of the top three. That tension is the insight this page exists to show.

---

### B3 · Marketing → Paid

Meta and Google in one place, which no native platform UI does.

**Backed by:** `mart.mart_meta_campaign_perf` and `mart.mart_meta_ad_perf` — live. **Google has no mart view yet** — only `stg.stg_google_ads_campaign_insights`. Design the Google half; it needs a small piece of warehouse work first.

**Layout:**
- Channel summary: Meta vs Google — spend, revenue, ROAS, CPA, side by side.
- Campaign table, filterable by channel.
- Spend-over-time, split by channel.

**Real data — Meta campaigns, last 30 days:**

*Dobias (USD):*

| Campaign | Spend | Revenue | Purchases | ROAS | CPA | CTR |
|---|---:|---:|---:|---:|---:|---:|
| US I Prospecting I Broad I 2026-04 I OE | $3,587 | $8,079 | 52 | 2.25× | $68.99 | 2.89% |
| CA I PACKS CBO I Broad I 2026-06 I OE | $2,248 | $4,534 | 34 | 2.02× | $66.12 | 2.91% |
| US I PACKS I CBO I 17JULY-26 I OE | $1,111 | $7,520 | 48 | 6.77× | $23.15 | 4.71% |
| US I Catalog I Broad I 2026-04 I OE | $1,074 | $1,119 | 8 | 1.04× | $134.26 | 1.56% |
| CA I PACKS I CBO I 21JULY-26 I OE | $863 | $3,854 | 29 | 4.47× | $29.75 | 3.20% |
| US & CA I RecipeMaker I Broad I 17JUN I OE | $595 | *none* | *none* | *none* | *none* | 5.45% |
| US & CA I IndependenceDay I 4JULY I OE - Copy | $63 | $1,419 | 9 | 22.64× | $6.96 | 4.61% |
| CA I Catalog I Broad I 2026-06 I OE | $43 | *none* | *none* | *none* | *none* | 1.31% |

*Manami (CZK):*

| Campaign | Spend | Revenue | Purchases | ROAS | CPA | CTR |
|---|---:|---:|---:|---:|---:|---:|
| PACKS CBO \| CZ \| 16JUN | 38,807 Kč | 53,804 Kč | 69 | 1.39× | 562.43 Kč | 2.36% |
| Prospecting \| CZ \| ABO | 28,743 Kč | 64,681 Kč | 71 | 2.25× | 404.83 Kč | 2.80% |

**Design notes — this table is where the hard cases live:**
- **Two campaigns spent money and returned no attributed revenue.** Not zero — *no conversions recorded*. ROAS and CPA are genuinely undefined. This is the single most important empty-state in the product: a campaign showing `0.00×` ROAS looks like a failing campaign, while `—` correctly says "spent $595, nothing attributed back."
- **ROAS spans 1.04× to 22.64×.** The 22.64× campaign spent $63 — statistically meaningless. Consider a visual weight for spend, or a low-volume marker, so a rounding-error campaign doesn't top the sort and look like the winner.
- Campaign names are long, pipe-delimited, inconsistently spaced (`I` vs `|`), and one ends in `- Copy`. Design for them as they are.
- Meta's revenue is **self-reported attribution** and systematically overstates. Dobias's Meta claims $8,079 from one campaign while total paid spend is $9,585 against $204,974 revenue. The page should not silently present Meta's ROAS as truth next to warehouse revenue. Some visual separation between "platform-reported" and "warehouse-measured" is needed — this is exactly the confusion the whole warehouse exists to fix.

---

### B4 · Marketing → Email

**Backed by:** `mart.mart_email_campaign_message_perf`, `mart.mart_email_daily`, `mart.mart_email_flow_daily` — live. `mart.mart_email_subscriber_daily` exists but is **empty** — a backfill is blocked on a Klaviyo segment that hasn't been created.

**Layout:**
- Summary: email revenue, share of total revenue, campaigns sent, average open and click rate.
- Campaign vs flow revenue split over time.
- Campaign table.
- **List growth — designed but empty.** Real, not hypothetical: design what this looks like when the data genuinely isn't there yet and the fix is a task on someone's list.

**Real data — Dobias campaigns, last 45 days, by revenue:**

| Campaign | Sent | Recipients | Delivered | Opens | Clicks | Orders | Revenue | Open % | Click % | AOV |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| [2026-06-30] Every 10th Order is Free (Announcement) | Jun 30 | 43,932 | 43,542 | 14,498 | 183 | 85 | $14,174.72 | 33.3% | 0.42% | $166.76 |
| [2026-07-04] Every 10th Order is Free (Last Call) | Jul 4 | 43,855 | 43,463 | 14,181 | 415 | 68 | $11,692.29 | 32.6% | 0.95% | $171.95 |
| [2026-07-25] Calamari oil - benefits, studies | Jul 25 | 43,607 | 43,205 | 14,088 | 431 | 56 | $9,272.16 | 32.6% | 1.00% | $165.57 |
| [2026-07-11] Monthly Recap | Jul 11 | 43,696 | 43,247 | 14,347 | 388 | 49 | $8,805.62 | 33.2% | 0.90% | $179.71 |
| [2026-07-21] Get to know your vet with Barbara Royal | Jul 22 | 43,692 | 43,259 | 14,429 | 205 | 43 | $7,535.29 | 33.4% | 0.47% | $174.24 |
| [2026-06-18] Joints: Start before there's a problem | Jun 19 | 44,147 | 43,775 | 15,473 | 445 | 41 | $7,356.50 | 35.3% | 1.02% | $179.43 |

**Design notes:**
- Click rate is `unique_clicks / delivered`, **not** click-to-open. It reads low (0.4–1.0%) because it's the honest denominator. Label it unambiguously — someone used to Klaviyo's CTOR will think it's broken.
- Open rates are flat at 32–35% across every campaign while revenue ranges 2× — so open rate is not the story and shouldn't get the visual weight. Revenue per recipient is the metric that separates these campaigns. Consider leading with it.
- Campaign names carry a `[YYYY-MM-DD]` prefix, one has a leading space, and the send date sometimes differs from the name's date (the Jul 21 campaign sent Jul 22). Show both without implying an error.

---

### B5 · Retention → Cohorts

**Backed by:** `mart.mart_customer_cohorts` — live. This one is methodologically ahead of the reference tool and the design should show why.

**Layout:**
- Cohort table by first-order month.
- **Two LTV columns side by side: lifetime LTV and Y1 LTV.** The distinction is the point (see below).
- A maturity indicator per cohort.

**Real data — Dobias, USD:**

| Cohort | Customers | Y1 complete | LTV | Y1 LTV | Y1 LTGP | Orders/cust | Repeat rate |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2026-07 | 294 | 0 | $130.63 | — | — | 1.04 | 4.4% |
| 2026-06 | 302 | 0 | $135.62 | — | — | 1.11 | 9.6% |
| 2026-05 | 248 | 0 | $141.48 | — | — | 1.26 | 18.1% |
| 2026-04 | 358 | 0 | $188.91 | — | — | 1.45 | 29.1% |
| 2026-03 | 277 | 0 | $169.58 | — | — | 1.40 | 24.9% |
| 2026-02 | 233 | 0 | $201.19 | — | — | 1.53 | 29.2% |
| 2026-01 | 212 | 0 | $181.64 | — | — | 1.55 | 31.1% |
| 2025-12 | 291 | 0 | $205.10 | — | — | 1.66 | 33.3% |
| 2025-11 | 313 | 0 | $228.01 | — | — | 1.75 | 38.3% |
| 2025-10 | 261 | 0 | $240.53 | — | — | 1.82 | 36.0% |
| 2025-09 | 278 | 0 | $206.10 | — | — | 1.73 | 36.7% |
| 2025-08 | 289 | 0 | $276.31 | — | — | 2.00 | 41.5% |
| 2025-07 | 279 | 268 | $236.71 | $227.99 | $169.64 | 1.98 | 40.5% |
| 2025-06 | 288 | 288 | $288.43 | $268.72 | $199.92 | 2.16 | 41.3% |

**Design notes — this is the most important interpretive problem in the product:**

Read the repeat-rate column top to bottom: 4.4% → 41.3%. It looks like retention has collapsed. **It hasn't.** July's cohort has had three weeks to make a second purchase; June 2025's has had thirteen months. This is a maturity artifact, and every cohort table in every analytics tool shows it while almost none explain it.

The design has to make the age effect self-evident. Options worth exploring: cohort age as an explicit column, a shaded "still maturing" band, or a triangle/heatmap layout where the diagonal makes incompleteness structural rather than something you have to know to look for.

The Y1 columns are the honest fix — every customer measured over the same 365-day window — but they're only computable once a cohort is fully mature, which is why **twelve of fourteen rows are empty.** That's not a gap to hide. A table that's mostly empty in its most rigorous column is telling the truth, and the design should frame it as rigor, not as missing data.

---

### B6 · Retention → Repeat rate ⚠️ needs warehouse work first

The reference tool has Repurchase Rate, Repurchase Breakdown and Time Between Orders. We have the first; the other two need new SQL.

- **Repeat rate over time** — from `mart_customer_cohorts.cohort_repeat_rate_pct`. Available.
- **Time between orders** — distribution of gaps between consecutive orders per customer. **New view required.** Straightforward from `stg_shopify_orders` / `stg_shoptet_orders`, roughly an hour of work.
- **Repurchase breakdown by first product** — which first purchase predicts a second. **New view required**, from `stg_shopify_order_items`. This is the most commercially interesting metric on the list: it tells you which product to acquire on.

Design all three. Mark the latter two clearly as pending data so nobody builds against them expecting live numbers.

---

### B7 · Admin → Data Health

Expanded from part 1. Three sections:

**Source freshness** — real state as of 2026-07-30:

| Source | Client | Last date | Expected | Status |
|---|---|---|---|---|
| Shopify | Dobias | Jul 30 | same day | OK |
| Shoptet | Manami | Jul 30 | same day | OK |
| Meta | Dobias | Jul 29 | D-1 | OK |
| Meta | Manami | Jul 29 | D-1 | OK |
| Google Ads | Manami | Jul 29 | D-1 | OK |
| Klaviyo campaigns | Dobias | Jul 25 | on send | OK |
| Klaviyo subscribers | Dobias | *never* | — | Blocked |

Note that "OK" means different things per source — same-day for shops, D-1 for ad platforms (structural, unfixable), event-driven for email. A design that shows one uniform "last updated" makes the ad platforms look permanently late.

**Pipeline runs** — from `ops.pipeline_log`, 1,612 runs in the last 90 days. Timestamp, workflow, rows, status, duration.

**Registry drift** — live examples, both real:

- `dobias.currency` is `CAD` in the registry; every warehouse row is `USD`. *Consequence: every monetary figure for this client is labelled with the wrong currency.*
- `manami.has_gads` is `false`; Google Ads has been spending since October 2025 (~19,000 Kč/month, netted into CM3). *Consequence: Google cards hidden for a client actively spending.*

These need a treatment that reads as "your configuration disagrees with your data" — serious, actionable, but not an outage. Each should state the consequence in plain language, as above.

---

### B8 · Sign-in

Google SSO, restricted to `@oneeighty.cz`. One button. Worth designing properly because it's the first thing seen and currently it's unstyled.

States: default, signing in, rejected (wrong domain — needs a clear, non-blaming message), error.

---

## C. Global components to specify

Pin these down once so they're consistent across all screens:

| Component | Notes |
|---|---|
| Metric card | Every state from part 1 §5 |
| Data table | Sort, sticky header, pagination/virtual scroll, numeric alignment, long-text truncation, row hover, empty state |
| Delta chip | Three sentiments × three directions |
| Platform badge | Six platforms + `WAREHOUSE` (computed) |
| Date range picker | Presets, custom range, comparison selector — open state |
| Client switcher | Open state; also the single-client case for Phase 2 |
| Warning banner | Info / warning / blocked severities |
| Empty state | Not connected · no data yet · blocked, with an action where one exists |
| Chart set | Sparkline, line, stacked area, waterfall, ranked bar, cohort table/heatmap |
| Skeleton loaders | Per component |
| Tooltip | Metric definition on hover — sourced from METRICS.md, since half these metrics need a sentence of explanation |

---

## D. Deliverable

For each screen B1–B8: **desktop + mobile**, using the real data above. Plus the component sheet from §C.

Where a screen has no live data (B6, and list growth in B4), design the pending state as the primary state rather than mocking numbers that don't exist — the pending state is what will actually ship first.

Flag anything you had to invent that the design system doesn't cover. Those gaps are worth knowing before they get built.
