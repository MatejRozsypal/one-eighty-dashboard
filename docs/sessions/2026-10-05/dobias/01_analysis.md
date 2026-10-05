# Dr. Dobias: is Meta's 1-day view credit incremental?

Analysis date 2026-10-05. Read-only: BigQuery reads, Meta Ads MCP reads; scratch tables only in `mart_qa` (`dvt_orders`, `dvt_daily`, `dvt_order_landing`, expire in 30 days). Nothing changed in Meta, n8n, the repo or the Second Brain.

## Bottom line

**Mostly not incremental.** Meta's 1-day view credit for Dobias is largely purchases that would have happened anyway. My central estimate is that only about **10 to 20 % of 1-day view purchases are incremental** (plausible range 0 to 35 %). 7-day click credit holds up much better, at roughly 70 to 100 %.

- **ROAS.** The account's "true" short-term ROAS is about **1.0 to 1.3** (plausible 0.7 to 1.6). Meta reports 2.98 on 7d click + 1d view. 7d click alone (1.11) is the honest yardstick, and 7dc + 1dv overstates by about 2.5x.
- **Incremental CAC.** About **$90 to $120 per incremental "180-day-new" order** (first-time buyers plus customers with no order in 180 days). Meta's reported CPA is about $52.
- **The $6M plan.** Lever 1 ("CPA < $55, ROAS 3.0+, 100 to 600 paid new customers/month") is priced on Meta's own numbers and is about 2x too optimistic on an incremental basis.
- **The data cannot settle it alone.** The time-series design is confounded with everything else One Eighty started in April 2026 (email, CRO, the Canada store merger). A US geo holdout (section 5) is the test that settles it.

---

## 0. Data used and what exists

| Source | Coverage for Dobias | Notes |
|---|---|---|
| `mart_qa.dvt_orders` (built from `mart.mart_orders`) | 2023 to 2026-10-04, both stores | Customer = normalised email. CA store (`canada_migrated`) runs to Mar 2026. The US store (`us_native`) starts **May 2024**, so "first-ever" is inflated in 2024 to 2025. I therefore use a consistent **"180-day-new" (n180)** definition: an order whose email had no order in the previous 180 days. It is valid from Nov 2024 and is exactly Meta's own exclusion definition ("Purchase 180 days"). |
| Meta, warehouse (`mart_meta_ad_perf` window columns, `mart_meta_campaign_dim`) | 2026-04-20 to 2026-10-04, account act_38180535 | Window split complete for every delivery day (ME2 backfill). |
| Meta, account history via the Meta Ads MCP | Oct 2023 to Oct 2026 | Monthly spend and purchases (no window split). |
| Klaviyo (`mart.mart_email_daily`) | Campaign revenue all period; campaign sends only from Dec 2025; **July 2026 missing** | Used as a control and for day flags only. |
| GA4 (`mart.mart_ga4_sessions_daily`) | **Only from 2026-08-01** | No pre-period. |
| Shopify `landing_site` / `referring_site` (`dvt_order_landing`) | Usable from about mid-May 2026; patchy (Aug: 758 of 1,579 orders without it) | Proxy for last-session channel. |

**Correction to a known "gap".** The Meta account API shows **zero spend from Jan 2025 to Mar 2026** (only $150 in Apr 2025, a job post) and zero from 1 to 19 Apr 2026.

- So the "Dobias Meta spend missing Dec'25 to Mar'26" item in METRICS.md is **not missing data**. It is a real 15-month pause.
- The previous agency ran Meta from at least Oct 2023 to Dec 2024.
- Suggested owner action (not done): register 2025-01-01 to 2026-04-19 in `ref.ad_spend_zero_days`.

**Current setup** (Meta MCP, ad set level). This covers ad sets with $64.0k of the $64.8k spent since 2026-04-20; one page of ad sets out of two was read.

- Every campaign is prospecting with Advantage+ audience. **There is no retargeting campaign**, so a prospecting vs retargeting comparison is not possible on current data.
- Exclusions on the PACKS campaigns (the majority of spend since July): only the pixel audience "Purchase I 180 days" plus several Madgicx lookalike audiences.
- The Prospecting and Catalog ad sets also exclude a static "180 DAYS PURCHASED 30JUN BIQUERY EXPORT" list and FB/IG engagers (180 days).
- Customers whose last order was more than 180 days ago are not excluded anywhere.
- Attribution settings: mostly `1d_view_7d_click` or `1d_view_7d_click_1d_ev`; two ad sets are on `7d_click`.

## 1. Time series and natural experiments

### Monthly picture (US + CA shop orders, Meta spend and claims)

| Month | Meta spend | Meta claims 7dc / 1dv / 1d_ev | Shop orders | n180 orders | n180 YoY | Repeat orders within 180 days (Meta-excluded), YoY |
|---|---|---|---|---|---|---|
| Jan 26 | 0 | none | 1,005 | 321 | -33 % | -7 % |
| Feb 26 | 0 | none | 1,038 | 339 | -6 % | +6 % |
| Mar 26 | 0 | none | 1,319 | 435 | -17 % | +3 % |
| Apr 26 | 1.7k (from 20 Apr) | 12 / 26 / 1 | 1,369 | 510 | +11 % | +18 % |
| May 26 | 5.1k | 43 / 99 / 10 | 1,322 | 391 | -7 % | +22 % |
| Jun 26 | 7.8k | 58 / 101 / 20 | 1,293 | 507 | +20 % | +7 % |
| Jul 26 | 9.9k | 95 / 104 / 31 | 1,340 | 487 | +18 % | +10 % |
| Aug 26 | 17.9k | 174 / 206 / 62 | 1,561 | 585 | +28 % | +10 % |
| Sep 26 | 19.8k | 144 / 195 / 48 | 1,374 | 501 | +20 % | +20 % |

These rows are US + CA by shipping country; about 1.5 % of orders ship elsewhere and are left out.

**By market:**

- **US.** Meta has run since 20 Apr. n180 YoY was -21 % on average in Jan to Mar, then -13 % in May (while Meta claimed 142 purchases), then +16 %, +10 %, +13 % and +6 % from Jun to Sep.
- **CA.** Meta was off until 26 Jun; PACKS launched 21 Jul. n180 YoY was already **+40 % in April and +8 % in May with no CA Meta at all**, after the March store merger. It then rose to +40 % in July and +65 to +67 % in Aug and Sep.

**Natural experiments:**

1. **2024 shut-off.** The previous agency ran 7dc + 1dv campaigns, including retargeting ("BoF RMK") and prospecting that excluded only 30-day purchasers.
   - In Jul to Dec 2024, Meta claimed **2,371 purchases (about 29 % of all shop orders) and about $395k revenue on $19k spend** (ROAS 12 to 28).
   - Spend went to zero in Jan 2025.
   - Shop orders in Jul to Dec 2025 were **+2 % YoY**, and revenue was -4 % (-$55k).
   - Even if the whole revenue dip were Meta, at most about 14 % of those claims were incremental. Customer-heavy view-through credit for this brand was overwhelmingly non-incremental.
2. **Launch at about $160/day (20 Apr to end of May).** Meta claimed about 180 purchases, two thirds of them view-through. US n180 orders in May fell 13 % YoY, so no lift is visible at this spend level.
3. **Ramp to about $650/day (Jul to Aug) and the CA launch.** The visible n180 lift appears here. Part of it predates Meta in CA, so the merger and pricing are confounders.
4. **Promo week, 10 to 15 Aug (email-driven).** Compared with 3 to 9 Aug:
   - shop orders rose 2.3x, Meta-excluded repeat orders 2.7x, and n180 orders 1.7x;
   - Meta spend rose only 17 %;
   - Meta's **1-day view claims rose 2.3x** (5.7 to 13 a day), in step with the repeat orders Meta is meant to exclude;
   - 7-day click claims rose 1.7x, in step with n180.

   View-through scales with existing-customer demand, not with spend.

### Marginal effect of spend (regression)

**Model:**

- Weekly, Jan 5 to Sep 27 2026 (38 weeks; 76 market-weeks in the panel).
- Outcome = this year minus the same week last year (364 days back), which removes seasonality.
- Regressors: Meta spend this week and last week (in $1k); optional control = the YoY change in Meta-excluded repeat orders (within 180 days), which absorbs business-wide shocks such as email promos, CRO and the store merger.
- The panel version adds a market fixed effect and a CA post-merger dummy.
- Newey-West standard errors with 4 lags.
- The constant captures the pre-Meta YoY trend (about -11 to -15 n180 orders a week).

| Spec (sum of current + lagged spend effect, per $1k) | n180 orders | n180 revenue | Total revenue |
|---|---|---|---|
| US+CA, no control | 9.7 (95 % CI 5.6 to 13.7) | $831 | $2,009 (CI 502 to 3,515) |
| US+CA, repeat-order control | **8.6 (5.1 to 12.1)** | $661 (230 to 1,091) | **$1,041 (422 to 1,660)** |
| Panel US/CA + merger dummy + control | 8.3 (4.5 to 12.1) | $695 | $1,157 (306 to 2,007) |
| US only, control | 11.0 (6.5 to 15.5) | $1,029 | $1,854 |
| CA only, control | 7.2 (3.6 to 10.9) | $524 | $479 |
| Excluding promo and odd weeks (US+CA, control) | 9.8 | $870 | $1,193 |

**Read-across:**

- **Incremental n180 orders: about 8 to 11 per $1k.** That is an incremental CAC of **about $90 to $120**, or about $1.0 to $1.3 short-term revenue per $1.
- **Meta's own claims per $1k (20 Apr to 30 Sep):** 8.5 on 7-day click, 11.7 on 1-day view and 2.8 on engaged view, so **20.2 on 7dc + 1dv**.
- The estimated incremental volume therefore roughly **equals the 7-day click count and is about 43 % of the 7dc + 1dv count** (CI about 25 to 68 %).

**Confounding (why this is an upper-leaning estimate):**

- Spend ramped at the same time as other changes:
  - One Eighty's email and CRO work from April;
  - the CA store merger in March;
  - Canada pricing work;
  - new landing pages and creatives.
- The control and the merger dummy absorb only part of this.
- The pre-period trend is extrapolated. If the 2025 decline was flattening on its own, the spend coefficient is biased up.
- The control itself may be slightly affected by Meta (repeat orders of newly acquired customers), which biases the estimate down. That effect is small within these months.

**Statistical vs structural uncertainty.** The confidence intervals are statistical only. The structural uncertainty is larger, which is why a test is needed.

## 2. Meta claims vs shop orders

### Share of shop orders Meta claims (US + CA, by shipping country)

| Period | Spend | Claims 7dc + 1dv as % of all orders | as % of n180 orders | 7dc only as % of n180 | View share of claims |
|---|---|---|---|---|---|
| 20 Apr to 30 Jun | $14.6k | 11 % | 32 % | 11 % | 67 % |
| Jul | $9.9k | 15 % | 41 % | 20 % | 52 % |
| Aug to Sep, US | $20.0k | 19 % | 54 % | 23 % | 57 % |
| Aug to Sep, **CA** | $17.8k | **38 %** | **90 %** | 41 % | 54 % |
| Aug to Sep, all | $37.7k | 24 % | 66 % | 29 % | 56 % |

**What this shows:**

- In Aug and Sep, Meta's 7dc + 1dv claims (719) **exceed the total number of first-ever customers** in the shop (667).
- In Canada, Meta claims 90 % of all orders from customers with no purchase in the last 180 days. Yet CA n180 was already +20 to 40 % YoY before CA Meta started.
- Either view-through credit is mostly non-incremental, or the exclusions leak heavily, or both. The evidence below points to both.

**Existing customers inside Meta's numbers:**

- In Shopify `landing_site` data, Aug to Sep orders whose last session came from a Meta ad click (fbclid / utm_source=facebook) number 127:
  - 59 % first-ever;
  - 17 % lapsed (more than 180 days);
  - **24 % customers who had ordered within 180 days**, who should have been excluded.

  September alone shows 27 %.
- The PACKS campaigns rely on the pixel-based "Purchase 180 days" audience, which misses buyers the pixel cannot match (cross-device, email-click checkouts).
- The static BigQuery customer export is from 30 Jun and is only on the older Prospecting and Catalog ad sets.

### View-through share and spend

- The view share of claims fell from about 70 % at about $1.1k a week (Apr to May) to about 55 % at $4.6k a week (Aug to Sep).
- View claims per $1k fell from 15.4 to 10.6, while click claims per $1k stayed flat (7.7 to 8.4).
- **Interpretation.** View-through harvests a limited pool of people who were going to buy anyway (Peter's large organic Facebook following, email subscribers). Added spend buys mostly click-type purchases.

### Clustering with email and existing-customer demand

Daily data, May to early Oct 2026, July excluded (Klaviyo data missing).

| | Orders/day | Repeat orders within 180 days/day | 7dc claims per $1k | 1dv claims per $1k |
|---|---|---|---|---|
| Klaviyo campaign send days (59) | 50.2 | 32.0 | 9.8 | 14.4 |
| No-send days (67) | 41.4 | 25.9 | 7.0 | 9.7 |

The daily regression of Meta claims on spend, Meta-excluded repeat orders, an email-day flag and a weekend flag gives:

- **1-day view claims rise 0.15 per extra repeat-customer order (t = 6.5).**
- 7-day click claims rise 0.05 (t = 2.7).

So view-through credit tracks existing-customer and email demand about 3x more strongly than click credit does. These are purchases Meta's exclusions say it should not be reaching at all.

## 3. GA4 cross-check (Aug to Sep 2026 only)

- GA4 records 2,150 purchases against 2,935 shop orders (73 % capture).
- **Paid Social** (facebook/paid + facebook/cpc) has **116 purchases**, about 160 once scaled for capture.
- Meta claims 318 on 7-day click (2 to 2.7x GA4) and **719 on 7dc + 1dv (4.5 to 6x GA4)**.
- Shopify last-session landing data agrees with GA4, not with Meta: 127 Meta-click orders in Aug to Sep (Aug landing data incomplete), and 73 in September against about 144 Meta 7dc claims.

**Caveats:**

- GA4 Paid Social sessions are about 1.8 to 2.2k a week, while Meta reports 6.6 to 7.2k landing page views a week since mid-August (about 25 to 30 % seen by GA4, against about 64 % in early August). Meta's link clicks doubled around 17 Aug while GA4 sessions did not move, so either UTMs are missing on some ads or the extra clicks are low quality.
- GA4 last-click undercounts cross-device and view-driven paths. The main channel where a genuine view-through halo would show is **Organic Search** (about 1,000 GA4 purchases in Aug to Sep, the largest channel). There is no pre-Meta GA4 data to test whether brand search rose with Meta.

## 4. Verdict

| Component | Plausible incrementality | Reasoning |
|---|---|---|
| 7-day click | 0.7 to 1.0 | The regression estimate is about equal to the 7dc count. About a quarter of click orders are recent customers. |
| 1-day view | **0.1 to 0.2 central (0 to 0.35)** | Scales with existing-customer and email demand. Claims exceed the first-time-customer base. The 2024 shut-off showed no visible loss. Under the regression's upper confidence limit it would be at most about 0.65. |
| 1-day engaged view | about 0 to 0.2 | Already excluded from headline ROAS. |

**Implied true ROAS:**

`ROAS_true ≈ 1.11 × (0.7 to 1.0) + 1.87 × (0 to 0.35) ≈ 0.8 to 1.75`, central **1.0 to 1.3**.

Here 1.11 is the 7dc ROAS and 1.87 is the 1dv ROAS. The regression's direct revenue estimate, $1.04 to $1.16 short-term revenue per $1, sits in the same place. A practical rule is **to multiply Meta's 7dc + 1dv ROAS by about 0.35 to 0.45**, or simply to use 7-day click.

**Economics:**

- **First order.** Contribution about $77 (n180 AOV $122 x 80 % gross margin, minus $20.5 fulfilment). Against an incremental CAC of $90 to $120, the **first order loses money**. The Settings break-even ROAS is 1.51 and the true first-order ROAS is about 0.7 to 1.0 on n180 revenue.
- **12 months.** The 2025 organic new-customer cohort generated $265 revenue and 2.0 orders in 12 months, about $171 contribution, so payback is **inside 12 months only if Meta customers repeat like organic ones**. That is unverified; paid cohorts usually repeat less.

**What it means for targets:**

- The dashboard target ROAS of 3.0 sits on the 7dc + 1dv basis. It is met only because of view credit, and on 7-day click no Dobias ad is a winner (ME2).
- Equivalent honest targets on 7-day click would be about **1.2 to "hold" and 1.4+ to "scale", with a kill line around 0.8**. The owner should decide these once the test reads.

**What it means for the $6M plan (revenue-advisor framing):**

- Lever 1 assumes ROAS 3.0+, CPA < $55 and 100 to 600 paid new customers a month, with about $1.2M incremental by Year 3.
- At current efficiency, $20k a month buys about **170 to 220 incremental 180-day-new orders a month**. Roughly 60 % of those are first-ever (about 100 to 130), which is in line with the Year 1 volume, but at about **2x the planned CPA**.
- The short-term revenue contribution is about **$20 to 30k a month against the about $55 to 60k Meta claims**. For Apr 20 to Sep 30, about $65 to 125k incremental against $188k claimed (7dc + 1dv) and $70k on 7dc.
- **Year 3.** Reaching 600 a month at an incremental CAC of $110 to $190 would need about $70 to 115k a month before diminishing returns. The Year 3 paid-acquisition revenue should be re-planned at about 30 to 50 % of the current assumption unless creative or offer efficiency improves.
- **Rebalancing.** Lever 2 (flows) and Lever 3 (AOV/subscription) need to carry more of the gap.
- **Profit share.** Any fee tied to "incremental revenue" should be measured on shop revenue against baseline, never on Meta-attributed revenue.
- **Baseline definitions differ.** The warehouse net shop revenue for Apr 2025 to Mar 2026 is about $2.30M, against $2.97M in the plan. Figures above are therefore given in absolute dollars and orders, not plan percentages.

### Limits (stated honestly)

- **No randomised variation yet.** Identification comes from timing (launch and ramp) plus a US/CA timing difference. Both are confounded with One Eighty's parallel email, CRO and merger work.
- No window split exists before 2026-04-20, so there is no prospecting vs retargeting view-through comparison, and the 2024 claims cannot be split by window.
- Meta purchases cannot be joined to shop orders, so the "returning customer" share of Meta claims is inferred from last-click Shopify landing data, and only for clicks.
- Klaviyo sends exist only from Dec 2025, and July 2026 is missing. GA4 exists only from Aug 2026. `landing_site` exists only from mid-May 2026 and is incomplete in July and August.
- The new/returning flag uses email within the warehouse window. The n180 metric is consistent from Nov 2024; first-ever counts before mid-2026 are inflated by the US store's May 2024 start.
- Refunds are not netted (about 3 %), which affects levels, not comparisons.

---

## 5. Recommendations (actionable)

### A. The test: US geo holdout (recommended)

**Why this design:**

- **Meta Conversion Lift** is currently **not available**. Meta's eligibility check on act_38180535 (today) returns "not eligible for self-serve Conversion Lift". The criteria are at least $5k spend, at least 500 optimised conversions in 90 days and EMQ of 5 or more via CAPI; the failing criterion is not named. Even if eligible, it measures pixel purchases, which include the returning customers that are the problem, not shop new-customer revenue.
- **An on/off time test** is confounded by the promo calendar. Weekly n180 noise is about ±15 to 20 % and the 2026 promos shift orders 2x.
- **A geo holdout** measures exactly what we care about, from Shopify by shipping state.

**Design:**

| Item | Choice |
|---|---|
| Unit | US states (52 incl. DC and others; CA 303, FL 167, NY 129, TX 115 n180 orders since April). Split into two matched halves by rank on n180 volume, then check pre-period fit (last 26 weeks). |
| Treatment | Holdout half: exclude its states from **all** US ad sets (PACKS, Prospecting, Catalog, and RecipeMaker's US part). Do not raise budgets in the live half; spend per head stays constant, so total US spend falls by about half. Canada unchanged. |
| Duration | **Block 1: 6 weeks, 12 Oct to 22 Nov 2026**, ending before BFCM, plus 2 weeks of post-period read. Burn-in: count from day 4. **Block 2 (crossover, swap halves): 6 to 8 weeks from 11 Jan 2027** if Block 1 is not conclusive. |
| Primary metric | Shop n180 orders and n180 revenue by state half (first-ever + lapsed over 180 days, from `mart_orders` shipping_province). Secondary: first-ever only, total revenue, and 60-day revenue of the cohorts acquired. |
| Analysis | Difference in log(holdout / live) vs the 26-week pre-period ratio, with Meta-excluded repeat orders by half as covariate. Report incremental orders per $1k of withheld spend, incremental ROAS, and the calibration factor F = incremental / Meta-claimed (7dc + 1dv) in the live half. |
| Power | Weekly n180 per half is about 35 to 40, with a weekly log-ratio SD of 0.256. MDE (80 % power, alpha 0.05) is about **-28 % for 6 weeks and -25 % for 8 weeks**, and about -18 to -20 % with the crossover. Expected holdout drop: about -53 % if Meta's 7dc + 1dv is right, about -25 to -30 % at our point estimate, and about -15 % if only clicks count. Block 1 separates "Meta's numbers are right" from "7-day click is right" with high confidence; the crossover is needed to tell "small" from "zero". |
| Cost | About $7k (6 weeks) to $9k (8 weeks) of US spend withheld. Forgone first-order contribution at the point estimate is about $6 to 8k, so it is roughly cash-neutral, plus some future repeat value (about 75 to 100 customers). |
| Risks | Ad set edits reset learning, so all ad sets are edited on the same day in both arms. Other channels must not change by state (keep email and promos national). Some cross-state shipping and travel spill-over (small). A Meta delivery or creative change mid-test invalidates the read, so freeze the creative structure, or launch new ads in both halves only. |
| Decision rule | If F is 0.45 or less (i.e. 7dc-level), move all Dobias decisions to 7-day click and rebase Lever 1. If F is 0.8 or more, keep 7dc + 1dv. |

**Fallback if a geo split is not feasible:** a CA switchback (2 weeks on, 2 weeks off, x3), read the same way. It is less precise and confounded by promos.

### B. Cheap interim steps (this week, no test needed)

1. **Decision metric.** For Dobias, judge creatives and budgets on **7-day click** (`revenue_7d_click`, `prior_roas_7d_click` in `rpt_ad_launch`, split-complete per ME2). Show 7dc + 1dv only as context.
   - Proposed interim thresholds on 7dc: kill below 0.8, hold at 1.0 to 1.2, scale at 1.4 or above.
   - Owner decision; the Settings values (Target 3.0, Kill 1.5) are on the mixed basis.
2. **Fix the exclusions.** Add a **daily-synced customer list** (Shopify/Klaviyo, purchasers in the last 180 days, or all customers for "new-only" ad sets) to every ad set, including PACKS. Replace the static 30 Jun BigQuery export.
   - Reason: 24 to 27 % of Meta last-click orders come from customers who had ordered within 180 days.
   - Also confirm why several *lookalike* audiences sit in the PACKS exclusions; this looks unintended.
3. **7-day-click attribution setting on new ad sets.** This follows the ME2 SOP item E6 and steers optimisation away from "would-buy-anyway" viewers.
   - Run it first as a Meta A/B test (two otherwise identical ad sets in one market).
   - Judge on 7dc CPA and on n180 orders in the weeks after the switch.
4. **Tracking.** Put UTMs on every ad; since mid-August GA4 sees only about 25 to 30 % of Meta's landing page views as Paid Social. Send a `new_customer` flag via CAPI and check EMQ in Events Manager. This also moves the account toward Conversion Lift eligibility.
5. **Cohort repeat check.** Tag orders whose landing session came from Meta (fbclid / utm_source=facebook) and track their 90- and 180-day repeat rate against organic new customers. That decides whether a 12-month payback holds.
6. **Do not scale past about $20k a month** until the Block 1 test reads (late Nov). Communicate to Peter that Meta's reported 3x is about 1.1x incremental, and that Meta is a customer-acquisition investment with payback through repeats, not a short-term profit channel.
7. **Data hygiene (owner).** Register Meta spend 2025-01-01 to 2026-04-19 as true zero in `ref.ad_spend_zero_days`. Restore the Klaviyo campaign sync for July 2026.

**Reproducibility.** Daily dataset at `scratchpad/dobias-viewthrough/daily.csv`; regressions at `scratchpad/dobias-viewthrough/analysis.py` and `scratchpad/dobias-viewthrough/sumcoef.py`.
